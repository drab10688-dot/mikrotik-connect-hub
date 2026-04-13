#!/bin/bash
# ============================================
# OmniSync ISP Manager - Instalador VPS
# Compatible: Ubuntu 20.04, 22.04, 24.04
#             Debian 11, 12
# ============================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_URL="https://github.com/drab10688-dot/mikrotik-connect-hub.git"
INSTALL_DIR="/opt/omnisync"

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║       OmniSync ISP Manager Installer         ║"
echo "║       Docker Stack - All-in-One               ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Compatible:                                  ║"
echo "║    • Ubuntu 20.04 / 22.04 / 24.04             ║"
echo "║    • Debian 11 / 12                           ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Check root ───────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Ejecuta este script como root (sudo)${NC}"
  exit 1
fi

# ─── Check OS ─────────────────────────────────────
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_NAME=$ID
  OS_VERSION=$VERSION_ID
  echo -e "${GREEN}Sistema detectado: $PRETTY_NAME${NC}"
  
  COMPATIBLE=false
  if [ "$OS_NAME" = "ubuntu" ]; then
    case "$OS_VERSION" in
      20.04|22.04|24.04) COMPATIBLE=true ;;
    esac
  elif [ "$OS_NAME" = "debian" ]; then
    case "$OS_VERSION" in
      11|12) COMPATIBLE=true ;;
    esac
  fi
  
  if [ "$COMPATIBLE" = false ]; then
    echo -e "${RED}⚠ Sistema no soportado oficialmente: $PRETTY_NAME${NC}"
    read -p "¿Deseas continuar de todos modos? (s/N): " FORCE_INSTALL < /dev/tty
    if [ "$FORCE_INSTALL" != "s" ] && [ "$FORCE_INSTALL" != "S" ]; then
      exit 1
    fi
  fi
else
  echo -e "${YELLOW}⚠ No se pudo detectar el sistema operativo${NC}"
fi

