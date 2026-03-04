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

ensure_mariadb_accounts() {
  echo "  → Sincronizando usuarios MariaDB (radius/nuxbill)..."
  for i in $(seq 1 20); do
    if docker exec omnisync-mariadb mariadb -uroot -p"${MYSQL_ROOT_PASSWORD}" -e "SELECT 1;" >/dev/null 2>&1; then
      docker exec omnisync-mariadb mariadb -uroot -p"${MYSQL_ROOT_PASSWORD}" >/dev/null 2>&1 <<SQL
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
      echo "  ✓ Usuarios MariaDB sincronizados"
      return 0
    fi
    sleep 2
  done
  echo "  ⚠ No se pudo sincronizar usuarios MariaDB automáticamente"
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
# Preserve .env and docker volumes, only update source code
rsync -a --delete \
  --exclude='node_modules' \
  "$TMP_DIR/app/vps-stack/api/" "$APP_DIR/api/"

# Also update shared VPS files (docker-compose, db init, nginx, radius, etc.)
for item in docker-compose.yml db nginx radius mariadb-init phpnuxbill; do
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
echo "[4/10] Reconstruyendo API + PHPNuxBill..."
cd "$APP_DIR"
sync_nuxbill_env_file
docker compose build --no-cache api
docker compose up -d --build api phpnuxbill mariadb

echo "[5/10] Sincronizando cuentas MariaDB..."
if ! ensure_mariadb_accounts; then
  echo "  ✗ Error crítico: no se pudo sincronizar usuarios MariaDB (nuxbill/radius)"
  echo "    Ejecuta: bash $APP_DIR/repair-nuxbill-auth.sh"
  exit 1
fi

echo "[6/10] Verificando schema radius (tabla nas)..."
ensure_radius_schema || true

# ─── Migrate PostgreSQL (portal_ads) ──
echo "[6.5/10] Migrando PostgreSQL..."
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

echo "[7/10] Reiniciando FreeRADIUS + PHPNuxBill..."
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
