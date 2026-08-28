#!/bin/bash
# ============================================
# CMS C-Data — Instalación NO interactiva
# Integrado al stack OmniSync (puertos alternos)
# ============================================

set -Eeuo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

CMS_DIR="/opt/cms-cdata"
CMS_VERSION="${CMS_VERSION:-4.5.14}"
VPS_IP=$(curl -4 -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
INSTALL_LOG="/var/log/omnisync-cms-install.log"
CURRENT_STAGE="inicio"

on_error() {
  local exit_code=$?
  local line_no="${BASH_LINENO[0]:-desconocida}"
  echo -e "${RED}✗ Falló la instalación en la etapa '${CURRENT_STAGE}' (línea ${line_no}, código ${exit_code}).${NC}" >&2
  echo -e "${YELLOW}  Comando: ${BASH_COMMAND}${NC}" >&2
  echo -e "${YELLOW}  Diagnóstico guardado en: ${INSTALL_LOG}${NC}" >&2
  if command -v docker >/dev/null 2>&1; then
    {
      echo ""
      echo "===== diagnóstico automático $(date -Is) ====="
      echo "Etapa: ${CURRENT_STAGE}; línea: ${line_no}; código: ${exit_code}; comando: ${BASH_COMMAND}"
      docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>&1 || true
      if [ -f "${CMS_DIR}/docker-compose.yml" ]; then
        (cd "${CMS_DIR}" && docker compose ps 2>&1) || true
      fi
      for container in cms-mysql cms-redis cms-rmqnamesrv cms-rmqbroker cms-acs cms-stun cms-ftp cms-boot cms-nginx; do
        docker logs --tail 30 "$container" 2>&1 || true
      done
    } >>"${INSTALL_LOG}" 2>&1
  fi
  exit "$exit_code"
}

trap on_error ERR

# ── TR-069 / MQTT por WireGuard ──
# Las ONUs alcanzan el VPS por el túnel (MikroTik ↔ WireGuard), no por la IP
# pública: mucho menos latencia y sin depender de NAT/STUN.
# Puedes forzar otra IP con ACS_HOST=<ip>.
WG_IP="${WG_IP:-10.13.13.1}"
ACS_HOST="${ACS_HOST:-$WG_IP}"

# Tipo de tenant: isp (un solo ISP) o multi (revender a otros ISPs)
CMS_TENANT_TYPE="${CMS_TENANT_TYPE:-isp}"

purge_uisp() {
  echo -e "${YELLOW}Eliminando UISP (Ubiquiti) si está instalado...${NC}"
  systemctl stop unms.service >/dev/null 2>&1 || true
  systemctl disable unms.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/unms.service >/dev/null 2>&1 || true
  for c in $(docker ps -aq --filter "name=unms" 2>/dev/null) $(docker ps -aq --filter "name=uisp" 2>/dev/null); do
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
  docker volume ls -q 2>/dev/null | grep -Ei 'unms|uisp' | xargs -r docker volume rm >/dev/null 2>&1 || true
  rm -rf /home/unms >/dev/null 2>&1 || true
  systemctl daemon-reload >/dev/null 2>&1 || true
  echo -e "${GREEN}✓ UISP eliminado${NC}"
}

normalize_cms_channels() {
  echo -e "${YELLOW}Normalizando canales TR-069/MQTT del CMS (host: ${ACS_HOST})...${NC}"
  if docker exec cms-mysql sh -c "mysql -uroot -p\"\${MYSQL_ROOT_PASSWORD}\" --default-character-set=utf8mb4 ccssx_boot -e \"UPDATE iot_channel SET channel_url='${ACS_HOST}:9909/v1/acs', channel_port=9909 WHERE channel_id=1; UPDATE iot_channel SET channel_url='${ACS_HOST}', channel_port=1883 WHERE channel_id=2;\""; then
    docker exec cms-redis redis-cli FLUSHALL >/dev/null 2>&1 || true
    docker restart cms-boot >/dev/null 2>&1 || true
    echo -e "${GREEN}✓ Canales del CMS apuntando a ${ACS_HOST} (WireGuard)${NC}"
  else
    echo -e "${YELLOW}⚠ No se pudo normalizar iot_channel automáticamente${NC}"
  fi
}

wait_mysql() {
  echo -e "${CYAN}Esperando MySQL del CMS...${NC}"
  for i in $(seq 1 60); do
    if docker exec -i cms-mysql sh -c 'mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" --default-character-set=utf8mb4 ccssx_boot -BN -e "select 1"' &>/dev/null; then
      echo -e "${GREEN}✓ MySQL listo${NC}"
      return 0
    fi
    sleep 3
    echo -e "  Esperando MySQL... (${i}/60)"
  done
  echo -e "${RED}✗ MySQL no respondió a tiempo${NC}"
  return 1
}

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║   CMS C-Data — Instalador no interactivo     ║"
echo "║   Integrado con OmniSync                     ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Ejecuta como root (sudo)${NC}"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo -e "${RED}Error: Docker no está instalado. Instala primero el stack OmniSync.${NC}"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo -e "${RED}Error: falta Docker Compose v2 ('docker compose').${NC}"
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo -e "${RED}Error: falta openssl, necesario para generar credenciales seguras.${NC}"
  exit 1
fi

# ── Tipo de tenant (pregunta solo si hay TTY; por defecto isp) ──
if [ -t 0 ] && [ -e /dev/tty ]; then
  echo -e "${YELLOW}¿Tipo de instalación?${NC}  isp = un solo ISP | multi = multi-tenant"
  read -t 30 -p "Tipo de tenant [multi/isp] (${CMS_TENANT_TYPE}): " _ans < /dev/tty || true
  CMS_TENANT_TYPE=${_ans:-$CMS_TENANT_TYPE}
fi
if [[ "$CMS_TENANT_TYPE" != "multi" && "$CMS_TENANT_TYPE" != "isp" ]]; then
  echo -e "${RED}Opción inválida '${CMS_TENANT_TYPE}'. Usa 'multi' o 'isp'${NC}"
  exit 1
fi
echo -e "${GREEN}→ Tipo seleccionado: ${CMS_TENANT_TYPE}${NC}"

# ── Quitar UISP (ya no forma parte del stack) ──
CURRENT_STAGE="eliminación de UISP"
purge_uisp

# ── Limpieza de intentos previos ──
CURRENT_STAGE="limpieza de instalación anterior"
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

# ── Descargar paquete oficial ──
CURRENT_STAGE="descarga y extracción del paquete oficial"
mkdir -p "$CMS_DIR"
cd "$CMS_DIR"

echo -e "${YELLOW}Descargando CMS v${CMS_VERSION} (paquete oficial)...${NC}"
curl -fsSL -o cms.tar "https://cms.s.cdatayun.com/cms_linux/stable/cms_v${CMS_VERSION}_linux.tar"
tar -xf cms.tar
rm -f cms.tar
for required_file in docker-compose.yml cms_init.sh cms.sh; do
  if [ ! -s "$required_file" ]; then
    echo -e "${RED}El paquete oficial está incompleto: falta ${required_file}.${NC}"
    exit 1
  fi
done
chmod +x cms.sh 2>/dev/null || true
chmod +x -R script 2>/dev/null || true
echo -e "${GREEN}✓ Paquete descargado${NC}"

# ── Escribir .env con puertos alternos (sin preguntas) ──
CURRENT_STAGE="generación de configuración"
# Puertos elegidos para coexistir con OmniSync:
#   MySQL 3307 (OmniSync/MariaDB usa 3306) | Redis 6380 | Web 18080/18443
#   STUN 13478/UDP (coturn de OmniSync ya usa 3478)
# Un solo proceso, sin tuberías: evita por completo SIGPIPE con pipefail.
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 16)
if [ -z "$MYSQL_ROOT_PASSWORD" ]; then
  echo -e "${RED}No se pudo generar la contraseña de MySQL.${NC}"
  exit 1
