#!/usr/bin/env bash
# ============================================
# OmniSync - Deploy API + Frontend
# Actualiza código desde GitHub, reconstruye API y frontend
# Ejecutar DESDE EL VPS: bash /opt/omnisync/deploy-all.sh
# ============================================
set -Eeuo pipefail

APP_DIR="/opt/omnisync"
REPO_URL="https://github.com/drab10688-dot/mikrotik-connect-hub.git"
BRANCH="main"
DIST_DIR="$APP_DIR/frontend/dist"
TMP_DIR="$(mktemp -d)"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# Cargar variables del stack para usar contraseñas reales en verificaciones/reparaciones
if [ -f "$APP_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$APP_DIR/.env"
  set +a
fi

MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-changeme_mysql}"
RADIUS_DB_PASSWORD="${RADIUS_DB_PASSWORD:-changeme_radius}"
NUXBILL_DB_PASSWORD="${NUXBILL_DB_PASSWORD:-${NUXBILL_DB_PASS:-changeme_nuxbill}}"
NUXBILL_DB_PASS="${NUXBILL_DB_PASS:-$NUXBILL_DB_PASSWORD}"

sync_nuxbill_env_file() {
  local env_file="$APP_DIR/.env"
  local escaped_pw

  [ -f "$env_file" ] || return 0

  escaped_pw="${NUXBILL_DB_PASSWORD//\\/\\\\}"
  escaped_pw="${escaped_pw//&/\\&}"

  if grep -q '^NUXBILL_DB_PASSWORD=' "$env_file"; then
    sed -i "s|^NUXBILL_DB_PASSWORD=.*|NUXBILL_DB_PASSWORD=${escaped_pw}|" "$env_file"
  else
    echo "NUXBILL_DB_PASSWORD=${NUXBILL_DB_PASSWORD}" >> "$env_file"
  fi

  if grep -q '^NUXBILL_DB_PASS=' "$env_file"; then
    sed -i "s|^NUXBILL_DB_PASS=.*|NUXBILL_DB_PASS=${escaped_pw}|" "$env_file"
  else
    echo "NUXBILL_DB_PASS=${NUXBILL_DB_PASSWORD}" >> "$env_file"
  fi
}

normalize_nuxbill_app_url() {
  local env_file="$APP_DIR/.env"
  local vps_ip current normalized escaped

  [ -f "$env_file" ] || return 0

  vps_ip="$(hostname -I | awk '{print $1}')"
  current="${NUXBILL_APP_URL:-}"

  if [ -z "$current" ]; then
    normalized="http://${vps_ip}/nuxbill"
  else
    current="${current%/}"
    current="${current%/admin}"
    current="${current%/index.php}"

    if [[ "$current" == *"localhost:8080"* || "$current" == *"127.0.0.1:8080"* ]]; then
      normalized="http://${vps_ip}/nuxbill"
    elif [[ "$current" == *"/nuxbill"* ]]; then
      normalized="${current%%/nuxbill*}/nuxbill"
    elif [[ "$current" == *":8080" ]]; then
      normalized="${current%:8080}/nuxbill"
    else
      normalized="${current}/nuxbill"
    fi
  fi

  NUXBILL_APP_URL="$normalized"
  export NUXBILL_APP_URL

  escaped="${normalized//\\/\\\\}"
  escaped="${escaped//&/\\&}"

  if grep -q '^NUXBILL_APP_URL=' "$env_file"; then
    sed -i "s|^NUXBILL_APP_URL=.*|NUXBILL_APP_URL=${escaped}|" "$env_file"
  else
    echo "NUXBILL_APP_URL=${normalized}" >> "$env_file"
  fi

  echo "  ✓ NUXBILL_APP_URL: ${NUXBILL_APP_URL}"
}

get_container_mysql_root_password() {
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' omnisync-mariadb 2>/dev/null \
    | awk -F= '/^MYSQL_ROOT_PASSWORD=/{sub(/^MYSQL_ROOT_PASSWORD=/, ""); print; exit}'
}

sync_mysql_root_env() {
  local env_file="$APP_DIR/.env"
  local value="$1"
  local escaped

  [ -f "$env_file" ] || return 0

  escaped="${value//\\/\\\\}"
  escaped="${escaped//&/\\&}"

  if grep -q '^MYSQL_ROOT_PASSWORD=' "$env_file"; then
    sed -i "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=${escaped}|" "$env_file"
  else
    echo "MYSQL_ROOT_PASSWORD=${value}" >> "$env_file"
  fi
}

