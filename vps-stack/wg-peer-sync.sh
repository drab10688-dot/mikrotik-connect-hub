#!/bin/bash
# ==========================================================
# OmniSync · Sincroniza el peer de la MikroTik en el servidor
# WireGuard (wg-easy/linuxserver) de forma PERSISTENTE.
#
# Problema que resuelve: al reinstalar el stack, el servidor
# genera un wg0.conf nuevo con una llave de peer distinta a la
# que tiene la MikroTik -> el handshake se descarta en silencio
# (los paquetes llegan al contenedor pero nunca hay respuesta).
#
# Uso:
#   bash wg-peer-sync.sh <PUBKEY_MIKROTIK> [PSK|none] [IP_TUNEL] [REDES_REMOTAS]
#
# Ejemplo:
#   bash wg-peer-sync.sh NXoT+rUF...NlU= none 10.13.13.2 10.82.0.0/21,192.168.20.0/24
# ==========================================================

set -Eeuo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

CONTAINER="${WG_CONTAINER:-omnisync-wireguard}"
CONF_PATH="${WG_CONF_PATH:-/config/wg_confs/wg0.conf}"

PUBKEY="${1:-}"
PSK="${2:-none}"
PEER_IP="${3:-10.13.13.2}"
REMOTE_NETS="${4:-}"

if [ -z "$PUBKEY" ]; then
  echo -e "${RED}Uso: bash wg-peer-sync.sh <PUBKEY_MIKROTIK> [PSK|none] [IP_TUNEL] [REDES_REMOTAS]${NC}" >&2
  echo -e "${YELLOW}Obtén la llave en la MikroTik con:${NC}" >&2
  echo '  :put [/interface wireguard get wg-omnisync public-key]' >&2
  exit 1
fi

docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$" || {
  echo -e "${RED}El contenedor ${CONTAINER} no está corriendo.${NC}" >&2; exit 1; }

ALLOWED="${PEER_IP}/32"
if [ -n "$REMOTE_NETS" ]; then
  ALLOWED="${ALLOWED},$(echo "$REMOTE_NETS" | tr -d ' ')"
fi

echo -e "${CYAN}Sincronizando peer ${PUBKEY:0:16}… → ${ALLOWED}${NC}"

# ── 1. Aplicar en caliente (efecto inmediato) ──
docker exec "$CONTAINER" sh -lc "
  for p in \$(wg show wg0 peers); do wg set wg0 peer \"\$p\" remove; done
  if [ '$PSK' != 'none' ] && [ -n '$PSK' ]; then
    printf '%s' '$PSK' > /tmp/.psk
    wg set wg0 peer '$PUBKEY' preshared-key /tmp/.psk allowed-ips '$ALLOWED' persistent-keepalive 25
    rm -f /tmp/.psk
  else
    wg set wg0 peer '$PUBKEY' allowed-ips '$ALLOWED' persistent-keepalive 25
  fi
"

# ── 2. Persistir en wg0.conf (sobrevive a reinicios del contenedor) ──
docker exec "$CONTAINER" sh -lc "
  CONF='$CONF_PATH'
  [ -f \"\$CONF\" ] || exit 0
  cp \"\$CONF\" \"\$CONF.bak\"
  # Conservar solo la sección [Interface]
  awk '/^\[Peer\]/{exit} {print}' \"\$CONF.bak\" > \"\$CONF\"
  {
    echo ''
    echo '# OmniSync peer (sincronizado por wg-peer-sync.sh)'
    echo '[Peer]'
    echo 'PublicKey = $PUBKEY'
    if [ '$PSK' != 'none' ] && [ -n '$PSK' ]; then echo 'PresharedKey = $PSK'; fi
    echo 'AllowedIPs = $ALLOWED'
    echo 'PersistentKeepalive = 25'
  } >> \"\$CONF\"
"

# ── 3. Rutas hacia las redes remotas por el túnel ──
if [ -n "$REMOTE_NETS" ]; then
  IFS=',' read -ra NETS <<< "$(echo "$REMOTE_NETS" | tr -d ' ')"
  for net in "${NETS[@]}"; do
    docker exec "$CONTAINER" sh -lc "ip route replace $net dev wg0 2>/dev/null" || true
  done
fi

echo -e "${GREEN}✓ Peer sincronizado y persistido${NC}"
docker exec "$CONTAINER" wg show wg0
echo ""
echo -e "${YELLOW}En la MikroTik verifica:${NC} ping 10.13.13.1 count=4"
