#!/bin/bash
# OmniSync VPN — instalador independiente de WireGuard + panel MikroTik.
# No instala, inicia ni modifica CMS C-Data.

set -Eeuo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
INSTALL_LOG="/var/log/omnisync-wireguard-install.log"
touch "$INSTALL_LOG" 2>/dev/null || INSTALL_LOG="/tmp/omnisync-wireguard-install.log"
exec > >(tee -a "$INSTALL_LOG") 2>&1

STAGE="inicio"
on_error() {
  local code=$? line="${BASH_LINENO[0]:-?}"
  set +e
  echo -e "${RED}✗ Falló '${STAGE}' (línea ${line}, código ${code}).${NC}"
  echo -e "${YELLOW}Log: ${INSTALL_LOG}${NC}"
  command -v docker >/dev/null 2>&1 && docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
  exit "$code"
}
trap on_error ERR

[ "$EUID" -eq 0 ] || { echo -e "${RED}Ejecuta como root.${NC}"; exit 1; }

WG_DIR="${WG_DIR:-/opt/omnisync-wg}"
WG_SUBNET="${WG_SUBNET:-10.13.13.0}"
WG_BASE="${WG_SUBNET%.*}"
WG_PORT="${WG_PORT:-51820}"
WG_WEB_PORT="${WG_WEB_PORT:-51821}"
PANEL_PORT="${PANEL_PORT:-51822}"
SCRIPT_URL="${PANEL_SCRIPT_URL:-https://raw.githubusercontent.com/drab10688-dot/mikrotik-connect-hub/main/vps-stack/mt-panel/server.py}"
SECRETS_FILE="$WG_DIR/panel.env"

echo -e "${CYAN}OmniSync VPN · WireGuard + Panel MikroTik${NC}"
echo "Este instalador no toca el CMS."

STAGE="paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates openssl python3 iproute2 iptables ufw

STAGE="Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL --retry 3 https://get.docker.com | sh
fi
docker compose version >/dev/null
systemctl enable --now docker >/dev/null 2>&1 || true

STAGE="configuración"
VPS_IP="${VPS_PUBLIC_IP:-$(curl -4 -fsS --connect-timeout 5 --max-time 10 ifconfig.me 2>/dev/null || true)}"
[ -n "$VPS_IP" ] || VPS_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$VPS_IP" ] || { echo -e "${RED}Usa VPS_PUBLIC_IP=<IPv4>.${NC}"; exit 1; }
mkdir -p "$WG_DIR/config" "$WG_DIR/mt-panel"

