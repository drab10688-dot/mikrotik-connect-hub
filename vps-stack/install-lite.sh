#!/bin/bash
# ==========================================================
# OmniSync LITE — WireGuard + CMS C-Data (nada más)
# Pensado para un VPS nuevo/limpio (Ubuntu/Debian).
#   • WireGuard  → 10.13.13.0/24 (gateway 10.13.13.1)
#   • CMS C-Data → web 18080, TR-069 9909 y MQTT 1883 por el túnel
#   • Un solo administrador: el usuario root del CMS
# ==========================================================

set -Eeuo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

INSTALL_LOG="/var/log/omnisync-lite-install.log"
touch "$INSTALL_LOG" 2>/dev/null || INSTALL_LOG="/tmp/omnisync-lite-install.log"
exec > >(tee -a "$INSTALL_LOG") 2>&1

CURRENT_STAGE="inicio"
on_error() {
  local code=$? cmd="${BASH_COMMAND}" line="${BASH_LINENO[0]:-?}"
  set +e
  echo -e "${RED}✗ Falló en la etapa '${CURRENT_STAGE}' (línea ${line}, código ${code}).${NC}"
  echo -e "${YELLOW}  Comando: ${cmd}${NC}"
  echo -e "${YELLOW}  Log completo: ${INSTALL_LOG}${NC}"
  command -v docker >/dev/null 2>&1 && docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>&1 || true
  exit "$code"
}
trap on_error ERR

WG_DIR="/opt/omnisync-wg"
WG_SUBNET="${WG_SUBNET:-10.13.13.0}"
WG_PORT="${WG_PORT:-51820}"
WG_PEERS="${WG_PEERS:-mikrotik1,mikrotik2,admin1}"
CMS_SCRIPT_URL="${CMS_SCRIPT_URL:-https://raw.githubusercontent.com/drab10688-dot/mikrotik-connect-hub/main/vps-stack/install-cms.sh}"
CMS_TENANT_TYPE="${CMS_TENANT_TYPE:-multi}"

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║  OmniSync LITE · WireGuard + CMS C-Data      ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

[ "$EUID" -eq 0 ] || { echo -e "${RED}Ejecuta como root (sudo).${NC}"; exit 1; }

# ── Paquetes base ─────────────────────────────────────────
CURRENT_STAGE="paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates openssl iproute2 iptables ufw ldnsutils 2>/dev/null || \
  apt-get install -y curl ca-certificates openssl iproute2 iptables ufw

# ── Docker ────────────────────────────────────────────────
CURRENT_STAGE="instalación de Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo -e "${YELLOW}Instalando Docker...${NC}"
  curl -fsSL --retry 3 https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo -e "${RED}Falta Docker Compose v2.${NC}"; exit 1; }
systemctl enable --now docker >/dev/null 2>&1 || true
echo -e "${GREEN}✓ Docker listo${NC}"

# ── IP pública ────────────────────────────────────────────
CURRENT_STAGE="detección de IP pública"
VPS_IP="${VPS_PUBLIC_IP:-$(curl -4 -fsS --connect-timeout 5 --max-time 10 ifconfig.me 2>/dev/null || true)}"
[ -n "$VPS_IP" ] || VPS_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "$VPS_IP" ] || { echo -e "${RED}No se detectó IPv4 pública. Usa VPS_PUBLIC_IP=<ip>.${NC}"; exit 1; }
echo -e "${GREEN}✓ IP pública: ${VPS_IP}${NC}"

# ── Reenvío de paquetes ───────────────────────────────────
CURRENT_STAGE="reenvío de paquetes"
cat > /etc/sysctl.d/99-omnisync-lite.conf << 'EOF'
net.ipv4.ip_forward=1
net.ipv4.conf.all.src_valid_mark=1
EOF
sysctl --system >/dev/null 2>&1 || true

