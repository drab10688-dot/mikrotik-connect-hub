#!/usr/bin/env bash
# =====================================================================
# OmniSync — Firewall de servicios internos
# Bloquea DESDE INTERNET (interfaz pública) los puertos internos de Docker.
# Siguen accesibles desde la VPN (L2TP ppp*, WireGuard) y la red interna.
# No usa ufw ni modifica contenedores. Lo aplica firewall-interno.service
# al arrancar. Configuración: /etc/omnisync/firewall-interno.conf
#
#   Aplicar:  /usr/local/sbin/firewall-interno.sh
#   Quitar:   /usr/local/sbin/firewall-interno.sh --quitar
#   Ver:      /usr/local/sbin/firewall-interno.sh --ver
# =====================================================================
set -euo pipefail

# Valores por defecto (el .conf los reemplaza):
#   postgres, api, genieacs ui, genieacs nbi, genieacs fs.
#   7547 (TR-069) queda abierto: las ONUs sin VPN informan por IP pública.
#   Si TODAS tus ONUs entran por VPN, añade 7547 a TCP y UDP en el .conf.
#   8081 (escritorio remoto) es público: lo protege el token del panel.
PUB=""
TCP="5432 3000 3001 7557 7567"
UDP=""
CONF=/etc/omnisync/firewall-interno.conf
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"
[ -n "$PUB" ] || PUB=$(ip -4 route show default 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="dev"){print $(i+1); exit}}')
[ -n "$PUB" ] || { echo "No se detectó la interfaz pública (define PUB en $CONF)" >&2; exit 1; }

C4=NUX-INTERNO
C6=NUX-INTERNO6

quitar() {
  while iptables -C DOCKER-USER -i "$PUB" -j $C4 2>/dev/null; do iptables -D DOCKER-USER -i "$PUB" -j $C4; done
  iptables -F $C4 2>/dev/null || true; iptables -X $C4 2>/dev/null || true
  while ip6tables -C INPUT -i "$PUB" -j $C6 2>/dev/null; do ip6tables -D INPUT -i "$PUB" -j $C6; done
  while ip6tables -C DOCKER-USER -i "$PUB" -j $C6 2>/dev/null; do ip6tables -D DOCKER-USER -i "$PUB" -j $C6; done
  ip6tables -F $C6 2>/dev/null || true; ip6tables -X $C6 2>/dev/null || true
}

ver() {
  echo "Interfaz pública: $PUB"
  echo "IPv4 DOCKER-USER:"; iptables -S DOCKER-USER | sed 's/^/  /'
  echo "IPv4 $C4:"; iptables -S $C4 2>/dev/null | sed 's/^/  /'
  echo "IPv6 INPUT (jump):"; ip6tables -S INPUT | grep $C6 | sed 's/^/  /' || true
  echo "IPv6 $C6:"; ip6tables -S $C6 2>/dev/null | sed 's/^/  /'
}

case "${1:-}" in
  --quitar) quitar; echo "Firewall interno quitado"; exit 0 ;;
  --ver) ver; exit 0 ;;
esac

# Esperar a que Docker cree DOCKER-USER (al arrancar)
for _ in $(seq 1 60); do iptables -S DOCKER-USER >/dev/null 2>&1 && break; sleep 2; done

quitar   # idempotente: se reconstruye desde cero

# ---- IPv4: el tráfico publicado por Docker pasa por FORWARD -> DOCKER-USER (ya con DNAT) ----
iptables -N $C4
for p in $TCP; do iptables -A $C4 -p tcp -m conntrack --ctorigdstport "$p" --ctdir ORIGINAL -j DROP; done
for p in $UDP; do iptables -A $C4 -p udp -m conntrack --ctorigdstport "$p" --ctdir ORIGINAL -j DROP; done
iptables -A $C4 -j RETURN
iptables -I DOCKER-USER 1 -i "$PUB" -j $C4

# ---- IPv6: docker-proxy escucha en [::] (INPUT) ----
ip6tables -N $C6
for p in $TCP; do ip6tables -A $C6 -p tcp --dport "$p" -j DROP; done
for p in $UDP; do ip6tables -A $C6 -p udp --dport "$p" -j DROP; done
ip6tables -A $C6 -j RETURN
ip6tables -I INPUT 1 -i "$PUB" -j $C6
if ip6tables -S DOCKER-USER >/dev/null 2>&1; then
  ip6tables -I DOCKER-USER 1 -i "$PUB" -j $C6
fi
echo "Firewall interno aplicado en $PUB: bloqueados desde internet TCP [$TCP] UDP [$UDP]"
