#!/bin/bash
# ============================================
# CMS C-Data — Instalación standalone
# Sin dependencias de OmniSync
# Compatible con VPS de 4GB+ RAM
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
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
CMS_INSTALL_TIMEOUT="${CMS_INSTALL_TIMEOUT:-900}"

normalize_cms_channels() {
  echo -e "${YELLOW}Normalizando canales TR-069/MQTT del CMS...${NC}"

  if docker exec cms-mysql sh -c "mysql -uroot -p\"\${MYSQL_ROOT_PASSWORD}\" --default-character-set=utf8mb4 ccssx_boot -e \"UPDATE iot_channel SET channel_url='${VPS_IP}:9909/v1/acs', channel_port=9909 WHERE channel_id=1; UPDATE iot_channel SET channel_url='${VPS_IP}', channel_port=1883 WHERE channel_id=2;\""; then
    docker exec cms-redis redis-cli FLUSHALL >/dev/null 2>&1 || true
    docker restart cms-boot >/dev/null 2>&1 || true
    echo -e "${GREEN}✓ Canales del CMS normalizados (sin protocolo duplicado)${NC}"
  else
    echo -e "${YELLOW}⚠ No se pudo normalizar iot_channel automáticamente${NC}"
  fi
}

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║   CMS C-Data — Instalador Standalone         ║"
echo "║   Versión: ${CMS_VERSION}                              ║"
echo "║   RAM: ${TOTAL_RAM_MB}MB detectada                     ║"
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

# ── Descargar instalador ──
mkdir -p "$CMS_DIR"
cd "$CMS_DIR"

echo -e "${YELLOW}Descargando instalador CMS C-Data v${CMS_VERSION}...${NC}"
curl -fsSL -o cms_install.sh "https://cms.s.cdatayun.com/cms_linux/cms_install.sh"
chmod +x cms_install.sh

echo -e "${YELLOW}Ejecutando instalador (esto puede tardar varios minutos)...${NC}"

# Generar respuestas automáticas:
# 8x "n" (no cambiar puertos ni volúmenes) + tipo tenant + URL
set +e
{
  for i in $(seq 1 8); do echo "n"; done
  echo "${CMS_TENANT_TYPE}"
  echo "http://${VPS_IP}:80"
} | timeout "${CMS_INSTALL_TIMEOUT}" bash cms_install.sh install --version "$CMS_VERSION" 2>&1 | tee /tmp/cms_install.log
INSTALL_EXIT=${PIPESTATUS[1]:-1}
set -e

if [ "$INSTALL_EXIT" -eq 124 ]; then
  echo -e "${YELLOW}⚠ Timeout del instalador oficial (${CMS_INSTALL_TIMEOUT}s). Continuando con la configuración generada...${NC}"
elif [ "$INSTALL_EXIT" -ne 0 ]; then
  echo -e "${YELLOW}⚠ El instalador oficial devolvió código ${INSTALL_EXIT}. Intentando continuar...${NC}"
fi

# ── Verificar que se generó docker-compose.yml ──
if [ ! -f "$CMS_DIR/docker-compose.yml" ]; then
  echo -e "${RED}Error: No se generó docker-compose.yml${NC}"
  echo -e "${RED}Revisa: cat /tmp/cms_install.log${NC}"
  exit 1
fi

# ── Parchear Java heap de RocketMQ Broker ──
# Evita error "Initial heap size > maximum heap size"
echo -e "${YELLOW}Parcheando configuración de Java para RocketMQ...${NC}"
cd "$CMS_DIR"
docker compose down 2>/dev/null || true

# Calcular heap apropiado según RAM disponible
if [ "$TOTAL_RAM_MB" -ge 16000 ]; then
  RMQ_HEAP="1g"
elif [ "$TOTAL_RAM_MB" -ge 8000 ]; then
  RMQ_HEAP="512m"
else
  RMQ_HEAP="256m"
fi

# Parchear el broker: agregar/reemplazar JAVA_OPT_EXT si existe
if grep -q "JAVA_OPT_EXT" "$CMS_DIR/docker-compose.yml"; then
  # Reemplazar valores existentes de Xms/Xmx
  sed -i -E "s/-Xms[0-9]+[mgMG]/-Xms${RMQ_HEAP}/g; s/-Xmx[0-9]+[mgMG]/-Xmx${RMQ_HEAP}/g" "$CMS_DIR/docker-compose.yml"
