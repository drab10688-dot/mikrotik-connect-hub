#!/bin/bash
# ============================================
# CMS C-Data — Instalación automatizada en host
# Estrategia: instalar con puertos default, luego
# parchear docker-compose.yml con puertos correctos
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

# ── Limpieza total de intentos previos ──
echo -e "${YELLOW}Limpiando instalaciones anteriores de CMS...${NC}"
if [ -f "$CMS_DIR/docker-compose.yml" ]; then
  (cd "$CMS_DIR" && docker compose down -v --remove-orphans 2>/dev/null || true)
fi
# Forzar eliminación de todos los contenedores cms-*
for c in $(docker ps -aq --filter "name=cms-" 2>/dev/null); do
  docker rm -f "$c" 2>/dev/null || true
done
# Limpiar volúmenes huérfanos de CMS
docker volume ls -q 2>/dev/null | grep -i cms | xargs -r docker volume rm 2>/dev/null || true
echo -e "${GREEN}✓ Limpieza completa${NC}"

# ── Descargar instalador ──
mkdir -p "$CMS_DIR"
cd "$CMS_DIR"

echo -e "${YELLOW}Descargando instalador CMS C-Data v${CMS_VERSION}...${NC}"
curl -fsSL -o cms_install.sh "https://cms.s.cdatayun.com/cms_linux/cms_install.sh"
chmod +x cms_install.sh

# ── Ejecutar instalador con puertos default (sin modificar) ──
# Respondemos "n" a todas las preguntas de puertos para usar los defaults
# del instalador, luego parcheamos después.
echo -e "${YELLOW}Ejecutando instalador con puertos default...${NC}"

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
http://${VPS_IP}:80
EOF

set +e
bash cms_install.sh install --version "$CMS_VERSION" < /tmp/cms_answers.txt 2>&1 | tee /tmp/cms_install.log
INSTALL_EXIT=$?
set -e
rm -f /tmp/cms_answers.txt

# ── Esperar a que se genere docker-compose.yml ──
sleep 5

if [ ! -f "$CMS_DIR/docker-compose.yml" ]; then
  echo -e "${RED}Error: No se generó docker-compose.yml${NC}"
  echo -e "${RED}Revisa /tmp/cms_install.log${NC}"
  exit 1
fi

# ── Detener todo antes de parchear ──
echo -e "${YELLOW}Deteniendo contenedores CMS para reconfigurar puertos...${NC}"
cd "$CMS_DIR"
docker compose down 2>/dev/null || true

# ── Parchear puertos en docker-compose.yml ──
# OmniSync usa 3306 y 80; evitamos choques forzando puertos alternos del CMS
echo -e "${YELLOW}Parcheando puertos para evitar conflictos con OmniSync...${NC}"

CMS_COMPOSE_FILE="$CMS_DIR/docker-compose.yml"

# Soportar múltiples formatos de mapeo: con/sin comillas y con/sin /tcp
sed -i \
  -e 's/"3306:3306"/"3307:3306"/g' \
  -e "s/'3306:3306'/'3307:3306'/g" \
  -e 's/3306:3306\/tcp/3307:3306\/tcp/g' \
  -e 's/3306:3306/3307:3306/g' \
  -e 's/"6379:6379"/"6380:6379"/g' \
  -e "s/'6379:6379'/'6380:6379'/g" \
  -e 's/6379:6379\/tcp/6380:6379\/tcp/g' \
  -e 's/6379:6379/6380:6379/g' \
  -e 's/"80:80"/"18080:80"/g' \
  -e "s/'80:80'/'18080:80'/g" \
  -e 's/80:80\/tcp/18080:80\/tcp/g' \
  -e 's/80:80/18080:80/g' \
  -e 's/"80:8080"/"18080:8080"/g' \
  -e "s/'80:8080'/'18080:8080'/g" \
  -e 's/80:8080\/tcp/18080:8080\/tcp/g' \
  -e 's/80:8080/18080:8080/g' \
  "$CMS_COMPOSE_FILE"

