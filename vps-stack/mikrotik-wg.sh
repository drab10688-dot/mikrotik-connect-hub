#!/bin/bash
# ==========================================================
# OmniSync · Generador de script RouterOS para WireGuard
# Convierte una configuración de peer (la que crea el panel
# web wg-easy) en el script completo de MikroTik con TODAS
# las reglas de OmniSync: interfaz, peer, IP, firewall input,
# forward en ambos sentidos y NAT masquerade del túnel.
#
# Uso:
#   bash mikrotik-wg.sh peer-mikrotik1.conf        # desde archivo
#   bash mikrotik-wg.sh                            # pega la config y Ctrl-D
#   bash mikrotik-wg.sh peer.conf > mikrotik1.rsc  # guardar
# ==========================================================

set -Eeuo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

WG_SUBNET_BASE="${WG_SUBNET_BASE:-10.13.13}"
WG_PORT="${WG_PORT:-51820}"
MT_LISTEN_PORT="${MT_LISTEN_PORT:-13231}"
IFACE="${MT_IFACE:-wg-omnisync}"

if [ $# -ge 1 ]; then
  [ -s "$1" ] || { echo -e "${RED}No existe o está vacío: $1${NC}" >&2; exit 1; }
  CONF="$(cat "$1")"
else
  echo -e "${CYAN}Pega la configuración del peer (del panel wg-easy) y termina con Ctrl-D:${NC}" >&2
  CONF="$(cat)"
fi

get_val() { echo "$CONF" | grep -iE "^[[:space:]]*$1[[:space:]]*=" | head -1 | cut -d= -f2- | xargs; }

CLIENT_PRIV="$(get_val PrivateKey)"
CLIENT_ADDR="$(get_val Address | cut -d, -f1 | xargs)"
SERVER_PUB="$(get_val PublicKey)"
PSK="$(get_val PresharedKey)"
ENDPOINT="$(get_val Endpoint)"

CLIENT_IP="${CLIENT_ADDR%%/*}"
SERVER_IP="${ENDPOINT%%:*}"
ENDPOINT_PORT="${ENDPOINT##*:}"
[ "$ENDPOINT_PORT" = "$ENDPOINT" ] && ENDPOINT_PORT="$WG_PORT"

for v in CLIENT_PRIV CLIENT_IP SERVER_PUB SERVER_IP; do
  [ -n "${!v}" ] || { echo -e "${RED}Falta '$v' en la configuración pegada.${NC}" >&2; exit 1; }
done

PSK_LINE=""
[ -n "$PSK" ] && PSK_LINE="  preshared-key=\"${PSK}\" \\
"

cat << EOF
# ============================================
# OmniSync WireGuard — RouterOS v7
# Peer: ${CLIENT_IP}   ·   Servidor: ${SERVER_IP}:${ENDPOINT_PORT}
# ============================================

# 1) Eliminar configuración anterior (si existe)
:do { /ip address remove [find where interface=${IFACE}] } on-error={}
:do { /interface wireguard peers remove [find where interface=${IFACE}] } on-error={}
:do { /interface wireguard remove [find where name=${IFACE}] } on-error={}

# 2) Crear interfaz WireGuard
/interface wireguard add name=${IFACE} listen-port=${MT_LISTEN_PORT} private-key="${CLIENT_PRIV}"

# 3) Agregar peer del servidor VPS
/interface wireguard peers add \\
  interface=${IFACE} \\
  public-key="${SERVER_PUB}" \\
${PSK_LINE}  endpoint-address=${SERVER_IP} \\
  endpoint-port=${ENDPOINT_PORT} \\
  allowed-address=${WG_SUBNET_BASE}.0/24 \\
  persistent-keepalive=25

# 4) Asignar IP al túnel
/ip address add address=${CLIENT_IP}/24 interface=${IFACE}

# 5) Firewall: permitir acceso API/Winbox desde el VPS por el túnel
:do { /ip firewall filter remove [find where comment="omnisync-vpn-api"] } on-error={}
:do { /ip firewall filter remove [find where comment="omnisync-vpn-forward"] } on-error={}
/ip firewall filter add \\
  chain=input \\
  src-address=${WG_SUBNET_BASE}.0/24 \\
  protocol=tcp \\
  dst-port=8728,8729,8738,8291,80,443 \\
  action=accept \\
  comment="omnisync-vpn-api" \\
  place-before=0

# 6) Firewall: reenviar tráfico del túnel hacia las ONUs/PPPoE (TR-069)
/ip firewall filter add \\
  chain=forward \\
  in-interface=${IFACE} \\
  action=accept \\
  comment="omnisync-vpn-forward" \\
  place-before=0
/ip firewall filter add \\
  chain=forward \\
  out-interface=${IFACE} \\
  action=accept \\
  comment="omnisync-vpn-forward" \\
  place-before=0

# 6.1) NAT: enmascarar el tráfico del túnel hacia ONUs/PPPoE/LAN
#      Sin dst-address: cubre 10.82.0.0/21, 192.168.x.x y cualquier red remota.
:do { /ip firewall nat remove [find where comment="omnisync-vpn-masq"] } on-error={}
/ip firewall nat add \\
  chain=srcnat \\
  src-address=${WG_SUBNET_BASE}.0/24 \\
  action=masquerade \\
  comment="omnisync-vpn-masq"

# 7) NAT de salida de las ONUs hacia el CMS/ACS por el túnel
:do { /ip firewall nat remove [find where comment="omnisync-acs-masq"] } on-error={}
/ip firewall nat add \\
  chain=srcnat \\
  out-interface=${IFACE} \\
  action=masquerade \\
  comment="omnisync-acs-masq"

# 8) Verificar conectividad
:delay 5s
:do { /ping ${WG_SUBNET_BASE}.1 count=3 } on-error={ :log warning "WireGuard: sin respuesta del VPS" }

:log info "WireGuard OmniSync configurado (${CLIENT_IP})"
EOF

{
  echo ""
  echo -e "${GREEN}✓ Script generado para el peer ${CLIENT_IP}${NC}"
  echo -e "${YELLOW}Pégalo completo en la Terminal de Winbox (New Terminal).${NC}"
  echo -e "  Luego las ONUs apuntan su TR-069 a: ${CYAN}http://${WG_SUBNET_BASE}.1:9909/v1/acs${NC}"
  echo -e "  Recuerda: en el panel wg-easy, el peer debe tener en 'Allowed IPs'"
  echo -e "  las redes de tus clientes (ej. ${CYAN}10.82.0.0/21, 192.168.20.0/24${NC}) para que"
  echo -e "  el VPS alcance las ONUs detrás de la MikroTik."
} >&2