resolve_mariadb_root_auth() {
  local env_root_pw="${MYSQL_ROOT_PASSWORD:-}"
  local container_root_pw=""

  ROOT_ARGS=()
  ROOT_AUTH_MODE=""

  for _ in $(seq 1 25); do
    if [ -n "$env_root_pw" ] && docker exec omnisync-mariadb mariadb -uroot -p"${env_root_pw}" -e "SELECT 1;" >/dev/null 2>&1; then
      ROOT_ARGS=(-uroot -p"${env_root_pw}")
      ROOT_AUTH_MODE="password"
      return 0
    fi

    if [ -z "$container_root_pw" ]; then
      container_root_pw="$(get_container_mysql_root_password || true)"
    fi

    if [ -n "$container_root_pw" ] && [ "$container_root_pw" != "$env_root_pw" ] \
      && docker exec omnisync-mariadb mariadb -uroot -p"${container_root_pw}" -e "SELECT 1;" >/dev/null 2>&1; then
      ROOT_ARGS=(-uroot -p"${container_root_pw}")
      ROOT_AUTH_MODE="password(container)"
      MYSQL_ROOT_PASSWORD="$container_root_pw"
      export MYSQL_ROOT_PASSWORD
      sync_mysql_root_env "$container_root_pw"
      return 0
    fi

    if docker exec omnisync-mariadb mariadb -uroot -e "SELECT 1;" >/dev/null 2>&1; then
      ROOT_ARGS=(-uroot)
      ROOT_AUTH_MODE="socket"
      return 0
    fi

    sleep 2
  done

  return 1
}

ensure_mariadb_accounts() {
  echo "  → Sincronizando usuarios MariaDB (radius/nuxbill)..."

  if ! resolve_mariadb_root_auth; then
    echo "  ⚠ Root MariaDB inaccesible. Intentando recuperación profunda automática..."
    if [ -x "$APP_DIR/recover-mariadb-root.sh" ] && bash "$APP_DIR/recover-mariadb-root.sh" >/dev/null 2>&1; then
      if [ -f "$APP_DIR/.env" ]; then
        set -a
        # shellcheck disable=SC1090
        . "$APP_DIR/.env"
        set +a
      fi

      if ! resolve_mariadb_root_auth; then
        echo "  ⚠ No se pudo autenticar root en MariaDB (password/socket)"
        return 1
      fi
    else
      echo "  ⚠ No se pudo ejecutar la recuperación profunda automática"
      return 1
    fi
  fi

  if docker exec omnisync-mariadb mariadb "${ROOT_ARGS[@]}" >/dev/null 2>&1 <<SQL
CREATE DATABASE IF NOT EXISTS radius;
CREATE DATABASE IF NOT EXISTS phpnuxbill CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS 'radius'@'%' IDENTIFIED BY '${RADIUS_DB_PASSWORD}';
ALTER USER 'radius'@'%' IDENTIFIED BY '${RADIUS_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON radius.* TO 'radius'@'%';
CREATE USER IF NOT EXISTS 'nuxbill'@'%' IDENTIFIED BY '${NUXBILL_DB_PASSWORD}';
ALTER USER 'nuxbill'@'%' IDENTIFIED BY '${NUXBILL_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON phpnuxbill.* TO 'nuxbill'@'%';
GRANT ALL PRIVILEGES ON radius.* TO 'nuxbill'@'%';
FLUSH PRIVILEGES;
SQL
  then
    echo "  ✓ Usuarios MariaDB sincronizados (root via ${ROOT_AUTH_MODE})"
    return 0
  fi

  echo "  ⚠ Falló la sincronización SQL de usuarios MariaDB"
  return 1
}