# ─── Check existing installation ──────────────────
handle_existing_installation() {
  if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    echo ""
    echo -e "${YELLOW}⚠ OmniSync ya está instalado en este VPS${NC}"
    echo ""
    echo "  1) Reinstalar (elimina todo y vuelve a instalar)"
    echo "  2) Actualizar (descarga código nuevo, mantiene datos)"
    echo "  3) Desinstalar (elimina todo completamente)"
    echo "  4) Cancelar"
    echo ""
    read -p "Selecciona una opción [1-4]: " OPTION < /dev/tty

    case "$OPTION" in
      1)
        echo -e "${YELLOW}Deteniendo servicios...${NC}"
        cd "$INSTALL_DIR" && docker compose down -v 2>/dev/null || true
        cd /root
        rm -rf "$INSTALL_DIR"
        echo -e "${GREEN}Instalación anterior eliminada ✓${NC}"
        ;;
      2)
        echo -e "${YELLOW}Actualizando archivos...${NC}"
        TEMP_DIR=$(mktemp -d)
        git clone --depth 1 "$REPO_URL" "$TEMP_DIR"
        # Backup .env
        cp "$INSTALL_DIR/.env" /tmp/omnisync-env-backup 2>/dev/null || true
        # Copy new stack files
        cp -r "$TEMP_DIR"/vps-stack/* "$INSTALL_DIR"/
        # Restore .env
        cp /tmp/omnisync-env-backup "$INSTALL_DIR/.env" 2>/dev/null || true

        # Rebuild frontend
        echo -e "${YELLOW}Recompilando panel web...${NC}"
        cd "$TEMP_DIR"
        echo "VITE_API_BASE_URL=/api" > .env.production
        npm install --legacy-peer-deps 2>/dev/null || npm install
        npm run build
        mkdir -p "$INSTALL_DIR/frontend/dist"
        rm -rf "$INSTALL_DIR/frontend/dist"/*
        cp -r dist/* "$INSTALL_DIR/frontend/dist"/

        # Regenerate radius configs from .env
        cd "$INSTALL_DIR"
        source .env 2>/dev/null || true
        sync_nuxbill_env_file "$INSTALL_DIR/.env"
        generate_radius_configs

        rm -rf "$TEMP_DIR" /tmp/omnisync-env-backup

        # Regenerate nuxbill init SQL
        generate_nuxbill_sql

        docker compose build --no-cache api phpnuxbill
        docker compose up -d --build
        sleep 10
        if ! ensure_mariadb_accounts; then
          echo -e "${RED}✗ Error crítico sincronizando MariaDB (nuxbill/radius)${NC}"
          echo -e "${YELLOW}Ejecuta: bash $INSTALL_DIR/repair-nuxbill-auth.sh${NC}"
          exit 1
        fi
        echo -e "${GREEN}✓ Actualización completada${NC}"
        VPS_IP=$(hostname -I | awk '{print $1}')
        echo -e "${GREEN}Panel: http://$VPS_IP${NC}"
        exit 0
        ;;
      3)
        echo -e "${RED}⚠ Esto eliminará TODOS los datos.${NC}"
        read -p "Escribe 'ELIMINAR' para confirmar: " CONFIRM < /dev/tty
        if [ "$CONFIRM" = "ELIMINAR" ]; then
          cd "$INSTALL_DIR" && docker compose down -v 2>/dev/null || true
          rm -rf "$INSTALL_DIR"
          echo -e "${GREEN}OmniSync desinstalado ✓${NC}"
        fi
        exit 0
        ;;
      *)
        exit 0
        ;;
    esac
  fi
}

# ═══════════════════════════════════════════════════
# Helper functions
# ═══════════════════════════════════════════════════

generate_radius_configs() {
  local radius_pw="${RADIUS_DB_PASSWORD:-changeme_radius}"
  local radius_secret="${RADIUS_SECRET:-testing123}"
  
  cat > "$INSTALL_DIR/radius/mods-enabled/sql" << SQLEOF
sql {
    dialect = "mysql"
    driver = "rlm_sql_mysql"

    server = "mariadb"
    port = 3306
    login = "radius"
    password = "${radius_pw}"

    radius_db = "radius"

    acct_table1 = "radacct"
    acct_table2 = "radacct"
    postauth_table = "radpostauth"
    authcheck_table = "radcheck"
    groupcheck_table = "radgroupcheck"
    authreply_table = "radreply"
    groupreply_table = "radgroupreply"
    usergroup_table = "radusergroup"

    delete_stale_sessions = yes
    pool {
        start = 5
        min = 3
        max = 10
        spare = 3
        uses = 0
        lifetime = 0
        idle_timeout = 60
    }

    read_clients = yes
    client_table = "nas"

    group_attribute = "SQL-Group"

    sql_user_name = "%{%{Stripped-User-Name}:-%{User-Name}}"
}
SQLEOF

  cat > "$INSTALL_DIR/radius/clients.conf" << CLIENTEOF
client mikrotik {
    ipaddr = 0.0.0.0/0
    secret = ${radius_secret}
    shortname = mikrotik
    nastype = other
}
CLIENTEOF
}

resolve_nuxbill_password() {
  if [ -n "${NUXBILL_DB_PASSWORD:-}" ]; then
    echo "${NUXBILL_DB_PASSWORD}"
  elif [ -n "${NUXBILL_DB_PASS:-}" ]; then
    echo "${NUXBILL_DB_PASS}"
  else
    echo "changeme_nuxbill"
  fi
}

sync_nuxbill_env_file() {
  local env_file="${1:-$INSTALL_DIR/.env}"
  local nuxbill_pw
  local escaped_pw
  local current_app_url normalized_app_url escaped_app_url vps_ip

  nuxbill_pw="$(resolve_nuxbill_password)"
  NUXBILL_DB_PASSWORD="$nuxbill_pw"
  NUXBILL_DB_PASS="$nuxbill_pw"

  [ -f "$env_file" ] || return 0

  escaped_pw="${nuxbill_pw//\\/\\\\}"
  escaped_pw="${escaped_pw//&/\\&}"

  if grep -q '^NUXBILL_DB_PASSWORD=' "$env_file"; then
    sed -i "s|^NUXBILL_DB_PASSWORD=.*|NUXBILL_DB_PASSWORD=${escaped_pw}|" "$env_file"
  else
    echo "NUXBILL_DB_PASSWORD=${nuxbill_pw}" >> "$env_file"
  fi

  if grep -q '^NUXBILL_DB_PASS=' "$env_file"; then
    sed -i "s|^NUXBILL_DB_PASS=.*|NUXBILL_DB_PASS=${escaped_pw}|" "$env_file"
  else
    echo "NUXBILL_DB_PASS=${nuxbill_pw}" >> "$env_file"
  fi

  vps_ip="$(hostname -I | awk '{print $1}')"
  current_app_url="${NUXBILL_APP_URL:-}"

  if [ -z "$current_app_url" ] && [ -f "$env_file" ]; then
    current_app_url="$(grep '^NUXBILL_APP_URL=' "$env_file" | cut -d'=' -f2- || true)"
  fi

  if [ -z "$current_app_url" ]; then
    normalized_app_url="http://${vps_ip}/nuxbill"
  else
    current_app_url="${current_app_url%/}"
    current_app_url="${current_app_url%/admin}"
    current_app_url="${current_app_url%/index.php}"

    if [[ "$current_app_url" == *"localhost:8080"* || "$current_app_url" == *"127.0.0.1:8080"* ]]; then
      normalized_app_url="http://${vps_ip}/nuxbill"
    elif [[ "$current_app_url" == *"/nuxbill"* ]]; then
      normalized_app_url="${current_app_url%%/nuxbill*}/nuxbill"
    elif [[ "$current_app_url" == *":8080" ]]; then
      normalized_app_url="${current_app_url%:8080}/nuxbill"
    else
      normalized_app_url="${current_app_url}/nuxbill"
    fi
  fi

  NUXBILL_APP_URL="$normalized_app_url"
  export NUXBILL_APP_URL

  escaped_app_url="${normalized_app_url//\\/\\\\}"
  escaped_app_url="${escaped_app_url//&/\\&}"

  if grep -q '^NUXBILL_APP_URL=' "$env_file"; then
    sed -i "s|^NUXBILL_APP_URL=.*|NUXBILL_APP_URL=${escaped_app_url}|" "$env_file"
  else
    echo "NUXBILL_APP_URL=${normalized_app_url}" >> "$env_file"
  fi
}

generate_nuxbill_sql() {
  local nuxbill_pw
  nuxbill_pw="$(resolve_nuxbill_password)"
  
  mkdir -p "$INSTALL_DIR/mariadb-init"
  cat > "$INSTALL_DIR/mariadb-init/02-nuxbill.sql" << NUXEOF
-- PHPNuxBill Database Initialization
CREATE DATABASE IF NOT EXISTS phpnuxbill CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS 'nuxbill'@'%' IDENTIFIED BY '${nuxbill_pw}';
GRANT ALL PRIVILEGES ON phpnuxbill.* TO 'nuxbill'@'%';
-- PHPNuxBill needs access to the radius database for its RADIUS module
GRANT ALL PRIVILEGES ON radius.* TO 'nuxbill'@'%';
FLUSH PRIVILEGES;
NUXEOF
}

ensure_mariadb_accounts() {
  local root_pw="${MYSQL_ROOT_PASSWORD:-changeme_mysql}"
  local radius_pw="${RADIUS_DB_PASSWORD:-changeme_radius}"
  local nuxbill_pw
  local root_args=()
  local auth_mode=""
  local container_root_pw=""
  nuxbill_pw="$(resolve_nuxbill_password)"

  echo -e "${YELLOW}Sincronizando usuarios MariaDB (radius/nuxbill)...${NC}"

  for _ in $(seq 1 25); do
    if [ -n "$root_pw" ] && docker exec omnisync-mariadb mariadb -uroot -p"${root_pw}" -e "SELECT 1;" >/dev/null 2>&1; then
      root_args=(-uroot -p"${root_pw}")
      auth_mode="password"
      break
    fi

    if [ -z "$container_root_pw" ]; then
      container_root_pw="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' omnisync-mariadb 2>/dev/null | awk -F= '/^MYSQL_ROOT_PASSWORD=/{sub(/^MYSQL_ROOT_PASSWORD=/, ""); print; exit}')"
    fi

    if [ -n "$container_root_pw" ] && [ "$container_root_pw" != "$root_pw" ] \
      && docker exec omnisync-mariadb mariadb -uroot -p"${container_root_pw}" -e "SELECT 1;" >/dev/null 2>&1; then
      root_pw="$container_root_pw"
      root_args=(-uroot -p"${root_pw}")
      auth_mode="password(container)"
      MYSQL_ROOT_PASSWORD="$root_pw"
      if [ -f "$INSTALL_DIR/.env" ]; then
        if grep -q '^MYSQL_ROOT_PASSWORD=' "$INSTALL_DIR/.env"; then
          sed -i "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=${root_pw}|" "$INSTALL_DIR/.env"
        else
          echo "MYSQL_ROOT_PASSWORD=${root_pw}" >> "$INSTALL_DIR/.env"
        fi
      fi
      break
    fi

    if docker exec omnisync-mariadb mariadb -uroot -e "SELECT 1;" >/dev/null 2>&1; then
      root_args=(-uroot)
      auth_mode="socket"
      break
    fi

    sleep 2
  done

  if [ -z "$auth_mode" ]; then
    echo -e "${YELLOW}⚠ No se pudo autenticar root en MariaDB (password/socket)${NC}"
    return 1
  fi

  docker exec omnisync-mariadb mariadb "${root_args[@]}" >/dev/null 2>&1 << SQL
CREATE DATABASE IF NOT EXISTS radius;
CREATE DATABASE IF NOT EXISTS phpnuxbill CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS 'radius'@'%' IDENTIFIED BY '${radius_pw}';
ALTER USER 'radius'@'%' IDENTIFIED BY '${radius_pw}';
GRANT ALL PRIVILEGES ON radius.* TO 'radius'@'%';
CREATE USER IF NOT EXISTS 'nuxbill'@'%' IDENTIFIED BY '${nuxbill_pw}';
ALTER USER 'nuxbill'@'%' IDENTIFIED BY '${nuxbill_pw}';
GRANT ALL PRIVILEGES ON phpnuxbill.* TO 'nuxbill'@'%';
GRANT ALL PRIVILEGES ON radius.* TO 'nuxbill'@'%';
FLUSH PRIVILEGES;
SQL

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}Usuarios MariaDB sincronizados (root via ${auth_mode}) ✓${NC}"
    return 0
  fi

  echo -e "${YELLOW}⚠ Falló la sincronización SQL de usuarios MariaDB${NC}"
  return 1
}

ensure_radius_schema() {
  local radius_pw="${RADIUS_DB_PASSWORD:-changeme_radius}"
  local schema_file="$INSTALL_DIR/radius/sql/schema.sql"

  [ -f "$schema_file" ] || {
    echo -e "${YELLOW}⚠ No existe $schema_file${NC}"
    return 1
  }

  echo -e "${YELLOW}Verificando tabla nas en base de datos radius...${NC}"

  local has_nas
  has_nas=$(docker exec omnisync-mariadb mariadb -uradius -p"${radius_pw}" -Nse \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='radius' AND table_name='nas';" 2>/dev/null || echo "0")

  if [ "$has_nas" != "1" ]; then
    echo -e "${YELLOW}→ Tabla nas no existe, importando schema radius...${NC}"
    docker exec -i omnisync-mariadb mariadb -uradius -p"${radius_pw}" radius < "$schema_file" 2>/dev/null || true

    has_nas=$(docker exec omnisync-mariadb mariadb -uradius -p"${radius_pw}" -Nse \
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='radius' AND table_name='nas';" 2>/dev/null || echo "0")
  fi

  if [ "$has_nas" = "1" ]; then
    echo -e "${GREEN}Tabla nas verificada ✓${NC}"
    return 0
  fi

  echo -e "${RED}✗ La tabla nas sigue sin existir${NC}"
  return 1
}

is_truthy() {
  case "${1,,}" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

start_optional_services() {
  # Servicios opcionales:
  # - CMS C-Data se instala/ejecuta en host con install-cms.sh
  # - Mikhmon y WireGuard se inician/detienen desde el panel de Servicios VPS
  echo -e "${CYAN}Servicios opcionales: CMS (host), Mikhmon (Docker), WireGuard (Docker)${NC}"
}

# Validate existing installation lifecycle actions (reinstall/update/uninstall)
handle_existing_installation

# ═══════════════════════════════════════════════════
# FASE 1: Dependencias del sistema
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 1/5: Instalando dependencias ═══${NC}"

# Git
if ! command -v git &> /dev/null; then
  apt-get update -qq && apt-get install -y -qq git curl
fi

# Docker
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}Instalando Docker...${NC}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo -e "${GREEN}Docker instalado ✓${NC}"
else
  echo -e "${GREEN}Docker ya instalado ✓${NC}"
fi

# Docker Compose
if ! docker compose version &> /dev/null; then
  apt-get update -qq && apt-get install -y -qq docker-compose-plugin
  echo -e "${GREEN}Docker Compose instalado ✓${NC}"
fi

# Node.js
if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}Instalando Node.js 20...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  echo -e "${GREEN}Node.js instalado ✓${NC}"
else
  echo -e "${GREEN}Node.js $(node -v) ya instalado ✓${NC}"
fi

echo -e "${GREEN}✓ Dependencias listas${NC}"

# ═══════════════════════════════════════════════════
# FASE 2: Descargar y compilar frontend PRIMERO
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 2/5: Descargando y compilando panel web ═══${NC}"

TEMP_DIR=$(mktemp -d)
git clone --depth 1 "$REPO_URL" "$TEMP_DIR"
echo -e "${GREEN}Código descargado ✓${NC}"

# Copy VPS stack files
mkdir -p "$INSTALL_DIR"
cp -r "$TEMP_DIR"/vps-stack/* "$INSTALL_DIR"/
echo -e "${GREEN}Archivos del stack copiados ✓${NC}"

# Build frontend
echo -e "${YELLOW}Compilando panel web (puede tardar unos minutos)...${NC}"
cd "$TEMP_DIR"
echo "VITE_API_BASE_URL=/api" > .env.production
npm install --legacy-peer-deps 2>/dev/null || npm install
npm run build

# Deploy frontend
FRONTEND_DIR="$INSTALL_DIR/frontend/dist"
mkdir -p "$FRONTEND_DIR"
rm -rf "$FRONTEND_DIR"/*
cp -r dist/* "$FRONTEND_DIR"/
echo -e "${GREEN}✓ Panel web compilado y desplegado${NC}"

cd /root
rm -rf "$TEMP_DIR"

# ═══════════════════════════════════════════════════
# FASE 3: Configuración
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 3/5: Configuración ═══${NC}"

cd "$INSTALL_DIR"

# Generate secure random secrets
JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)
RADIUS_DB_PASSWORD=$(openssl rand -hex 16)
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 16)
NUXBILL_DB_PASSWORD=$(openssl rand -hex 16)
NUXBILL_DB_PASS="${NUXBILL_DB_PASSWORD}"
RADIUS_SECRET=$(openssl rand -hex 16)
CMS_AUTOSTART=0

# ─── Preguntar si instalar CMS C-Data en el host ───
echo ""
echo -e "${YELLOW}¿Deseas instalar CMS C-Data (gestión OLT/ONU) en este servidor?${NC}"
echo -e "  Se instala directamente en el host (no en Docker de OmniSync)"
read -p "Instalar CMS C-Data? [y/n] (n): " INSTALL_CMS < /dev/tty
INSTALL_CMS=${INSTALL_CMS:-n}
CMS_TENANT_TYPE="isp"

if is_truthy "$INSTALL_CMS"; then
  read -p "Tipo de tenant CMS [isp/multi] (isp): " CMS_TENANT_TYPE < /dev/tty
  CMS_TENANT_TYPE=${CMS_TENANT_TYPE:-isp}

  if [[ "$CMS_TENANT_TYPE" != "multi" && "$CMS_TENANT_TYPE" != "isp" ]]; then
    echo -e "${RED}Opción inválida para CMS. Usa 'multi' o 'isp'${NC}"
    exit 1
  fi
fi
echo ""
echo -e "${YELLOW}Configuración MikroTik (opcional, se puede configurar desde el panel):${NC}"
read -p "Host/IP del MikroTik (Enter para omitir): " MIKROTIK_HOST < /dev/tty
MIKROTIK_HOST=${MIKROTIK_HOST:-}
if [ -n "$MIKROTIK_HOST" ]; then
  read -p "Puerto API REST (443): " MIKROTIK_PORT < /dev/tty
  MIKROTIK_PORT=${MIKROTIK_PORT:-443}
  read -p "Usuario MikroTik (admin): " MIKROTIK_USER < /dev/tty
  MIKROTIK_USER=${MIKROTIK_USER:-admin}
  read -sp "Contraseña MikroTik: " MIKROTIK_PASS < /dev/tty
  echo ""
else
  MIKROTIK_PORT=443
  MIKROTIK_USER=""
  MIKROTIK_PASS=""
  echo -e "${CYAN}→ Podrás agregar dispositivos MikroTik desde el panel web${NC}"
fi

VPS_IP=$(hostname -I | awk '{print $1}')

# Create .env with actual passwords
cat > .env << EOF
# Auto-generated - $(date)
DB_NAME=omnisync
DB_USER=omnisync
DB_PASSWORD=${DB_PASSWORD}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d
MIKROTIK_HOST=${MIKROTIK_HOST}
MIKROTIK_PORT=${MIKROTIK_PORT}
MIKROTIK_USER=${MIKROTIK_USER}
MIKROTIK_PASS=${MIKROTIK_PASS}
RADIUS_SECRET=${RADIUS_SECRET}
RADIUS_DB_PASSWORD=${RADIUS_DB_PASSWORD}
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
NUXBILL_DB_PASSWORD=${NUXBILL_DB_PASSWORD}
NUXBILL_DB_PASS=${NUXBILL_DB_PASS}
NUXBILL_APP_URL=http://${VPS_IP}/nuxbill
CMS_AUTOSTART=${CMS_AUTOSTART}
TZ=America/Bogota
EOF

sync_nuxbill_env_file ".env"

echo -e "${GREEN}.env generado ✓${NC}"

# Generate FreeRADIUS configs with real passwords (no env interpolation in mounted files)
generate_radius_configs
echo -e "${GREEN}FreeRADIUS configs generados ✓${NC}"

# Generate NuxBill init SQL with real password
generate_nuxbill_sql
echo -e "${GREEN}NuxBill init SQL generado ✓${NC}"

# Create required directories
mkdir -p nginx/certs
mkdir -p frontend/dist

# ── Instalar cloudflared (usado por la API Node.js para HTTPS) ──
echo -e "${YELLOW}Instalando cloudflared para HTTPS del portal cautivo...${NC}"
if ! command -v cloudflared &> /dev/null; then
  curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x /usr/local/bin/cloudflared
  echo -e "${GREEN}cloudflared instalado ✓${NC}"
else
  echo -e "${GREEN}cloudflared ya instalado ✓${NC}"
fi

# Firewall
if command -v ufw &> /dev/null; then
  echo -e "${YELLOW}Abriendo puertos en firewall...${NC}"
  ufw allow 80/tcp >/dev/null 2>&1
  ufw allow 443/tcp >/dev/null 2>&1
  ufw allow 1812/udp >/dev/null 2>&1
  ufw allow 1813/udp >/dev/null 2>&1
  ufw allow 18080/tcp >/dev/null 2>&1  # CMS C-Data UI
  ufw allow 51820/udp >/dev/null 2>&1  # WireGuard VPN
  echo -e "${GREEN}Puertos abiertos (80, 443, 1812/udp, 1813/udp, 18080, 51820/udp) ✓${NC}"
fi

# ═══════════════════════════════════════════════════
# FASE 4: Levantar servicios Docker
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 4/5: Iniciando servicios Docker ═══${NC}"

# Limpiar contenedores huérfanos o en conflicto antes de levantar
echo -e "${YELLOW}Limpiando contenedores anteriores si existen...${NC}"
docker compose down --remove-orphans 2>/dev/null || true
for cname in omnisync-mariadb omnisync-postgres omnisync-api omnisync-nginx omnisync-freeradius omnisync-phpnuxbill omnisync-mariadb-recover omnisync-cms-cdata omnisync-wireguard; do
  docker rm -f "$cname" 2>/dev/null || true
done
echo -e "${GREEN}✓ Contenedores limpios${NC}"

echo -e "${YELLOW}Construyendo contenedores (esto puede tardar varios minutos)...${NC}"

# Build only custom images (api + phpnuxbill) — CMS C-Data se instala aparte en el host
docker compose build --no-cache api phpnuxbill

# Start core services (optional services use restart: "no" and are managed from UI)
docker compose up -d 2>&1 | tail -5

# Wait for services to stabilize
echo -e "${YELLOW}Esperando 20 segundos para estabilización...${NC}"
sleep 20

# Auto-recuperación rápida si PHPNuxBill quedó caído (evita 502 en /nuxbill)
if ! docker ps --format '{{.Names}}' | grep -q '^omnisync-phpnuxbill$'; then
  echo -e "${YELLOW}PHPNuxBill no está arriba, reintentando arranque...${NC}"
  docker compose up -d --build phpnuxbill
  sleep 12
fi

if ! ensure_mariadb_accounts; then
  echo -e "${RED}✗ Error crítico sincronizando MariaDB (nuxbill/radius)${NC}"
  echo -e "${YELLOW}Ejecuta: bash $INSTALL_DIR/repair-nuxbill-auth.sh${NC}"
  exit 1
fi

# Import RADIUS schema (tabla nas) si falta
ensure_radius_schema || true

# ── Migrate PostgreSQL schema (nuevas tablas en instalaciones existentes) ──
echo -e "${YELLOW}Verificando migraciones PostgreSQL...${NC}"
sleep 5
docker exec omnisync-postgres psql -U "${DB_USER:-omnisync}" -d "${DB_NAME:-omnisync}" -c "
CREATE TABLE IF NOT EXISTS portal_ads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, description TEXT, image_url TEXT, link_url TEXT,
  advertiser_name TEXT NOT NULL, advertiser_phone TEXT, advertiser_email TEXT,
  position TEXT DEFAULT 'banner', is_active BOOLEAN DEFAULT true, priority INTEGER DEFAULT 0,
  start_date DATE, end_date DATE, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
  monthly_fee NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_ads_mikrotik ON portal_ads(mikrotik_id);
CREATE INDEX IF NOT EXISTS idx_portal_ads_active ON portal_ads(is_active, mikrotik_id);
" 2>/dev/null && echo -e "${GREEN}✓ Migraciones PostgreSQL OK${NC}" || echo -e "${YELLOW}⚠ Migraciones PostgreSQL skip (tabla ya existe)${NC}"

# Add missing columns to mikrotik_devices for existing installations
docker exec omnisync-postgres psql -U "${DB_USER:-omnisync}" -d "${DB_NAME:-omnisync}" -c "
ALTER TABLE mikrotik_devices ADD COLUMN IF NOT EXISTS latitude TEXT;
ALTER TABLE mikrotik_devices ADD COLUMN IF NOT EXISTS longitude TEXT;
" 2>/dev/null && echo -e "${GREEN}✓ Columnas mikrotik_devices actualizadas${NC}" || true

# Reiniciar PHPNuxBill y FreeRADIUS para que tomen las tablas recién creadas
echo -e "${YELLOW}Reiniciando PHPNuxBill y FreeRADIUS...${NC}"
docker compose restart phpnuxbill freeradius
sleep 5

# Servicios opcionales disponibles desde el panel
start_optional_services
sleep 5

# ─── Instalar CMS C-Data en el host si el usuario lo solicitó ───
if is_truthy "$INSTALL_CMS"; then
  echo ""
  echo -e "${CYAN}═══ Instalando CMS C-Data en el host ═══${NC}"
  if [ -f "$INSTALL_DIR/install-cms.sh" ]; then
    if ! CMS_SKIP_TENANT_PROMPT=1 CMS_TENANT_TYPE_DEFAULT="$CMS_TENANT_TYPE" CMS_INSTALL_TIMEOUT=1200 bash "$INSTALL_DIR/install-cms.sh"; then
      echo -e "${YELLOW}⚠ La instalación de CMS no finalizó correctamente, OmniSync seguirá activo.${NC}"
      echo -e "${YELLOW}  Reintentar manualmente: CMS_TENANT_TYPE_DEFAULT=$CMS_TENANT_TYPE bash $INSTALL_DIR/install-cms.sh${NC}"
    fi
  else
    echo -e "${RED}Script install-cms.sh no encontrado en $INSTALL_DIR${NC}"
    echo -e "${YELLOW}Puedes instalarlo después con: bash $INSTALL_DIR/install-cms.sh${NC}"
  fi
fi

# ── Configurar red WireGuard para acceso API a MikroTiks remotos ──
setup_wireguard_networking() {
  if ! docker ps --format '{{.Names}}' | grep -q '^omnisync-wireguard$'; then
    echo -e "${CYAN}ℹ WireGuard no activo, omitiendo configuración de red VPN${NC}"
    return 0
  fi

  echo -e "${YELLOW}Configurando red VPN para acceso a MikroTiks remotos...${NC}"

  # Conectar WireGuard a la red del stack si no lo está
  docker network connect omnisync_omnisync-net omnisync-wireguard 2>/dev/null || true

  # Obtener IP del contenedor WireGuard en la red del stack
  local WG_IP
  WG_IP=$(docker inspect omnisync-wireguard --format '{{range $k,$v := .NetworkSettings.Networks}}{{if eq $k "omnisync_omnisync-net"}}{{$v.IPAddress}}{{end}}{{end}}' 2>/dev/null)

  if [ -z "$WG_IP" ]; then
    WG_IP=$(docker inspect omnisync-wireguard --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' 2>/dev/null | awk '{print $NF}')
  fi

  if [ -n "$WG_IP" ]; then
    # Agregar ruta estática en el contenedor API
    docker exec omnisync-api ip route replace 10.13.13.0/24 via "$WG_IP" 2>/dev/null && \
      echo -e "${GREEN}✓ Ruta VPN configurada (10.13.13.0/24 via $WG_IP)${NC}" || \
      echo -e "${YELLOW}⚠ No se pudo configurar ruta VPN${NC}"

    # Configurar iptables en WireGuard para forwarding
    docker exec omnisync-wireguard sh -c '
      iptables -C FORWARD -i eth0 -o wg0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i eth0 -o wg0 -j ACCEPT
      iptables -C FORWARD -i wg0 -o eth0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i wg0 -o eth0 -j ACCEPT
      iptables -t nat -C POSTROUTING -s 172.16.0.0/12 -o wg0 -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 172.16.0.0/12 -o wg0 -j MASQUERADE
    ' 2>/dev/null && \
      echo -e "${GREEN}✓ Forwarding VPN configurado${NC}" || \
      echo -e "${YELLOW}⚠ No se pudo configurar forwarding VPN${NC}"
  else
    echo -e "${YELLOW}⚠ No se pudo detectar IP del contenedor WireGuard${NC}"
  fi
}

setup_wireguard_networking

# ═══════════════════════════════════════════════════
# FASE 5: Verificación de servicios
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 5/5: Verificando servicios ═══${NC}"

TOTAL_OK=0
TOTAL_FAIL=0
FAILED_SERVICES=""

check_service() {
  local name=$1
  local container=$2
  
  if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    local status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null)
    if [ "$status" = "running" ]; then
      echo -e "  ${GREEN}✓ $name${NC}"
      TOTAL_OK=$((TOTAL_OK + 1))
      return 0
    fi
  fi
  
  echo -e "  ${RED}✗ $name — FALLO${NC}"
  local svc_name=$(echo "$container" | sed 's/omnisync-//')
  echo -e "    ${YELLOW}Últimas líneas de log:${NC}"
  docker compose logs "$svc_name" --tail 5 2>/dev/null | sed 's/^/    /'
  TOTAL_FAIL=$((TOTAL_FAIL + 1))
  FAILED_SERVICES="$FAILED_SERVICES $name"
  return 1
}

check_service "PostgreSQL"  "omnisync-postgres"
check_service "API Backend" "omnisync-api"
check_service "Nginx"       "omnisync-nginx"
check_service "MariaDB"     "omnisync-mariadb"
check_service "FreeRADIUS"  "omnisync-freeradius"
check_service "PHPNuxBill"  "omnisync-phpnuxbill"

echo ""
echo -e "  Resultado: ${GREEN}$TOTAL_OK OK${NC} / ${RED}$TOTAL_FAIL fallidos${NC}"

# Check optional services (informational only)
echo ""
echo -e "${CYAN}Servicios opcionales:${NC}"
if ss -lntp | grep -q ":18080"; then
  echo -e "  ${GREEN}✓ CMS C-Data (ONUs) — activo en puerto 18080${NC}"
else
  echo -e "  ${YELLOW}ℹ CMS C-Data (ONUs) — no instalado. Ejecutar: bash $INSTALL_DIR/install-cms.sh${NC}"
fi
echo -e "  ${YELLOW}ℹ Mikhmon (Hotspot Monitor) — iniciar desde panel${NC}"
echo -e "  ${YELLOW}ℹ WireGuard (VPN) — iniciar desde panel${NC}"

# Test HTTP endpoints — wait for nginx to be ready
echo ""
echo -e "${CYAN}Probando endpoints HTTP (esperando que estén listos)...${NC}"

HTTP_OK=0
HTTP_FAIL=0
FAILED_ENDPOINTS=""

test_endpoint() {
  local name=$1
  local url=$2
  local service=${3:-}
  local status="000"
  local attempt

  # Retry up to 5 times with 3s delay
  for attempt in 1 2 3 4 5; do
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null) || true
    # If we got a real HTTP status, break
    if [ "$status" != "000" ] && [ -n "$status" ]; then
      break
    fi
    sleep 3
  done

  # Default to 000 if empty
  [ -z "$status" ] && status="000"

  if [ "$status" -ge 200 ] 2>/dev/null && [ "$status" -lt 400 ] 2>/dev/null; then
    echo -e "  ${GREEN}✓ $name — HTTP $status${NC}"
    HTTP_OK=$((HTTP_OK + 1))
  else
    echo -e "  ${RED}✗ $name — HTTP $status${NC}"
    HTTP_FAIL=$((HTTP_FAIL + 1))
    FAILED_ENDPOINTS="$FAILED_ENDPOINTS $name"

    if [ -n "$service" ]; then
      echo -e "    ${YELLOW}Últimas líneas de $service:${NC}"
      docker compose logs "$service" --tail 5 2>/dev/null | sed 's/^/    /'
    fi
  fi
}

test_endpoint "Panel Web"        "http://localhost" "nginx"
test_endpoint "API Health"       "http://localhost/api/health" "api"
test_endpoint "PHPNuxBill Admin" "http://localhost/nuxbill/admin" "phpnuxbill"

echo ""
echo -e "  Resultado HTTP: ${GREEN}$HTTP_OK OK${NC} / ${RED}$HTTP_FAIL fallidos${NC}"

if [ "$HTTP_FAIL" -gt 0 ]; then
  echo -e "${YELLOW}  Endpoints con fallo:${FAILED_ENDPOINTS}${NC}"
fi

if [ "$TOTAL_FAIL" -gt 0 ] || [ "$HTTP_FAIL" -gt 0 ]; then
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════════════════════╗"
  echo "║  ✗ Instalación incompleta: hay servicios/endpoints caídos"
  echo "║  Servicios:${FAILED_SERVICES}"
  echo "║  Endpoints:${FAILED_ENDPOINTS}"
  echo "║                                                          "
  echo "║  Revisar:   cd $INSTALL_DIR && docker compose ps         "
  echo "║  Ver logs:  cd $INSTALL_DIR && docker compose logs --tail=100"
  echo "║  Reintentar:cd $INSTALL_DIR && docker compose up -d --build"
  echo -e "╚══════════════════════════════════════════════════════════╝${NC}"
  exit 1
fi

# ═══════════════════════════════════════════════════
# Resumen final
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗"
echo "║           ¡Instalación completada! ✓                    ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║  🌐 ACCESOS                                               ║"
echo "║  ─────────────────────────────────────────────           ║"
echo "║  Panel Web:      http://$VPS_IP                            "
echo "║  API Health:     http://$VPS_IP/api/health                 "
echo "║  PHPNuxBill:     http://$VPS_IP/nuxbill/admin             "
echo "║  Portal Cautivo: http://$VPS_IP/portal                    "
echo "║                                                          ║"
echo "║  📡 SERVICIOS OPCIONALES                                  ║"
echo "║  ─────────────────────────────────────────────           ║"
echo "║  CMS C-Data (host): bash /opt/omnisync/install-cms.sh   ║"
echo "║  Mikhmon y WireGuard: Servicios VPS → Docker            ║"
echo "║                                                          ║"
echo "║  🔒 HTTPS (Cloudflare Tunnel)                             ║"
echo "║  ─────────────────────────────────────────────           ║"
echo "║  cloudflared: $(cloudflared --version 2>/dev/null | head -1 || echo 'instalado')"
echo "║                                                          ║"
echo "║  Para activar HTTPS:                                     ║"
echo "║  1. Ve a Servicios VPS → Cloudflare                      ║"
echo "║  2. Haz clic en 'Instalar cloudflared' (si no lo está)   ║"
echo "║  3. Haz clic en 'Iniciar' para obtener la URL HTTPS      ║"
echo "║                                                          ║"
echo "║  🔑 CREDENCIALES                                          ║"
echo "║  ─────────────────────────────────────────────           ║"
echo "║  OmniSync Panel:                                         ║"
echo "║    Email:    admin@omnisync.local                         ║"
echo "║    Pass:     admin123                                     ║"
echo "║                                                          ║"
echo "║  PHPNuxBill:                                             ║"
echo "║    Usuario:  admin                                       ║"
echo "║    Pass:     admin                                       ║"
echo "║                                                          ║"
echo "║  PostgreSQL:                                             ║"
echo "║    DB: omnisync | User: omnisync                         ║"
echo "║    Pass: ${DB_PASSWORD}                                  "
echo "║                                                          ║"
echo "║  MariaDB (RADIUS):                                      ║"
echo "║    DB: radius | User: radius                             ║"
echo "║    Pass: ${RADIUS_DB_PASSWORD}                           "
echo "║                                                          ║"
echo "║  📡 CONFIGURAR MIKROTIK HOTSPOT                          ║"
echo "║  ─────────────────────────────────────────────           ║"
echo "║  1. IP → Hotspot → Server Profiles → tu_perfil           ║"
echo "║     Login Page: http://$VPS_IP/portal                    ║"
echo "║                                                          ║"
echo "║  2. IP → Hotspot → Walled Garden → Add:                  ║"
echo "║     Dst. Host: $VPS_IP                                   ║"
echo "║     Action: allow                                        ║"
echo "║                                                          ║"
echo "║  3. Cuando actives el tunnel HTTPS, agregar también:     ║"
echo "║     Dst. Host: *.trycloudflare.com                       ║"
echo "║     Action: allow                                        ║"
echo "║                                                          ║"
echo "║  ⚠️  CAMBIA LAS CONTRASEÑAS DEL PANEL INMEDIATAMENTE     ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Comandos útiles:${NC}"
echo "  Estado:          cd $INSTALL_DIR && docker compose ps"
echo "  Logs:            cd $INSTALL_DIR && docker compose logs -f"
echo "  Reiniciar:       cd $INSTALL_DIR && docker compose restart"
echo "  Reconstruir:     cd $INSTALL_DIR && docker compose up -d --build"
echo ""
echo -e "${CYAN}Reinstalar:${NC}"
echo "  curl -fsSL https://raw.githubusercontent.com/drab10688-dot/mikrotik-connect-hub/main/vps-stack/install.sh | sudo bash"