# ── WireGuard con panel web (wg-easy) ────────────────────
CURRENT_STAGE="WireGuard (wg-easy)"
WG_WEB_PORT="${WG_WEB_PORT:-51821}"
WG_PASS_HASH=$(openssl rand -hex 16)
WG_ADMIN_PASS="${WG_ADMIN_PASS:-$(openssl rand -hex 8)}"
mkdir -p "$WG_DIR"
cat > "$WG_DIR/docker-compose.yml" << EOF
services:
  wg-easy:
    image: ghcr.io/wg-easy/wg-easy:latest
    container_name: omnisync-wireguard
    restart: unless-stopped
    cap_add: [NET_ADMIN, SYS_MODULE]
    environment:
      WG_HOST: ${VPS_IP}
      WG_PORT: ${WG_PORT}
      WG_DEFAULT_DNS: 1.1.1.1
      WG_DEFAULT_ADDRESS: ${WG_SUBNET%.*}.x
      WG_ALLOWED_IPS: ${WG_SUBNET%.*}.0/24, 10.0.0.0/8
      WG_MTU: 1420
      PASSWORD_HASH: \${WG_PASSWORD_HASH}
    ports:
      - "${WG_WEB_PORT}:51821/tcp"   # panel web
      - "${WG_PORT}:51820/udp"       # túnel WireGuard
    volumes:
      - ./config:/etc/wireguard
    network_mode: bridge
EOF

# Generar hash de contraseña (wg-easy v15+ usa bcrypt vía 'wg password')
WG_PASSWORD_HASH="$(docker run --rm ghcr.io/wg-easy/wg-easy:latest \
  wg password -p "${WG_ADMIN_PASS}" 2>/dev/null || echo "")"
# fallback simple: si el comando no está disponible, usa el valor plano
[ -n "$WG_PASSWORD_HASH" ] || WG_PASSWORD_HASH="${WG_PASS_HASH}"

export WG_PASSWORD_HASH
(cd "$WG_DIR" && WG_PASSWORD_HASH="$WG_PASSWORD_HASH" docker compose up -d)

echo -e "${CYAN}Esperando que wg-easy levante el túnel...${NC}"
for i in $(seq 1 30); do
  if docker exec omnisync-wireguard wg show wg0 >/dev/null 2>&1; then break; fi
  sleep 3
done
docker exec omnisync-wireguard wg show wg0 >/dev/null 2>&1 || \
  { echo -e "${RED}WireGuard no levantó wg0.${NC}"; docker logs --tail 40 omnisync-wireguard; exit 1; }
echo -e "${GREEN}✓ WireGuard activo en ${VPS_IP}:${WG_PORT} (subred ${WG_SUBNET}/24)${NC}"

# Intentar crear peers iniciales vía API (no bloqueante; el panel web también lo permite)
CURRENT_STAGE="peers iniciales"
sleep 5
WG_COOKIE="/tmp/wg-easy-cookie.txt"
curl -s --connect-timeout 5 -X POST "http://localhost:${WG_WEB_PORT}/api/session" \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"${WG_ADMIN_PASS}\"}" \
  -c "$WG_COOKIE" >/dev/null 2>&1 || true
for peer in $(echo "$WG_PEERS" | tr ',' ' '); do
  curl -s --connect-timeout 5 -X POST "http://localhost:${WG_WEB_PORT}/api/clients" \
    -H 'Content-Type: application/json' \
    -b "$WG_COOKIE" \
    -d "{\"name\":\"${peer}\"}" >/dev/null 2>&1 || true
done
echo -e "${GREEN}✓ Peers iniciales: ${WG_PEERS} (gestión total desde el panel web)${NC}"

