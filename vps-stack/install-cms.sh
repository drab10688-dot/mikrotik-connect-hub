#!/bin/bash
# ============================================
# CMS C-Data — Instalación automatizada en host
# Sin preguntas de puertos: solo tenant (multi/isp)
# ============================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

CMS_VERSION="${CMS_VERSION:-4.0.3}"
CMS_DIR="/opt/cms-cdata"
VPS_IP=$(hostname -I | awk '{print $1}')

# Puertos preferidos (se auto-ajustan si están ocupados)
PREF_MYSQL_PORT="${CMS_MYSQL_PORT:-3307}"
PREF_REDIS_PORT="${CMS_REDIS_PORT:-6380}"
PREF_EMQX_PORT="${CMS_EMQX_PORT:-1883}"
PREF_ACS_PORT="${CMS_ACS_PORT:-9909}"
PREF_STUN_PORT="${CMS_STUN_PORT:-3478}"
PREF_APP_PORT="${CMS_APP_PORT:-9999}"
PREF_NGINX_PORT="${CMS_WEB_PORT:-18080}"

port_in_use() {
  local port="$1"
  ss -lntup 2>/dev/null | grep -q ":${port} "
}

pick_free_port() {
  local port="$1"
  while port_in_use "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

CMS_MYSQL_PORT="$(pick_free_port "$PREF_MYSQL_PORT")"
CMS_REDIS_PORT="$(pick_free_port "$PREF_REDIS_PORT")"
CMS_EMQX_PORT="$(pick_free_port "$PREF_EMQX_PORT")"
CMS_ACS_PORT="$(pick_free_port "$PREF_ACS_PORT")"
CMS_STUN_PORT="$(pick_free_port "$PREF_STUN_PORT")"
CMS_APP_PORT="$(pick_free_port "$PREF_APP_PORT")"
CMS_NGINX_PORT="$(pick_free_port "$PREF_NGINX_PORT")"

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║   CMS C-Data — Instalador Automático         ║"
echo "║   Versión: ${CMS_VERSION}                              ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Ejecuta como root (sudo)${NC}"
  exit 1
fi

echo ""
echo -e "${YELLOW}¿Qué tipo de instalación deseas?${NC}"
echo -e "  ${GREEN}isp${NC}   — Un solo ISP (tu empresa)"
echo -e "  ${GREEN}multi${NC} — Multi-tenant (revender servicio a otros ISPs)"
read -p "Tipo de tenant [multi/isp] (isp): " CMS_TENANT_TYPE < /dev/tty
CMS_TENANT_TYPE=${CMS_TENANT_TYPE:-isp}

if [[ "$CMS_TENANT_TYPE" != "multi" && "$CMS_TENANT_TYPE" != "isp" ]]; then
  echo -e "${RED}Opción inválida. Usa 'multi' o 'isp'${NC}"
  exit 1
fi

echo -e "${GREEN}→ Tipo seleccionado: ${CMS_TENANT_TYPE}${NC}"

# Limpieza de intentos previos
mkdir -p "$CMS_DIR"
if [ -f "$CMS_DIR/docker-compose.yml" ]; then
  (cd "$CMS_DIR" && docker compose down -v --remove-orphans >/dev/null 2>&1 || true)
fi
docker rm -f $(docker ps -aq --filter "name=cms-") >/dev/null 2>&1 || true

cd "$CMS_DIR"

echo -e "${YELLOW}Descargando instalador CMS C-Data v${CMS_VERSION}...${NC}"
curl -fsSL -o cms_install.sh "https://cms.s.cdatayun.com/cms_linux/cms_install.sh"
chmod +x cms_install.sh

echo -e "${YELLOW}Puertos seleccionados automáticamente:${NC}"
echo -e "  MySQL: ${CMS_MYSQL_PORT} | Redis: ${CMS_REDIS_PORT} | EMQX: ${CMS_EMQX_PORT}"
echo -e "  ACS: ${CMS_ACS_PORT} | STUN: ${CMS_STUN_PORT} | APP: ${CMS_APP_PORT} | Nginx: ${CMS_NGINX_PORT}"

# Respuestas alineadas al instalador oficial
cat > /tmp/cms_answers.txt << EOF
y
${CMS_MYSQL_PORT}
y
${CMS_REDIS_PORT}
y
${CMS_EMQX_PORT}
y
${CMS_ACS_PORT}
y
${CMS_STUN_PORT}
y
${CMS_APP_PORT}
y
${CMS_NGINX_PORT}
n
${CMS_TENANT_TYPE}
http://${VPS_IP}:${CMS_NGINX_PORT}
EOF

set +e
bash cms_install.sh install --version "$CMS_VERSION" < /tmp/cms_answers.txt 2>&1 | tee /tmp/cms_install.log
INSTALL_EXIT=$?
set -e
rm -f /tmp/cms_answers.txt

echo ""
echo -e "${CYAN}Verificando instalación...${NC}"
sleep 20

if [ -f "$CMS_DIR/docker-compose.yml" ]; then
  docker compose up -d >/dev/null 2>&1 || true
fi

echo -e "${CYAN}Contenedores CMS:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -i cms || echo "  (ninguno activo aún)"

if ss -lntp | grep -q ":${CMS_NGINX_PORT} "; then
  echo -e "${GREEN}✓ CMS C-Data escuchando en puerto ${CMS_NGINX_PORT}${NC}"
else
  echo -e "${YELLOW}⚠ CMS aún no escucha en ${CMS_NGINX_PORT}${NC}"
  echo -e "${YELLOW}  Revisa: docker logs cms-rmqbroker --tail 80${NC}"
  if free -m | awk 'NR==2{exit !($2<1800)}'; then
    echo -e "${YELLOW}  VPS con RAM baja detectada; recomendado crear swap:${NC}"
    echo -e "${YELLOW}  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile swap swap defaults 0 0' >> /etc/fstab${NC}"
  fi
fi

cat > /etc/systemd/system/cms-cdata.service << EOF
[Unit]
Description=CMS C-Data OLT/ONU Management
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${CMS_DIR}
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable cms-cdata.service >/dev/null 2>&1 || true

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   CMS C-Data — Instalación finalizada        ║${NC}"
echo -e "${CYAN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║${NC}  URL:    ${GREEN}http://${VPS_IP}:${CMS_NGINX_PORT}${NC}"
echo -e "${CYAN}║${NC}  Tipo:   ${GREEN}${CMS_TENANT_TYPE}${NC}"
echo -e "${CYAN}║${NC}  User:   ${GREEN}admin${NC}"
echo -e "${CYAN}║${NC}  Pass:   ${GREEN}admin${NC}"
echo -e "${CYAN}║${NC}  Dir:    ${GREEN}${CMS_DIR}${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"

if [ "$INSTALL_EXIT" -ne 0 ]; then
  echo -e "${YELLOW}⚠ El instalador devolvió código ${INSTALL_EXIT}. Revisa /tmp/cms_install.log${NC}"
fi