# También parchear .env del CMS (si usa variables de puertos)
if [ -f "$CMS_DIR/.env" ]; then
  sed -Ei \
    -e 's|^(MYSQL_PORT\s*=\s*).*$|\13307|g' \
    -e 's|^(REDIS_PORT\s*=\s*).*$|\16380|g' \
    -e 's|^(NGINX_PORT\s*=\s*).*$|\118080|g' \
    -e "s|^CMS_URL=.*|CMS_URL=http://${VPS_IP}:18080|g" \
    -e "s|^DOMAIN=.*|DOMAIN=http://${VPS_IP}:18080|g" \
    "$CMS_DIR/.env" 2>/dev/null || true
fi

# Validación: no debe quedar 3306 publicado en host para el CMS
if grep -Eq '(^|[^0-9])3306:3306([^0-9]|$)' "$CMS_COMPOSE_FILE"; then
  echo -e "${RED}Error: El parche de puertos no se aplicó correctamente (sigue 3306:3306).${NC}"
  echo -e "${RED}Revisa $CMS_COMPOSE_FILE${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Puertos parcheados${NC}"

# ── Mostrar puertos finales ──
echo -e "${CYAN}Puertos configurados:${NC}"
echo -e "  MySQL CMS: 3307 (host) → 3306 (container)"
echo -e "  Redis CMS: 6380 (host) → 6379 (container)"
echo -e "  Web CMS:   18080 (host)"

# ── Iniciar CMS con puertos corregidos ──
echo -e "${YELLOW}Iniciando CMS C-Data con puertos corregidos...${NC}"
cd "$CMS_DIR"
docker compose up -d 2>&1

echo -e "${CYAN}Esperando estabilización (60s)...${NC}"
for i in $(seq 1 12); do
  sleep 5
  # Verificar si el puerto web ya responde
  if ss -lntp | grep -q ":18080 "; then
    echo -e "${GREEN}✓ CMS respondiendo en puerto 18080${NC}"
    break
  fi
  echo -e "  Esperando... (${i}/12)"
done

# ── Verificar estado ──
echo ""
echo -e "${CYAN}Contenedores CMS:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -i cms || echo "  (ninguno activo)"

# Verificar si MySQL del CMS está healthy
if docker ps --format "{{.Names}} {{.Status}}" | grep -q "cms-mysql.*healthy"; then
  echo -e "${GREEN}✓ MySQL CMS healthy${NC}"
else
  echo -e "${YELLOW}⚠ MySQL CMS aún iniciándose...${NC}"
  echo -e "${YELLOW}  Verificar con: docker logs cms-mysql --tail 20${NC}"
fi

if ss -lntp | grep -q ":18080 "; then
  echo -e "${GREEN}✓ CMS C-Data escuchando en puerto 18080${NC}"
else
  echo -e "${YELLOW}⚠ CMS aún no escucha en 18080${NC}"
  echo -e "${YELLOW}  Espera unos minutos y verifica:${NC}"
  echo -e "${YELLOW}    docker compose -f $CMS_DIR/docker-compose.yml logs --tail 30${NC}"
  echo -e "${YELLOW}    ss -lntp | grep 18080${NC}"
fi

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
echo -e "${CYAN}║${NC}  User:   ${GREEN}admin${NC}"
echo -e "${CYAN}║${NC}  Pass:   ${GREEN}admin${NC}"
echo -e "${CYAN}║${NC}  MySQL:  ${GREEN}puerto 3307${NC}"
echo -e "${CYAN}║${NC}  Dir:    ${GREEN}${CMS_DIR}${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"

if [ "$INSTALL_EXIT" -ne 0 ]; then
  echo -e "${YELLOW}⚠ El instalador devolvió código ${INSTALL_EXIT}. Revisa /tmp/cms_install.log${NC}"
fi