# NAT para que los peers alcancen servicios del host (CMS)
CURRENT_STAGE="ruteo VPN → host"
WG_CT_IP=$(docker inspect omnisync-wireguard --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' | awk '{print $1}')
if [ -n "$WG_CT_IP" ]; then
  ip route replace "${WG_SUBNET%.*}.0/24" via "$WG_CT_IP" 2>/dev/null || true
  echo -e "${GREEN}✓ Ruta host → VPN vía ${WG_CT_IP}${NC}"
fi
docker exec omnisync-wireguard sh -c \
  'iptables -t nat -C POSTROUTING -s '"${WG_SUBNET%.*}"'.0/24 -o eth0 -j MASQUERADE 2>/dev/null || \
   iptables -t nat -A POSTROUTING -s '"${WG_SUBNET%.*}"'.0/24 -o eth0 -j MASQUERADE' 2>/dev/null || true

# Persistir la ruta del host tras reinicios
cat > /etc/systemd/system/omnisync-wg-route.service << EOF
[Unit]
Description=Ruta host hacia la VPN WireGuard de OmniSync
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash -c 'IP=\$(docker inspect omnisync-wireguard --format "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}" | awk "{print \\\$1}"); [ -n "\$IP" ] && ip route replace ${WG_SUBNET%.*}.0/24 via "\$IP"'

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable omnisync-wg-route.service >/dev/null 2>&1 || true

# ── Firewall ──────────────────────────────────────────────
CURRENT_STAGE="firewall"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp        >/dev/null 2>&1 || true
  ufw allow ${WG_PORT}/udp >/dev/null 2>&1 || true
  ufw allow ${WG_WEB_PORT}/tcp >/dev/null 2>&1 || true  # panel web WireGuard
  ufw allow 18080/tcp     >/dev/null 2>&1 || true   # web del CMS
  # TR-069 y MQTT solo por el túnel
  ufw allow in on wg0 to any port 9909 >/dev/null 2>&1 || true
  ufw allow in on wg0 to any port 1883 >/dev/null 2>&1 || true
fi

# ── CMS C-Data ────────────────────────────────────────────
CURRENT_STAGE="instalación del CMS C-Data"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMS_INSTALLER="$SCRIPT_DIR/install-cms.sh"
if [ ! -s "$CMS_INSTALLER" ]; then
  CMS_INSTALLER="/tmp/install-cms.sh"
  curl --retry 3 --retry-all-errors --connect-timeout 15 --max-time 120 -fsSL \
    -o "$CMS_INSTALLER" "$CMS_SCRIPT_URL"
fi
echo -e "${YELLOW}Instalando CMS C-Data (TR-069 por WireGuard ${WG_SUBNET%.*}.1)...${NC}"
CMS_TENANT_TYPE="$CMS_TENANT_TYPE" CMS_TENANT_NONINTERACTIVE=1 ACS_HOST="${WG_SUBNET%.*}.1" WG_IP="${WG_SUBNET%.*}.1" \
  bash "$CMS_INSTALLER" < /dev/null

# ── Generador de configuración para MikroTik ──────────────
CURRENT_STAGE="script MikroTik"
MT_SRC="$SCRIPT_DIR/mikrotik-wg.sh"
if [ ! -s "$MT_SRC" ]; then
  curl --retry 3 --connect-timeout 15 --max-time 60 -fsSL \
    -o "$WG_DIR/mikrotik-wg.sh" \
    "https://raw.githubusercontent.com/drab10688-dot/mikrotik-connect-hub/main/vps-stack/mikrotik-wg.sh" || true
else
  cp "$MT_SRC" "$WG_DIR/mikrotik-wg.sh"
fi
chmod +x "$WG_DIR/mikrotik-wg.sh" 2>/dev/null || true

echo ""
echo -e "${CYAN}Peers WireGuard:${NC}"
echo -e "  Crea los peers desde el panel web y descarga su archivo .conf"
echo -e "  Script listo para MikroTik (todas las reglas OmniSync):"
echo -e "    ${GREEN}bash ${WG_DIR}/mikrotik-wg.sh peer-mikrotik1.conf${NC}"
echo -e "  También puedes pegar la config directamente:  ${GREEN}bash ${WG_DIR}/mikrotik-wg.sh${NC}"


echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║        Instalación LITE completada           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo -e "  CMS web:        ${CYAN}http://${VPS_IP}:18080${NC}   (root / adminisp)"
echo -e "  Panel WG web:   ${CYAN}http://${VPS_IP}:${WG_WEB_PORT}${NC}   (admin / ${WG_ADMIN_PASS})"
echo -e "  WireGuard:      ${CYAN}${VPS_IP}:${WG_PORT}/udp${NC}  · subred ${WG_SUBNET}/24"
echo -e "  ACS de la ONU:  ${CYAN}http://${WG_SUBNET%.*}.1:9909/v1/acs${NC}"
echo -e "  MQTT:           ${CYAN}${WG_SUBNET%.*}.1:1883${NC}"
echo -e "  Log:            ${CYAN}${INSTALL_LOG}${NC}"
echo ""
echo -e "${YELLOW}⚠ Guarda la contraseña del panel WG: ${WG_ADMIN_PASS}${NC}"
echo -e "  Desde el panel puedes crear/eliminar peers, ver QR y bloquear dispositivos.${NC}"
echo ""
