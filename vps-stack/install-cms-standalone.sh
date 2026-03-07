#!/bin/bash
# ============================================
# CMS C-Data — Instalación standalone
# Usa beryindo/cms con puertos default
# Sin dependencias de OmniSync
# ============================================
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

CMS_DIR="/opt/cms-cdata"
VPS_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

normalize_cms_channels() {
  echo -e "${YELLOW}Normalizando canales TR-069/MQTT del CMS...${NC}"

  if docker exec cms-mysql sh -c "mysql -uroot -p\"\${MYSQL_ROOT_PASSWORD}\" --default-character-set=utf8mb4 ccssx_boot -e \"UPDATE iot_channel SET channel_url='${VPS_IP}:9909/v1/acs', channel_port=9909 WHERE channel_id=1; UPDATE iot_channel SET channel_url='${VPS_IP}', channel_port=1883 WHERE channel_id=2;\""; then
    docker exec cms-redis redis-cli FLUSHALL >/dev/null 2>&1 || true
    docker restart cms-boot >/dev/null 2>&1 || true
    echo -e "${GREEN}✓ Canales del CMS normalizados${NC}"
  else
    echo -e "${YELLOW}⚠ No se pudo normalizar iot_channel automáticamente${NC}"
  fi
}

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║   CMS C-Data — Instalador Standalone          ║"
echo "║   Fuente: beryindo/cms (GitHub)                ║"
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

# ── Crear swap si hay menos de 8GB ──
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
if [ "$TOTAL_RAM_MB" -lt 8000 ] && [ ! -f /swapfile ]; then
  echo -e "${YELLOW}Creando swap de 2GB para mayor estabilidad...${NC}"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
  echo -e "${GREEN}✓ Swap creado${NC}"
fi

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

# ── Descargar e instalar con beryindo/cms ──
mkdir -p "$CMS_DIR"
cd "$CMS_DIR"

echo -e "${YELLOW}Descargando instalador desde beryindo/cms...${NC}"
wget -q -O install_docker.sh https://raw.githubusercontent.com/beryindo/cms/refs/heads/main/install_docker.sh
chmod +x install_docker.sh

echo -e "${YELLOW}Ejecutando instalador con puertos default...${NC}"

# Respuestas: todos los puertos default (n), tenant type, host
cat > /tmp/cms_answers.txt << EOF
n
n
n
n
n
n
n
n
${CMS_TENANT_TYPE}
${VPS_IP}
EOF

set +e
bash install_docker.sh < /tmp/cms_answers.txt 2>&1 | tee /tmp/cms_install.log
INSTALL_EXIT=${PIPESTATUS[0]:-1}
set -e
rm -f /tmp/cms_answers.txt

if [ "$INSTALL_EXIT" -ne 0 ]; then
  echo -e "${YELLOW}⚠ El instalador devolvió código ${INSTALL_EXIT}. Intentando continuar...${NC}"
fi

# ── Esperar estabilización ──
echo -e "${CYAN}Esperando estabilización de servicios (180s máx)...${NC}"
for i in $(seq 1 36); do
  sleep 5
  if docker ps --format "{{.Names}} {{.Status}}" | grep -q "cms-mysql.*healthy"; then
    echo -e "${GREEN}✓ MySQL CMS healthy${NC}"
    break
  fi
  RUNNING=$(docker ps --format "{{.Names}}" | grep -c "cms-" 2>/dev/null || echo "0")
  echo -e "  Esperando MySQL... (${i}/36) — ${RUNNING} contenedores activos"
done

# ── Esperar cms-boot ──
for i in $(seq 1 24); do
  if docker ps --format "{{.Names}} {{.Status}}" | grep -q "cms-boot.*healthy"; then
    break
  fi
  sleep 5
  echo -e "  Esperando cms-boot... (${i}/24)"
done

# ── Normalizar canales ──
normalize_cms_channels

# ── Esperar servicio web ──
echo -e "${CYAN}Esperando servicio web...${NC}"
for i in $(seq 1 24); do
  sleep 5
  if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:80" 2>/dev/null | grep -qE "^(200|301|302)"; then
    echo -e "${GREEN}✓ CMS respondiendo en puerto 80${NC}"
    break
  fi
  echo -e "  Esperando web... (${i}/24)"
done

# ── Estado ──
echo ""
echo -e "${CYAN}Estado de contenedores CMS:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -i cms || echo "  (ninguno activo)"

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
echo -e "${CYAN}║${NC}  User:   ${GREEN}root${NC}"
echo -e "${CYAN}║${NC}  Pass:   ${GREEN}adminisp${NC}"
echo -e "${CYAN}║${NC}  Dir:    ${GREEN}${CMS_DIR}${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"

if [ "$INSTALL_EXIT" -ne 0 ]; then
  echo -e "${YELLOW}⚠ Revisa /tmp/cms_install.log si hay problemas${NC}"
fi