else
  # Inyectar JAVA_OPT_EXT en el servicio rmqbroker
  # Buscar la sección de environment del broker y agregar la variable
  sed -i "/container_name: cms-rmqbroker/,/^  [a-z]/{
    /environment:/a\\      JAVA_OPT_EXT: '-server -Xms${RMQ_HEAP} -Xmx${RMQ_HEAP}'
  }" "$CMS_DIR/docker-compose.yml" 2>/dev/null || true
fi

# También parchear el namesrv si tiene valores altos
if grep -q "cms-rmqnamesrv" "$CMS_DIR/docker-compose.yml"; then
  sed -i "/container_name: cms-rmqnamesrv/,/^  [a-z]/{
    /environment:/a\\      JAVA_OPT_EXT: '-server -Xms${RMQ_HEAP} -Xmx${RMQ_HEAP}'
  }" "$CMS_DIR/docker-compose.yml" 2>/dev/null || true
fi

# Eliminar mem_limit si excede la RAM disponible
sed -i '/mem_limit:/d' "$CMS_DIR/docker-compose.yml" 2>/dev/null || true

echo -e "${GREEN}✓ Java heap configurado a ${RMQ_HEAP} por servicio${NC}"

# ── Iniciar CMS ──
echo -e "${YELLOW}Iniciando CMS C-Data...${NC}"
docker compose up -d 2>&1

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

# ── Inicializar tenant automáticamente ──
echo -e "${YELLOW}Inicializando tenant ${CMS_TENANT_TYPE}...${NC}"

# Esperar a que cms-boot esté healthy
for i in $(seq 1 24); do
  if docker ps --format "{{.Names}} {{.Status}}" | grep -q "cms-boot.*healthy"; then
    break
  fi
  sleep 5
  echo -e "  Esperando cms-boot... (${i}/24)"
done

# Crear directorio de configuración si no existe
mkdir -p /opt/cms-cdata/conf/sys

# Verificar si ya está inicializado
INIT_FLAG=$(docker exec cms-mysql sh -c 'mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" --default-character-set=utf8mb4 ccssx_boot -BN -e "select initialized_flag from cms_global_config;" 2>/dev/null' || echo "0")

if [ "$INIT_FLAG" != "1" ]; then
  echo -e "${YELLOW}Ejecutando SQL de inicialización...${NC}"
  docker exec cms-mysql sh -c 'sed -i "s|{tenant_host}|'"${VPS_IP}"'|g" /init_tenant/'"${CMS_TENANT_TYPE}"'.sql' 2>/dev/null || true
  docker exec cms-mysql sh -c 'mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" --default-character-set=utf8mb4 ccssx_boot -e "source /init_tenant/'"${CMS_TENANT_TYPE}"'.sql"' 2>/dev/null
  docker exec cms-mysql sh -c 'mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" --default-character-set=utf8mb4 ccssx_boot -e "update cms_global_config set initialized_flag = 1"' 2>/dev/null
  docker restart cms-boot
  echo -e "${GREEN}✓ Tenant inicializado${NC}"
  sleep 10
else
  echo -e "${GREEN}✓ Tenant ya estaba inicializado${NC}"
fi

normalize_cms_channels

# Esperar a que el servicio web responda
echo -e "${CYAN}Esperando servicio web...${NC}"
for i in $(seq 1 24); do
  sleep 5
  if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:80" 2>/dev/null | grep -qE "^(200|301|302)"; then
    echo -e "${GREEN}✓ CMS respondiendo en puerto 80${NC}"
    break
  fi
  echo -e "  Esperando web... (${i}/24)"
done

# ── Verificar estado ──
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
echo -e "${CYAN}║${NC}  Heap:   ${GREEN}${RMQ_HEAP} (RocketMQ)${NC}"
echo -e "${CYAN}║${NC}  Dir:    ${GREEN}${CMS_DIR}${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"

if [ "$INSTALL_EXIT" -ne 0 ]; then
  echo -e "${YELLOW}⚠ El instalador devolvió código ${INSTALL_EXIT}${NC}"
  echo -e "${YELLOW}  Revisa: cat /tmp/cms_install.log${NC}"
fi
