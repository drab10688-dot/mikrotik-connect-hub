#!/bin/bash
# ============================================
# CMS C-Data — Instalación con beryindo/cms
# Integrado al stack OmniSync (puertos alternos)
# ============================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

CMS_DIR="/opt/cms-cdata"
VPS_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
CMS_SKIP_TENANT_PROMPT="${CMS_SKIP_TENANT_PROMPT:-0}"
CMS_TENANT_TYPE_DEFAULT="${CMS_TENANT_TYPE_DEFAULT:-isp}"

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
echo "║   CMS C-Data — Instalador (beryindo/cms)     ║"
echo "║   Integrado con OmniSync                      ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Ejecuta como root (sudo)${NC}"
  exit 1
fi

# ── Tipo de tenant ──
echo ""
echo -e "${YELLOW}¿Qué tipo de instalación deseas?${NC}"
echo -e "  ${GREEN}isp${NC}   — Un solo ISP (tu empresa)"
echo -e "  ${GREEN}multi${NC} — Multi-tenant (revender servicio a otros ISPs)"

if [ "$CMS_SKIP_TENANT_PROMPT" = "1" ]; then
  CMS_TENANT_TYPE="$CMS_TENANT_TYPE_DEFAULT"
  echo -e "${CYAN}→ Tipo preseleccionado: ${CMS_TENANT_TYPE}${NC}"
else
  read -p "Tipo de tenant [multi/isp] (isp): " CMS_TENANT_TYPE < /dev/tty
  CMS_TENANT_TYPE=${CMS_TENANT_TYPE:-$CMS_TENANT_TYPE_DEFAULT}
fi

if [[ "$CMS_TENANT_TYPE" != "multi" && "$CMS_TENANT_TYPE" != "isp" ]]; then
  echo -e "${RED}Opción inválida. Usa 'multi' o 'isp'${NC}"
  exit 1
fi

echo -e "${GREEN}→ Tipo seleccionado: ${CMS_TENANT_TYPE}${NC}"

# ── Limpieza de intentos previos ──
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

# Puertos alternos para coexistir con OmniSync:
# MySQL: 3307 (OmniSync usa 3306)
# Redis: 6380 (OmniSync/MariaDB)
# Web/Nginx: 18080 (OmniSync usa 80)
# emqx, acs, stun, cms: sin conflicto, puertos default
echo -e "${YELLOW}Ejecutando instalador con puertos alternos para OmniSync...${NC}"
echo -e "${CYAN}  MySQL: 3307 | Redis: 6380 | Web: 18080 | Resto: default${NC}"

# Respuestas al instalador interactivo:
# 1. mysql port modify? y → 3307
# 2. redis port modify? y → 6380
# 3. emqx port modify? n
# 4. acs port modify? n
# 5. stun port modify? n
# 6. cms service port modify? n
# 7. nginx port modify? y → 18080
# 8. data volume modify? n
# 9. tenant type: isp/multi
# 10. tenant host: IP
cat > /tmp/cms_answers.txt << EOF
y
3307
y
6380
n
n
n
n
y
18080
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
echo -e "${CYAN}Esperando servicio web en puerto 18080...${NC}"
for i in $(seq 1 12); do
  sleep 5
  if ss -lntp | grep -q ":18080 "; then
    echo -e "${GREEN}✓ CMS respondiendo en puerto 18080${NC}"
    break
  fi
  echo -e "  Esperando web... (${i}/12)"
done

# ── Estado ──
echo ""
echo -e "${CYAN}Contenedores CMS:${NC}"
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
echo -e "${CYAN}║${NC}  URL:    ${GREEN}http://${VPS_IP}:18080${NC}"
echo -e "${CYAN}║${NC}  Tipo:   ${GREEN}${CMS_TENANT_TYPE}${NC}"
echo -e "${CYAN}║${NC}  User:   ${GREEN}root${NC}"
echo -e "${CYAN}║${NC}  Pass:   ${GREEN}adminisp${NC}"
echo -e "${CYAN}║${NC}  MySQL:  ${GREEN}puerto 3307${NC}"
echo -e "${CYAN}║${NC}  Redis:  ${GREEN}puerto 6380${NC}"
echo -e "${CYAN}║${NC}  Dir:    ${GREEN}${CMS_DIR}${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"

if [ "$INSTALL_EXIT" -ne 0 ]; then
  echo -e "${YELLOW}⚠ Revisa /tmp/cms_install.log si hay problemas${NC}"
fi