fi
cat > .env << EOF
VOLUME_PATH=./

REDIS_VERSION=7.2.3.1
REDIS_PORT=6380

EMQX_VERSION=5.6.0.1
EMQX_PORT=1883

ROCKET_MQ_VERSION=5.2.0
ROCKET_MQ_NAMESRV_PORT=9876

MYSQL_VERSION=${CMS_VERSION}
MYSQL_PORT=3307
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}

CMS_ACS_VERSION=${CMS_VERSION}
CMS_ACS_PORT=9909
CMS_ACS_JMX_ENABLE=false
CMS_ACS_JMX_PORT=9901

CMS_STUN_VERSION=${CMS_VERSION}
CMS_STUN_PORT=13478

CMS_FTP_VERSION=${CMS_VERSION}
CMS_FTP_PORT=21

CMS_BOOT_VERSION=${CMS_VERSION}
CMS_BOOT_PORT=9999
CMS_BOOT_JMX_ENABLE=false
CMS_BOOT_JMX_PORT=9991

NGINX_VERSION=${CMS_VERSION}
NGINX_PORT=18080
NGINX_PORT_HTTPS=18443
NGINX_PORT_MQTTS=8883

CMS_HOST=${VPS_IP}
EOF
echo -e "${GREEN}✓ .env generado (MySQL 3307, Redis 6380, Web 18080, STUN 13478)${NC}"

