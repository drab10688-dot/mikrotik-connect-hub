#!/usr/bin/env bash
# OmniSync — restaura EXACTAMENTE la configuración de red que dejó
# funcionando el acceso del VPS a las ONU por WireGuard.
#
# Aplica y deja persistente:
#   • Rutas del host  10.13.13.0/24 y redes de las ONU vía el contenedor WG
#   • Ruta dentro del contenedor API
#   • FORWARD + MASQUERADE de salida (-o wg0) dentro del contenedor WG
#   • Cron de auto-curación cada minuto (sobrevive reinicios del contenedor)
#
# Uso:
#   bash fix-onu-vpn.sh                          # usa las redes de la BD
#   bash fix-onu-vpn.sh 10.82.0.0/21,192.168.20.0/24
set -uo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
[ "$EUID" -eq 0 ] || { echo -e "${RED}Ejecuta como root.${NC}"; exit 1; }

INSTALL_DIR="${INSTALL_DIR:-/opt/omnisync}"
EXTRA_NETS="${1:-${ONU_NETS:-}}"

docker ps --format '{{.Names}}' | grep -qx omnisync-wireguard || {
  echo -e "${YELLOW}WireGuard apagado, iniciándolo...${NC}"
  (cd "$INSTALL_DIR" && docker compose up -d wireguard) >/dev/null 2>&1
  sleep 5
}
docker ps --format '{{.Names}}' | grep -qx omnisync-wireguard || {
  echo -e "${RED}✗ omnisync-wireguard no está corriendo.${NC}"; exit 1; }

docker network connect omnisync_omnisync-net omnisync-wireguard 2>/dev/null || true

mkdir -p "$INSTALL_DIR/scripts"
REFRESH="$INSTALL_DIR/scripts/refresh-vpn-routes.sh"

cat > "$REFRESH" <<ROUTE_EOF
#!/bin/bash
EXTRA_NETS="${EXTRA_NETS}"
ROUTE_EOF
cat >> "$REFRESH" <<'ROUTE_EOF'
WG_IP=$(docker inspect omnisync-wireguard --format '{{range $k,$v := .NetworkSettings.Networks}}{{if eq $k "omnisync_omnisync-net"}}{{$v.IPAddress}}{{end}}{{end}}' 2>/dev/null)
[ -z "$WG_IP" ] && WG_IP=$(docker inspect omnisync-wireguard --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' 2>/dev/null | awk '{print $NF}')
[ -z "$WG_IP" ] && exit 0

ip route replace 10.13.13.0/24 via "$WG_IP" 2>/dev/null
docker exec omnisync-api ip route replace 10.13.13.0/24 via "$WG_IP" 2>/dev/null

NETWORKS=$(docker exec omnisync-postgres psql -U omnisync -d omnisync -tAc \
  "SELECT DISTINCT remote_networks FROM vpn_peers WHERE is_active=true AND remote_networks IS NOT NULL" 2>/dev/null)
echo "$NETWORKS $EXTRA_NETS" | tr ', ' '\n\n' | while read -r net; do
  [ -z "$net" ] && continue
  ip route replace "$net" via "$WG_IP" 2>/dev/null
  docker exec omnisync-api ip route replace "$net" via "$WG_IP" 2>/dev/null
done

docker exec omnisync-wireguard sh -c '
  iptables -C FORWARD -o wg0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -o wg0 -j ACCEPT
  iptables -C FORWARD -i wg0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i wg0 -j ACCEPT
  iptables -t nat -C POSTROUTING -o wg0 -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o wg0 -j MASQUERADE
' >/dev/null 2>&1
ROUTE_EOF
chmod +x "$REFRESH"

sysctl -qw net.ipv4.ip_forward=1 2>/dev/null || true
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf 2>/dev/null || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf

"$REFRESH"
( crontab -l 2>/dev/null | grep -v "refresh-vpn-routes.sh"; echo "* * * * * $REFRESH >/dev/null 2>&1" ) | crontab -

echo -e "${GREEN}✓ Rutas, NAT y auto-curación aplicados${NC}"
echo
echo -e "${CYAN}Rutas activas:${NC}"; ip route | grep -E '10\.13\.13|10\.82|192\.168\.20' || echo "  (ninguna)"
echo -e "${CYAN}Peer WireGuard:${NC}"; docker exec omnisync-wireguard wg show wg0 allowed-ips
echo
echo -e "${YELLOW}Prueba:${NC} ping -c3 10.13.13.2 && nc -zvw5 <IP-ONU> 7547"
