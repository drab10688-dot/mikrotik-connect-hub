#!/usr/bin/env bash
# OmniSync — habilita el acceso del VPS a la LAN de las ONU a través de WireGuard.
#
# Qué hace:
#   1. Añade la red de las ONU al AllowedIPs del peer MikroTik (wg0.conf de wg-easy).
#   2. Recarga WireGuard sin borrar peers.
#   3. Crea la ruta del host hacia esa red vía el contenedor WireGuard.
#   4. Aplica forwarding + MASQUERADE dentro del contenedor.
#   5. Deja todo persistente con un timer de systemd.
#
# Uso:
#   bash add-onu-route.sh 10.82.0.0/21            # detecta el único peer
#   bash add-onu-route.sh 10.82.0.0/21 10.13.13.2 # peer concreto

set -Eeuo pipefail
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

[ "$EUID" -eq 0 ] || { echo -e "${RED}Ejecuta como root.${NC}"; exit 1; }

ONU_NET="${1:-${ONU_NETS:-}}"
PEER_IP="${2:-}"
WG_CONTAINER="${WG_CONTAINER:-omnisync-wireguard}"
WG_DIR="${WG_DIR:-/opt/omnisync-wg}"
WG_CONF="$WG_DIR/config/wg0.conf"
WG_SUBNET="${WG_SUBNET:-10.13.13.0/24}"

[ -n "$ONU_NET" ] || { echo -e "${RED}Indica la red de las ONU. Ej: bash add-onu-route.sh 10.82.0.0/21${NC}"; exit 1; }
docker ps --format '{{.Names}}' | grep -qx "$WG_CONTAINER" || { echo -e "${RED}El contenedor $WG_CONTAINER no está corriendo.${NC}"; exit 1; }
[ -f "$WG_CONF" ] || { echo -e "${RED}No se encontró $WG_CONF${NC}"; exit 1; }

# ─────────────────────────────── 1. AllowedIPs del peer
echo -e "${CYAN}▶ Peers actuales:${NC}"
grep -n 'AllowedIPs' "$WG_CONF" || true

if [ -z "$PEER_IP" ]; then
  mapfile -t PEERS < <(grep -oP 'AllowedIPs\s*=\s*\K[0-9.]+(?=/32)' "$WG_CONF")
  if [ "${#PEERS[@]}" -eq 1 ]; then
    PEER_IP="${PEERS[0]}"
  else
    echo -e "${YELLOW}Hay varios peers: ${PEERS[*]}${NC}"
    echo -e "${YELLOW}Repite el comando indicando cuál es la MikroTik:${NC}"
    echo "  bash add-onu-route.sh $ONU_NET <ip-del-peer>"
    exit 1
  fi
fi
echo -e "${CYAN}▶ Peer MikroTik: ${PEER_IP}${NC}"

cp "$WG_CONF" "$WG_CONF.bak.$(date +%s)"
python3 - "$WG_CONF" "$PEER_IP" "$ONU_NET" <<'PY'
import re, sys
path, peer, net = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
pat = re.compile(rf'^(AllowedIPs\s*=\s*)(.*\b{re.escape(peer)}/32\b.*)$', re.M)
m = pat.search(text)
if not m:
    sys.exit(f"No se encontró AllowedIPs de {peer}")
nets = [n.strip() for n in m.group(2).split(',') if n.strip()]
if net not in nets:
    nets.append(net)
text = text[:m.start()] + m.group(1) + ", ".join(nets) + text[m.end():]
open(path, 'w').write(text)
print("AllowedIPs =", ", ".join(nets))
PY

# ─────────────────────────────── 2. Recargar WireGuard
docker exec "$WG_CONTAINER" sh -c 'wg syncconf wg0 <(wg-quick strip wg0)' 2>/dev/null \
  || docker exec "$WG_CONTAINER" sh -c 'wg-quick down wg0; wg-quick up wg0' >/dev/null 2>&1 \
  || docker restart "$WG_CONTAINER" >/dev/null
sleep 3
echo -e "${GREEN}✓ WireGuard recargado${NC}"

# ─────────────────────────────── 3-4. Rutas y NAT
sysctl -qw net.ipv4.ip_forward=1
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf

cat > /usr/local/sbin/omnisync-onu-routes <<EOF
#!/usr/bin/env bash
GW=\$(docker inspect $WG_CONTAINER --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' 2>/dev/null | awk '{print \$NF}')
[ -n "\$GW" ] || exit 0
ip route replace $WG_SUBNET via "\$GW" 2>/dev/null
for net in ${ONU_NET//,/ }; do
  ip route replace "\$net" via "\$GW" 2>/dev/null
done
docker exec $WG_CONTAINER sh -c '
  iptables -C FORWARD -i eth0 -o wg0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i eth0 -o wg0 -j ACCEPT
  iptables -C FORWARD -i wg0 -o eth0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i wg0 -o eth0 -j ACCEPT
  iptables -t nat -C POSTROUTING -s 172.16.0.0/12 -o wg0 -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 172.16.0.0/12 -o wg0 -j MASQUERADE
' >/dev/null 2>&1
EOF
chmod +x /usr/local/sbin/omnisync-onu-routes

cat > /etc/systemd/system/omnisync-onu-routes.service <<'EOF'
[Unit]
Description=OmniSync - rutas VPN hacia la LAN de ONU
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/omnisync-onu-routes

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/omnisync-onu-routes.timer <<'EOF'
[Unit]
Description=Reaplica rutas VPN hacia la LAN de ONU

[Timer]
OnBootSec=30
OnUnitActiveSec=2min
Unit=omnisync-onu-routes.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now omnisync-onu-routes.timer >/dev/null 2>&1 || true
/usr/local/sbin/omnisync-onu-routes
echo -e "${GREEN}✓ Rutas y NAT aplicados${NC}"

# ─────────────────────────────── 5. Diagnóstico
echo
echo -e "${CYAN}Estado del túnel:${NC}"
docker exec "$WG_CONTAINER" wg show | sed -n '1,30p'
echo
echo -e "${CYAN}Ruta hacia ${ONU_NET}:${NC}"
ip route get "${ONU_NET%%/*}" 2>/dev/null || true
echo
echo -e "${YELLOW}Si el ping sigue fallando, revisa en la MikroTik:${NC}"
echo "  /ip firewall nat print where comment~\"omnisync\""
echo "  /ip firewall filter print where comment~\"omnisync\""
echo "  Muchas ONU bloquean ICMP: prueba  nc -zv ${ONU_NET%%.*}... 7547"