# Detectar errores de sintaxis/variables del paquete antes de crear contenedores.
docker compose config --quiet

# Directorios de datos con permisos que esperan los contenedores
mkdir -p data/emqx log/emqx log/redis log/nginx
chmod -R 777 data/emqx log/emqx log/redis log/nginx

# ── Fase 1: solo MySQL para inicializar tenant ──
CURRENT_STAGE="inicio de MySQL"
echo -e "${YELLOW}Iniciando MySQL del CMS...${NC}"
docker compose up -d mysql
wait_mysql

# ── Inicializar tenant por SQL directo (equivale al cms_init.sh interactivo) ──
CURRENT_STAGE="inicialización del tenant ${CMS_TENANT_TYPE}"
echo -e "${YELLOW}Inicializando tenant '${CMS_TENANT_TYPE}' (host: ${ACS_HOST})...${NC}"
docker exec -i cms-mysql sh -c 'sed -i "s|{tenant_host}|'"${ACS_HOST}"'|g" /init_tenant/'"${CMS_TENANT_TYPE}"'.sql'
docker exec -i cms-mysql sh -c 'mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" --default-character-set=utf8mb4 ccssx_boot -e "source /init_tenant/'"${CMS_TENANT_TYPE}"'.sql"'
docker exec -i cms-mysql sh -c 'mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" --default-character-set=utf8mb4 ccssx_boot -e "update cms_global_config set initialized_flag = 1"'
# CMS_HOST queda como IP pública para la web; el tenant host queda en WireGuard
echo -e "${GREEN}✓ Tenant inicializado${NC}"

# ── Fase 2: stack completo ──
CURRENT_STAGE="inicio del stack completo"
echo -e "${YELLOW}Levantando stack completo del CMS (esto tarda 2-5 min)...${NC}"
docker compose down
docker compose up -d

# ── Esperar servicio web ──
CURRENT_STAGE="espera del servicio web"
echo -e "${CYAN}Esperando servicio web en puerto 18080...${NC}"
for i in $(seq 1 36); do
  sleep 5
  if ss -lntp 2>/dev/null | grep -q ":18080 "; then
    echo -e "${GREEN}✓ CMS respondiendo en puerto 18080${NC}"
    break
  fi
  echo -e "  Esperando web... (${i}/36)"
done

# ── Normalizar canales TR-069/MQTT hacia WireGuard ──
normalize_cms_channels

# ── Firewall: web público, TR-069/MQTT solo por el túnel ──
if command -v ufw >/dev/null 2>&1; then
  ufw allow 18080/tcp >/dev/null 2>&1 || true
  ufw allow in on wg0 to any port 9909 >/dev/null 2>&1 || true
  ufw allow in on wg0 to any port 1883 >/dev/null 2>&1 || true
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

# ── Estado final ──
echo ""
echo -e "${CYAN}Contenedores CMS:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -i cms || echo "  (ninguno activo)"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   CMS C-Data — Instalación finalizada        ║${NC}"
echo -e "${CYAN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║${NC}  URL:    ${GREEN}http://${VPS_IP}:18080${NC}"
echo -e "${CYAN}║${NC}  Tipo:   ${GREEN}${CMS_TENANT_TYPE}${NC}"
echo -e "${CYAN}║${NC}  User:   ${GREEN}root${NC}"
echo -e "${CYAN}║${NC}  Pass:   ${GREEN}adminisp${NC} ${YELLOW}(cámbiala al entrar)${NC}"
echo -e "${CYAN}║${NC}  MySQL:  ${GREEN}puerto 3307${NC} (clave en ${CMS_DIR}/.env)"
echo -e "${CYAN}║${NC}  Redis:  ${GREEN}puerto 6380${NC}"
echo -e "${CYAN}║${NC}  Dir:    ${GREEN}${CMS_DIR}${NC}"
echo -e "${CYAN}║${NC}  TR-069: ${GREEN}http://${ACS_HOST}:9909/v1/acs${NC} (WireGuard)"
echo -e "${CYAN}║${NC}  MQTT:   ${GREEN}${ACS_HOST}:1883${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo -e "${YELLOW}Configura las ONUs/OLT con ACS URL http://${ACS_HOST}:9909/v1/acs${NC}"
echo -e "${YELLOW}(la ruta va por el túnel WireGuard, no por la IP pública)${NC}"
echo -e "${YELLOW}Nota: el CMS (Java) tarda 2-5 min en mostrar la interfaz completa.${NC}"
