#!/bin/bash
# ============================================
# CMS C-Data — Instalación standalone
# Sin dependencias de OmniSync
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

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║   CMS C-Data — Instalador Standalone         ║"
echo "║   Versión: ${CMS_VERSION}                              ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Ejecuta como root (sudo)${NC}"
  exit 1
fi

# ── Verificar Docker ──
if ! command -v docker &>/dev/null; then
  echo -e "${YELLOW}Instalando Docker...${NC}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker && systemctl start docker
  echo -e "${GREEN}✓ Docker instalado${NC}"
fi

# ── Tipo de tenant ──
echo ""
echo -e "${YELLOW}¿Qué tipo de instalación deseas?${NC}"
echo -e "  ${GREEN}isp${NC}   — Un solo ISP (tu empresa)"
echo -e "  ${GREEN}multi${NC} — Multi-tenant (revender servicio a otros ISPs)"
read -p "Tipo de tenant [isp/multi] (isp): " CMS_TENANT_TYPE < /dev/tty
CMS_TENANT_TYPE=${CMS_TENANT_TYPE:-isp}

if [[ "$CMS_TENANT_TYPE" != "multi" && "$CMS_TENANT_TYPE" != "isp" ]]; then
  echo -e "${RED}Opción inválida. Usa 'multi' o 'isp'${NC}"
  exit 1
fi
echo -e "${GREEN}→ Tipo seleccionado: ${CMS_TENANT_TYPE}${NC}"

# ── Limpieza total ──
echo -e "${YELLOW}Limpiando instalaciones anteriores de CMS...${NC}"
if [ -f "$CMS_DIR/docker-compose.yml" ]; then
  (cd "$CMS_DIR" && docker compose down -v --remove-orphans 2>/dev/null || true)
fi
for c in $(docker ps -aq --filter "name=cms-" 2>/dev/null); do
  docker rm -f "$c" 2>/dev/null || true
done
docker volume ls -q 2>/dev/null | grep -i cms | xargs -r docker volume rm 2>/dev/null || true
rm -rf "$CMS_DIR"
echo -e "${GREEN}✓ Limpieza completa${NC}"

# ── Descargar instalador ──
mkdir -p "$CMS_DIR"
cd "$CMS_DIR"

echo -e "${YELLOW}Descargando instalador CMS C-Data v${CMS_VERSION}...${NC}"
curl -fsSL -o cms_install.sh "https://cms.s.cdatayun.com/cms_linux/cms_install.sh"
chmod +x cms_install.sh

# ── Analizar cuántas preguntas hace el instalador ──
# El instalador pregunta:
#   1. mysql port modify? [y/n]      → n
#   2. redis port modify? [y/n]      → n
#   3. emqx port modify? [y/n]       → n
#   4. acs port modify? [y/n]        → n
#   5. stun port modify? [y/n]       → n
#   6. cms port modify? [y/n]        → n
#   7. nginx port modify? [y/n]      → n
#   8. data volume modify? [y/n]     → n
#   9. tenant type [multi/isp]       → isp/multi
#  10. domain/URL                    → http://IP:80
#
# Después inicia MySQL y continúa la instalación

echo -e "${YELLOW}Ejecutando instalador (esto puede tardar varios minutos)...${NC}"

# Generar respuestas automáticas
{
  # 7 preguntas de puertos + 1 de volumen = 8x "n"
  for i in $(seq 1 8); do echo "n"; done
  # Tipo de tenant
  echo "${CMS_TENANT_TYPE}"
  # URL/dominio
  echo "http://${VPS_IP}:80"
} | timeout 600 bash cms_install.sh install --version "$CMS_VERSION" 2>&1 | tee /tmp/cms_install.log

INSTALL_EXIT=${PIPESTATUS[1]:-0}

echo ""
echo -e "${YELLOW}Esperando estabilización de servicios (90s)...${NC}"
for i in $(seq 1 18); do
  sleep 5
  # Verificar si el servicio web responde
  if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:80" 2>/dev/null | grep -qE "^(200|301|302)"; then
    echo -e "${GREEN}✓ CMS respondiendo en puerto 80${NC}"
    break
  fi
  RUNNING=$(docker ps --format "{{.Names}}" | grep -c "cms-" 2>/dev/null || echo "0")
  echo -e "  Esperando... (${i}/18) — ${RUNNING} contenedores CMS activos"
done

# ── Verificar estado ──
echo ""
echo -e "${CYAN}Estado de contenedores CMS:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -i cms || echo "  (ninguno activo)"

echo ""
echo -e "${CYAN}Puertos en uso:${NC}"
ss -lntp | grep -E ":(80|3306|6379|1883|9909|9999) " || echo "  (verificando...)"

# ── Servicio systemd ──
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
echo -e "${CYAN}║${NC}  URL:    ${GREEN}http://${VPS_IP}${NC}"
echo -e "${CYAN}║${NC}  Tipo:   ${GREEN}${CMS_TENANT_TYPE}${NC}"
echo -e "${CYAN}║${NC}  User:   ${GREEN}admin${NC}"
echo -e "${CYAN}║${NC}  Pass:   ${GREEN}admin${NC}"
echo -e "${CYAN}║${NC}  Dir:    ${GREEN}${CMS_DIR}${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"

if [ "$INSTALL_EXIT" -ne 0 ]; then
  echo -e "${YELLOW}⚠ El instalador devolvió código ${INSTALL_EXIT}${NC}"
  echo -e "${YELLOW}  Revisa: cat /tmp/cms_install.log${NC}"
fi