ensure_radius_schema() {
  local schema_file="$APP_DIR/radius/sql/schema.sql"
  [ -f "$schema_file" ] || {
    echo "  ⚠ No existe $schema_file"
    return 1
  }

  local has_nas
  has_nas=$(docker exec omnisync-mariadb mariadb -uradius -p"${RADIUS_DB_PASSWORD}" -Nse \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='radius' AND table_name='nas';" 2>/dev/null || echo "0")

  if [ "$has_nas" != "1" ]; then
    echo "  → Tabla nas no existe, importando schema radius..."
    docker exec -i omnisync-mariadb mariadb -uradius -p"${RADIUS_DB_PASSWORD}" radius < "$schema_file"
  fi

  has_nas=$(docker exec omnisync-mariadb mariadb -uradius -p"${RADIUS_DB_PASSWORD}" -Nse \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='radius' AND table_name='nas';" 2>/dev/null || echo "0")

  if [ "$has_nas" = "1" ]; then
    echo "  ✓ Tabla nas verificada"
    return 0
  fi

  echo "  ✗ La tabla nas sigue sin existir"
  return 1
}

verify_nuxbill_config_write() {
  local test_key="omnisync_write_probe"
  local test_value
  local read_back

  test_value="$(date +%s)"

  if ! docker exec omnisync-mariadb mariadb -unuxbill -p"${NUXBILL_DB_PASSWORD}" phpnuxbill -e "
    UPDATE tbl_appconfig SET value='${test_value}' WHERE setting='${test_key}';
    INSERT INTO tbl_appconfig (setting,value)
    SELECT '${test_key}','${test_value}'
    WHERE NOT EXISTS (SELECT 1 FROM tbl_appconfig WHERE setting='${test_key}');
  " >/dev/null 2>&1; then
    echo "  ⚠ NuxBill no pudo escribir en tbl_appconfig"
    return 1
  fi

  read_back="$(docker exec omnisync-mariadb mariadb -unuxbill -p"${NUXBILL_DB_PASSWORD}" -Nse "SELECT value FROM phpnuxbill.tbl_appconfig WHERE setting='${test_key}' LIMIT 1;" 2>/dev/null || true)"

  if [ "$read_back" = "$test_value" ]; then
    echo "  ✓ Escritura/lectura de configuración NuxBill OK"
    return 0
  fi

  echo "  ⚠ La prueba de configuración NuxBill devolvió valor inesperado"
  return 1
}

echo "╔══════════════════════════════════════════════╗"
echo "║  OmniSync - Deploy API + Frontend            ║"
echo "╚══════════════════════════════════════════════╝"

# ─── Prerequisites ─────────────────────────────
echo "[1/10] Verificando dependencias..."
apt-get update -y >/dev/null 2>&1 || true
apt-get install -y git curl rsync ca-certificates >/dev/null 2>&1 || true

if ! command -v node >/dev/null 2>&1; then
  echo "  → Instalando Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# ─── Clone ─────────────────────────────────────
echo "[2/10] Clonando repositorio..."
git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$TMP_DIR/app"

# ─── Update API source ────────────────────────
echo "[3/10] Actualizando código del API..."
rsync -a --delete \
  --exclude='node_modules' \
  "$TMP_DIR/app/vps-stack/api/" "$APP_DIR/api/"

# Also update shared VPS files (docker-compose, db init, nginx, radius, etc.)
for item in docker-compose.yml db nginx radius mariadb-init phpnuxbill cms-cdata install-cms.sh; do
  if [ -e "$TMP_DIR/app/vps-stack/$item" ]; then
    if [ -d "$TMP_DIR/app/vps-stack/$item" ]; then
      rsync -a "$TMP_DIR/app/vps-stack/$item/" "$APP_DIR/$item/"
    else
      cp "$TMP_DIR/app/vps-stack/$item" "$APP_DIR/$item"
    fi
  fi
done

# Copy deploy scripts
cp "$TMP_DIR/app/vps-stack/deploy-frontend.sh" "$APP_DIR/deploy-frontend.sh" 2>/dev/null || true
cp "$TMP_DIR/app/vps-stack/deploy-all.sh" "$APP_DIR/deploy-all.sh" 2>/dev/null || true
cp "$TMP_DIR/app/vps-stack/repair-nuxbill-auth.sh" "$APP_DIR/repair-nuxbill-auth.sh" 2>/dev/null || true
chmod +x "$APP_DIR"/*.sh 2>/dev/null || true

# ─── Rebuild core containers ───────────────────
echo "[4/10] Reconstruyendo API + servicios..."
cd "$APP_DIR"
sync_nuxbill_env_file
normalize_nuxbill_app_url
docker compose build --no-cache api cms-cdata
docker compose up -d --build api phpnuxbill mariadb

echo "[5/10] Sincronizando cuentas MariaDB..."
if ! ensure_mariadb_accounts; then
  echo "  ✗ Error crítico: no se pudo sincronizar usuarios MariaDB (nuxbill/radius)"
  echo "    Ejecuta: bash $APP_DIR/repair-nuxbill-auth.sh"
  exit 1
fi

echo "[6/10] Verificando schema radius (tabla nas)..."
ensure_radius_schema || true

echo "[6.5/10] Verificando escritura de configuración en NuxBill..."
verify_nuxbill_config_write || true

# ─── Migrate PostgreSQL (portal_ads) ──
echo "[7/10] Migrando PostgreSQL..."
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
" 2>/dev/null && echo "  ✓ portal_ads OK" || echo "  ⚠ portal_ads skip"

# Migrate VPN peers table
docker exec omnisync-postgres psql -U "${DB_USER:-omnisync}" -d "${DB_NAME:-omnisync}" -c "
CREATE TABLE IF NOT EXISTS vpn_peers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, description TEXT,
  mikrotik_id UUID REFERENCES mikrotik_devices(id) ON DELETE SET NULL,
  public_key TEXT NOT NULL, private_key TEXT, preshared_key TEXT,
  allowed_ips TEXT NOT NULL DEFAULT '10.13.13.0/24',
  endpoint TEXT, persistent_keepalive INTEGER DEFAULT 25,
  peer_address TEXT NOT NULL, remote_networks TEXT,
  is_active BOOLEAN DEFAULT true,
  last_handshake TIMESTAMPTZ, transfer_rx BIGINT DEFAULT 0, transfer_tx BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vpn_peers_created_by ON vpn_peers(created_by);
CREATE INDEX IF NOT EXISTS idx_vpn_peers_mikrotik ON vpn_peers(mikrotik_id);
DROP TRIGGER IF EXISTS update_vpn_peers_updated_at ON vpn_peers;
CREATE TRIGGER update_vpn_peers_updated_at BEFORE UPDATE ON vpn_peers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
" 2>/dev/null && echo "  ✓ vpn_peers OK" || echo "  ⚠ vpn_peers skip"

# Migrate Ubiquiti devices tables
docker exec omnisync-postgres psql -U "${DB_USER:-omnisync}" -d "${DB_NAME:-omnisync}" -c "
CREATE TABLE IF NOT EXISTS ubiquiti_global_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by UUID NOT NULL REFERENCES users(id),
  default_username TEXT NOT NULL DEFAULT 'ubnt',
  default_password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(created_by)
);
CREATE TABLE IF NOT EXISTS ubiquiti_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  username TEXT,
  password TEXT,
  model TEXT,
  mac_address TEXT,
  client_id UUID REFERENCES isp_clients(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  last_signal INTEGER,
  last_noise INTEGER,
  last_ccq INTEGER,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ubiquiti_devices_created_by ON ubiquiti_devices(created_by);
CREATE INDEX IF NOT EXISTS idx_ubiquiti_devices_client ON ubiquiti_devices(client_id);
" 2>/dev/null && echo "  ✓ ubiquiti_devices OK" || echo "  ⚠ ubiquiti_devices skip"

# Backfill roles (fix instalaciones antiguas sin super_admin asignado)
docker exec omnisync-postgres psql -U "${DB_USER:-omnisync}" -d "${DB_NAME:-omnisync}" -c "
-- Asignar super_admin al usuario admin@omnisync.local
INSERT INTO user_roles (user_id, role)
SELECT u.id, 'super_admin'::app_role
FROM users u
WHERE u.email = 'admin@omnisync.local'
ON CONFLICT (user_id, role) DO NOTHING;

-- Asignar super_admin al primer usuario creado (owner del sistema)
INSERT INTO user_roles (user_id, role)
SELECT u.id, 'super_admin'::app_role
FROM users u
ORDER BY u.created_at ASC
LIMIT 1
ON CONFLICT (user_id, role) DO NOTHING;

-- Asignar super_admin a usuarios con is_admin = true (si existe la columna)
DO \\\$\\\$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_admin') THEN
    INSERT INTO user_roles (user_id, role)
    SELECT u.id, 'super_admin'::app_role
    FROM users u
    WHERE u.is_admin = true
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END \\\$\\\$;

-- Asignar rol 'user' a quienes no tienen ningún rol
INSERT INTO user_roles (user_id, role)
SELECT u.id, 'user'::app_role
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id
)
ON CONFLICT (user_id, role) DO NOTHING;
" 2>/dev/null && echo "  ✓ user_roles backfill OK" || echo "  ⚠ user_roles backfill skip"

echo "[7.5/10] Reiniciando FreeRADIUS + PHPNuxBill..."
docker compose up -d freeradius phpnuxbill

# ─── Build Frontend ───────────────────────────
echo "[8/10] Compilando frontend..."
cd "$TMP_DIR/app"
echo "VITE_API_BASE_URL=/api" > .env.production
npm ci --legacy-peer-deps 2>/dev/null || npm install --legacy-peer-deps
npm run build

echo "[9/10] Desplegando frontend..."
mkdir -p "$DIST_DIR"
rsync -a --delete dist/ "$DIST_DIR/"

# ─── Restart Nginx ────────────────────────────
echo "[10/10] Reiniciando Nginx..."
cd "$APP_DIR"
docker compose restart nginx

VPS_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✓ API + Frontend desplegados correctamente  ║"
echo "║                                              ║"
echo "║  Panel: http://$VPS_IP                       ║"
echo "║  API:   http://$VPS_IP/api/health            ║"
echo "║                                              ║"
echo "║  Abre el panel y presiona Ctrl+F5            ║"
echo "╚══════════════════════════════════════════════╝"
