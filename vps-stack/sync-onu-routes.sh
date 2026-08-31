#!/usr/bin/env bash
# OmniSync — aprende automáticamente las redes de las ONU desde GenieACS
# (ConnectionRequestURL) y crea las rutas + NAT necesarias para que el
# Connection Request llegue al instante por el túnel (L2TP o WireGuard).
#
# Sin esta ruta, GenieACS no puede "despertar" la ONU y cada cambio queda
# encolado hasta el siguiente Inform (minutos de espera).
#
# Uso:
#   bash sync-onu-routes.sh            # aprende y aplica
#   bash sync-onu-routes.sh --install  # además instala cron cada minuto
set -uo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
[ "$EUID" -eq 0 ] || { echo -e "${RED}Ejecuta como root.${NC}"; exit 1; }

NBI="${NBI:-http://localhost:7557}"
EXTRA_NETS="${ONU_NETS:-}"

# ── 1. Descubrir las IP de las ONU registradas en GenieACS ────────────────
IPS=$(curl -s "$NBI/devices/?limit=2000&projection=InternetGatewayDevice.ManagementServer.ConnectionRequestURL,Device.ManagementServer.ConnectionRequestURL" \
  | grep -oE 'http://[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | sed 's|http://||' | sort -u)

NETS=""
for ip in $IPS; do
  case "$ip" in
    127.*|0.*) continue ;;
  esac
  net="$(echo "$ip" | cut -d. -f1-3).0/24"
  case " $NETS " in *" $net "*) ;; *) NETS="$NETS $net" ;; esac
done
for n in $(echo "$EXTRA_NETS" | tr ',' ' '); do
  [ -n "$n" ] || continue
  case " $NETS " in *" $n "*) ;; *) NETS="$NETS $n" ;; esac
done

[ -n "${NETS// /}" ] || { echo -e "${YELLOW}No se detectaron redes de ONU todavía.${NC}"; exit 0; }
echo -e "${CYAN}Redes de ONU detectadas:${NC}$NETS"

# ── 2. Elegir salida: túnel L2TP (ppp*) o contenedor WireGuard ────────────
PPP_IF=$(ip -o -4 addr show 2>/dev/null | awk '/ppp/ {print $2; exit}')
WG_IP=$(docker inspect omnisync-wireguard \
  --format '{{range $k,$v := .NetworkSettings.Networks}}{{if eq $k "omnisync_omnisync-net"}}{{$v.IPAddress}}{{end}}{{end}}' 2>/dev/null)

sysctl -qw net.ipv4.ip_forward=1 2>/dev/null || true
for f in /proc/sys/net/ipv4/conf/*/rp_filter; do printf '0' > "$f" 2>/dev/null || true; done

DOCKER_NETS=$(docker network inspect $(docker network ls -q) \
  --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | sort -u)
[ -n "$DOCKER_NETS" ] || DOCKER_NETS="172.16.0.0/12"

for net in $NETS; do
  if [ -n "$PPP_IF" ]; then
    ip route replace "$net" dev "$PPP_IF" 2>/dev/null && echo -e "${GREEN}✓ ruta $net dev $PPP_IF${NC}"
  elif [ -n "$WG_IP" ]; then
    ip route replace "$net" via "$WG_IP" 2>/dev/null && echo -e "${GREEN}✓ ruta $net via $WG_IP${NC}"
  else
    echo -e "${RED}✗ Sin túnel activo (ni ppp ni WireGuard) para $net${NC}"
    continue
  fi
  for dnet in $DOCKER_NETS; do
    iptables -C FORWARD -s "$dnet" -d "$net" -j ACCEPT 2>/dev/null || \
      iptables -I FORWARD -s "$dnet" -d "$net" -j ACCEPT 2>/dev/null || true
    iptables -C FORWARD -d "$dnet" -s "$net" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
      iptables -I FORWARD -d "$dnet" -s "$net" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
    iptables -t nat -C POSTROUTING -s "$dnet" -d "$net" -j MASQUERADE 2>/dev/null || \
      iptables -t nat -A POSTROUTING -s "$dnet" -d "$net" -j MASQUERADE 2>/dev/null || true
  done
done

# ── 3. Prueba real de alcance desde GenieACS ──────────────────────────────
echo -e "${CYAN}Prueba TCP 7547 desde el contenedor GenieACS:${NC}"
for ip in $(echo "$IPS" | head -5); do
  if docker exec omnisync-genieacs timeout 3 bash -c "echo > /dev/tcp/$ip/7547" 2>/dev/null; then
    echo -e "  $ip ${GREEN}OK${NC}"
  else
    echo -e "  $ip ${RED}SIN ALCANCE${NC}"
  fi
done

# ── 4. Persistencia ───────────────────────────────────────────────────────
if [ "${1:-}" = "--install" ]; then
  install -m 755 "$0" /usr/local/sbin/omnisync-sync-onu-routes
  ( crontab -l 2>/dev/null | grep -v omnisync-sync-onu-routes; \
    echo "* * * * * /usr/local/sbin/omnisync-sync-onu-routes >/dev/null 2>&1" ) | crontab -
  echo -e "${GREEN}✓ Auto-reparación instalada (cron cada minuto)${NC}"
fi
