#!/bin/bash
# ============================================
# CMS C-Data — Instalación automatizada en host
# Ejecuta el instalador oficial sin interacción
# Solo pregunta: multi o isp
# ============================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

CMS_VERSION="${CMS_VERSION:-4.0.3}"
CMS_DIR="/opt/cms-cdata"
CMS_MYSQL_PORT="${CMS_MYSQL_PORT:-3307}"
CMS_REDIS_PORT="${CMS_REDIS_PORT:-6380}"
CMS_EMQX_PORT="${CMS_EMQX_PORT:-1883}"
CMS_WEB_PORT="${CMS_WEB_PORT:-18080}"
VPS_IP=$(hostname -I | awk '{print $1}')

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║   CMS C-Data — Instalador Automático         ║"
echo "║   Versión: ${CMS_VERSION}                              ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Check root ───
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Ejecuta como root (sudo)${NC}"
  exit 1
fi

# ─── Preguntar tipo de tenant ───
echo ""
echo -e "${YELLOW}¿Qué tipo de instalación deseas?${NC}"
echo -e "  ${GREEN}isp${NC}   — Un solo ISP (tu empresa)"
echo -e "  ${GREEN}multi${NC} — Multi-tenant (revender servicio a otros ISPs)"
echo ""
read -p "Tipo de tenant [multi/isp] (multi): " CMS_TENANT_TYPE < /dev/tty
CMS_TENANT_TYPE=${CMS_TENANT_TYPE:-multi}

if [[ "$CMS_TENANT_TYPE" != "multi" && "$CMS_TENANT_TYPE" != "isp" ]]; then
  echo -e "${RED}Opción inválida. Usa 'multi' o 'isp'${NC}"
  exit 1
fi

echo -e "${GREEN}→ Tipo seleccionado: ${CMS_TENANT_TYPE}${NC}"

# ─── Crear directorio de instalación ───
mkdir -p "$CMS_DIR"
cd "$CMS_DIR"

# ─── Descargar instalador oficial ───
echo -e "${YELLOW}Descargando instalador CMS C-Data v${CMS_VERSION}...${NC}"
curl -fsSL -o cms_install.sh "https://cms.s.cdatayun.com/cms_linux/cms_install.sh"
chmod +x cms_install.sh

# ─── Crear respuestas automáticas para el instalador ───
# El instalador pregunta en orden:
# 1. mysql port modify? y/n → y (para evitar conflicto con MariaDB 3306)
#    → nuevo puerto
# 2. redis port modify? y/n → y (para evitar conflictos)
#    → nuevo puerto  
# 3. emqx port modify? y/n → n
# 4. cms web port modify? (si pregunta) → n
# 5. data volume modify? → n
# 6. tenant type → multi/isp
# 7. host/IP → VPS IP

echo -e "${YELLOW}Ejecutando instalador con puertos: MySQL=${CMS_MYSQL_PORT}, Redis=${CMS_REDIS_PORT}, EMQX=${CMS_EMQX_PORT}, Web=${CMS_WEB_PORT}${NC}"

# Generar archivo de respuestas automáticas
cat > /tmp/cms_answers.txt << EOF
y
${CMS_MYSQL_PORT}
y
${CMS_REDIS_PORT}
n
n
n
${CMS_TENANT_TYPE}
${VPS_IP}
EOF

# Ejecutar instalador con respuestas automáticas
bash cms_install.sh install --version "$CMS_VERSION" < /tmp/cms_answers.txt 2>&1 | tee /tmp/cms_install.log

INSTALL_EXIT=$?
rm -f /tmp/cms_answers.txt

if [ $INSTALL_EXIT -ne 0 ]; then
  echo -e "${RED}El instalador reportó un error (código: ${INSTALL_EXIT})${NC}"
  echo -e "${YELLOW}Revisando si CMS se instaló de todas formas...${NC}"
fi

# ─── Verificar instalación ───
echo ""
echo -e "${CYAN}Verificando instalación...${NC}"

# Esperar a que los contenedores de CMS arranquen
sleep 10

# Verificar que CMS está escuchando
if ss -lntp | grep -q ":${CMS_WEB_PORT}"; then
  echo -e "${GREEN}✓ CMS C-Data escuchando en puerto ${CMS_WEB_PORT}${NC}"
else
  echo -e "${YELLOW}⚠ Puerto ${CMS_WEB_PORT} aún no responde. Los contenedores pueden estar iniciándose...${NC}"
  echo -e "${YELLOW}  Espera 1-2 minutos y verifica con: ss -lntp | grep ${CMS_WEB_PORT}${NC}"
fi

# Verificar contenedores de CMS
echo ""
echo -e "${CYAN}Contenedores CMS:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -i cms || echo "  (ninguno encontrado aún)"

# ─── Configurar servicio systemd para auto-inicio ───
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
systemctl enable cms-cdata.service 2>/dev/null
echo -e "${GREEN}✓ Servicio systemd cms-cdata configurado (auto-inicio)${NC}"

# ─── Resumen ───
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   CMS C-Data — Instalación Completa          ║${NC}"
echo -e "${CYAN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║${NC}  URL:    ${GREEN}http://${VPS_IP}:${CMS_WEB_PORT}${NC}"
echo -e "${CYAN}║${NC}  Tipo:   ${GREEN}${CMS_TENANT_TYPE}${NC}"
echo -e "${CYAN}║${NC}  User:   ${GREEN}admin${NC}"
echo -e "${CYAN}║${NC}  Pass:   ${GREEN}admin${NC}"
echo -e "${CYAN}║${NC}  MySQL:  ${GREEN}puerto ${CMS_MYSQL_PORT}${NC} (evita conflicto con OmniSync)"
echo -e "${CYAN}║${NC}  Dir:    ${GREEN}${CMS_DIR}${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}⚠ Cambia la contraseña de admin en el primer inicio${NC}"