# En actualizaciones conserva credenciales y peers existentes.
if [ -s "$SECRETS_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
  set +a
else
  WG_ADMIN_PASS="${WG_ADMIN_PASS:-$(openssl rand -hex 10)}"
  PANEL_USER="${PANEL_USER:-admin}"
  PANEL_PASS="${PANEL_PASS:-$(openssl rand -hex 10)}"
  umask 077
  cat > "$SECRETS_FILE" <<EOF
WG_ADMIN_PASS=${WG_ADMIN_PASS}
PANEL_USER=${PANEL_USER}
PANEL_PASS=${PANEL_PASS}
EOF
fi

cat > /etc/sysctl.d/99-omnisync-wireguard.conf <<'EOF'
net.ipv4.ip_forward=1
net.ipv4.conf.all.src_valid_mark=1
EOF
sysctl --system >/dev/null 2>&1 || true

STAGE="contraseña de WireGuard"
WG_HASH="$(docker run --rm ghcr.io/wg-easy/wg-easy:14 wgpw "$WG_ADMIN_PASS" 2>/dev/null | sed -n "s/^PASSWORD_HASH='\(.*\)'$/\1/p" | head -1)"
[ -n "$WG_HASH" ] || { echo -e "${RED}No se pudo crear la contraseña segura de wg-easy.${NC}"; exit 1; }
WG_HASH_YAML="$(printf '%s' "$WG_HASH" | sed 's/\$/$$/g')"

cat > "$WG_DIR/docker-compose.yml" <<EOF
services:
  wireguard:
    image: ghcr.io/wg-easy/wg-easy:14
    container_name: omnisync-wireguard
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    environment:
      WG_HOST: "${VPS_IP}"
      WG_PORT: "${WG_PORT}"
      WG_DEFAULT_DNS: "1.1.1.1"
      WG_DEFAULT_ADDRESS: "${WG_BASE}.x"
      WG_ALLOWED_IPS: "${WG_BASE}.0/24,10.0.0.0/8"
      WG_MTU: "1420"
      PASSWORD_HASH: '${WG_HASH_YAML}'
    ports:
      - "${WG_WEB_PORT}:51821/tcp"
      - "${WG_PORT}:51820/udp"
    volumes:
      - ./config:/etc/wireguard
EOF

STAGE="inicio de WireGuard"
(cd "$WG_DIR" && docker compose up -d)
for _ in $(seq 1 40); do
  docker exec omnisync-wireguard wg show wg0 >/dev/null 2>&1 && break
  sleep 2
done
docker exec omnisync-wireguard wg show wg0 >/dev/null 2>&1 || {
  docker logs --tail 80 omnisync-wireguard
  exit 1
}

STAGE="panel MikroTik"
# Se descarga siempre para que funcione igual como archivo o mediante `curl | bash`.
# El sufijo evita la caché de raw.githubusercontent (hasta 5 min de retraso).
curl -fsSL --retry 3 --connect-timeout 15 --max-time 90 \
  -H 'Cache-Control: no-cache' \
  -o "$WG_DIR/mt-panel/server.py" "${SCRIPT_URL}?cb=$(date +%s)"
python3 -m py_compile "$WG_DIR/mt-panel/server.py"

# systemd EnvironmentFile no interpreta valores igual que Bash. Escribimos cada
# valor escapado para admitir credenciales antiguas con símbolos sin romperlo.
write_env() {
  local key="$1" value="$2"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s="%s"\n' "$key" "$value"
}
{
  write_env WG_API "http://127.0.0.1:${WG_WEB_PORT}"
  write_env WG_PASSWORD "$WG_ADMIN_PASS"
  write_env WG_SUBNET_BASE "$WG_BASE"
  write_env WG_PORT "$WG_PORT"
  write_env PANEL_PORT "$PANEL_PORT"
  write_env PANEL_USER "$PANEL_USER"
  write_env PANEL_PASS "$PANEL_PASS"
  write_env CMS_VPN_IP "${CMS_VPN_IP:-${WG_BASE}.1}"
  write_env CMS_ACS_PORT "${CMS_ACS_PORT:-9909}"
  write_env CMS_ACS_PATH "${CMS_ACS_PATH:-/v1/acs}"
} > /etc/omnisync-mt-panel.env
chmod 600 "$SECRETS_FILE" /etc/omnisync-mt-panel.env

cat > /etc/systemd/system/omnisync-mt-panel.service <<EOF
[Unit]
Description=OmniSync WireGuard MikroTik Panel
After=docker.service network-online.target
Wants=docker.service network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/omnisync-mt-panel.env
ExecStart=/usr/bin/python3 ${WG_DIR}/mt-panel/server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > /usr/local/sbin/omnisync-wg-route <<EOF
#!/bin/bash
set -u
for _ in \$(seq 1 30); do
  IP=\$(docker inspect omnisync-wireguard --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null || true)
  docker exec omnisync-wireguard wg show wg0 >/dev/null 2>&1 && [ -n "\$IP" ] && break
  sleep 2
done
[ -n "\${IP:-}" ] || exit 1
ip route replace ${WG_BASE}.0/24 via "\$IP"

# Lleva los servicios instalados después en el host (CMS web, ACS y MQTT)
# hasta la IP gateway de WireGuard. Las reglas son idempotentes.
GW=\$(docker inspect omnisync-wireguard --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' 2>/dev/null || true)
[ -n "\$GW" ] || exit 0
# CMS oficial: Web 80/443, ACS 9909, MQTT 1883 y API CMS 9999.
for SPEC in 80:80 443:443 9909:9909 1883:1883 9999:9999; do
  DPORT=\${SPEC%%:*}; HPORT=\${SPEC##*:}
  docker exec omnisync-wireguard sh -c \
    "iptables -t nat -C PREROUTING -i wg0 -d ${WG_BASE}.1 -p tcp --dport \$DPORT -j DNAT --to-destination \$GW:\$HPORT 2>/dev/null || iptables -t nat -A PREROUTING -i wg0 -d ${WG_BASE}.1 -p tcp --dport \$DPORT -j DNAT --to-destination \$GW:\$HPORT"
done
EOF
chmod +x /usr/local/sbin/omnisync-wg-route
cat > /etc/systemd/system/omnisync-wg-route.service <<'EOF'
[Unit]
Description=Ruta del host hacia peers OmniSync WireGuard
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/omnisync-wg-route

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/omnisync-wg-route.timer <<'EOF'
[Unit]
Description=Verifica rutas y enlace de servicios OmniSync VPN

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
Unit=omnisync-wg-route.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable omnisync-mt-panel.service >/dev/null
systemctl reset-failed omnisync-mt-panel.service >/dev/null 2>&1 || true
systemctl restart omnisync-mt-panel.service
systemctl enable omnisync-wg-route.service >/dev/null
systemctl enable --now omnisync-wg-route.timer >/dev/null
/usr/local/sbin/omnisync-wg-route || true

STAGE="firewall"
ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow "${WG_PORT}/udp" >/dev/null 2>&1 || true
ufw allow "${WG_WEB_PORT}/tcp" >/dev/null 2>&1 || true
ufw allow "${PANEL_PORT}/tcp" >/dev/null 2>&1 || true
# Servicios futuros del CMS: accesibles desde la VPN, no se publican aquí.
ufw allow from "${WG_BASE}.0/24" to any port 9909 proto tcp >/dev/null 2>&1 || true
ufw allow from "${WG_BASE}.0/24" to any port 1883 proto tcp >/dev/null 2>&1 || true

STAGE="verificación"
for _ in $(seq 1 30); do
  curl -fsS -u "${PANEL_USER}:${PANEL_PASS}" "http://127.0.0.1:${PANEL_PORT}/" >/dev/null 2>&1 && break
  if ! systemctl is-active --quiet omnisync-mt-panel.service; then
    echo -e "${RED}El panel no pudo iniciar. Diagnóstico:${NC}"
    systemctl status omnisync-mt-panel.service --no-pager -l || true
    journalctl -u omnisync-mt-panel.service -n 60 --no-pager || true
    exit 1
  fi
  sleep 1
done
if ! curl -fsS -u "${PANEL_USER}:${PANEL_PASS}" "http://127.0.0.1:${PANEL_PORT}/" >/dev/null; then
  echo -e "${RED}El panel sigue sin responder en el puerto ${PANEL_PORT}. Diagnóstico:${NC}"
  ss -lntp | grep -E ":${PANEL_PORT}[[:space:]]" || true
  systemctl status omnisync-mt-panel.service --no-pager -l || true
  journalctl -u omnisync-mt-panel.service -n 60 --no-pager || true
  exit 1
fi

echo
echo -e "${GREEN}✓ WireGuard y panel instalados. El CMS no fue modificado.${NC}"
echo -e "Panel OmniSync:  ${CYAN}http://${VPS_IP}:${PANEL_PORT}${NC}"
echo -e "Usuario:          ${CYAN}${PANEL_USER}${NC}"
echo -e "Clave panel:      ${CYAN}${PANEL_PASS}${NC}"
echo -e "Panel técnico WG: ${CYAN}http://${VPS_IP}:${WG_WEB_PORT}${NC}"
echo -e "Clave WG:         ${CYAN}${WG_ADMIN_PASS}${NC}"
echo -e "VPN:              ${CYAN}${VPS_IP}:${WG_PORT}/udp · ${WG_BASE}.0/24${NC}"
echo -e "CMS futuro/ACS:   ${CYAN}http://${CMS_VPN_IP:-${WG_BASE}.1}:${CMS_ACS_PORT:-9909}${CMS_ACS_PATH:-/v1/acs}${NC}"
echo -e "Credenciales:     ${CYAN}${SECRETS_FILE}${NC}"