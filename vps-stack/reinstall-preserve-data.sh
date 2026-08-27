#!/usr/bin/env bash
# OmniSync - Reinstalación completa conservando datos
# Actualiza código, reconstruye todo el stack y conserva volúmenes/.env.
set -Eeuo pipefail

APP_DIR="/opt/omnisync"
REPO_URL="https://github.com/drab10688-dot/mikrotik-connect-hub.git"
BACKUP_ROOT="/opt/omnisync-preserve-backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
TMP_DIR="$(mktemp -d)"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

if [ "${EUID}" -ne 0 ]; then
  echo "Error: ejecuta este script como root."
  exit 1
fi

if [ ! -f "$APP_DIR/docker-compose.yml" ] || [ ! -f "$APP_DIR/.env" ]; then
  echo "Error: no se encontró una instalación válida en $APP_DIR."
  exit 1
fi

mkdir -p "$BACKUP_DIR/volumes"
chmod 700 "$BACKUP_DIR"

set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env"
set +a

DB_USER="${DB_USER:-omnisync}"
DB_NAME="${DB_NAME:-omnisync}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-}"

echo "╔══════════════════════════════════════════════════╗"
echo "║ OmniSync - Reinstalación conservando datos       ║"
echo "╚══════════════════════════════════════════════════╝"
echo "Respaldo: $BACKUP_DIR"

echo "[1/8] Guardando configuración..."
cp -a "$APP_DIR/.env" "$BACKUP_DIR/env"
cp -a "$APP_DIR/docker-compose.yml" "$BACKUP_DIR/docker-compose.yml"

echo "[2/8] Creando respaldos lógicos..."
if docker ps --format '{{.Names}}' | grep -qx 'omnisync-postgres'; then
  docker exec omnisync-postgres pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$BACKUP_DIR/postgres.dump"
else
  echo "Error: PostgreSQL no está activo; no es seguro continuar."
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -qx 'omnisync-mariadb'; then
  if [ -n "$MYSQL_ROOT_PASSWORD" ]; then
    docker exec omnisync-mariadb mariadb-dump -uroot -p"$MYSQL_ROOT_PASSWORD" --all-databases --single-transaction > "$BACKUP_DIR/mariadb.sql"
  else
    docker exec omnisync-mariadb mariadb-dump -uroot --all-databases --single-transaction > "$BACKUP_DIR/mariadb.sql"
  fi
else
  echo "Error: MariaDB no está activa; no es seguro continuar."
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -qx 'omnisync-mongo'; then
  docker exec omnisync-mongo mongodump --archive > "$BACKUP_DIR/mongodb.archive"
fi

echo "[3/8] Respaldando volúmenes Docker..."
for volume in postgres_data mariadb_data mongo_data wireguard_config backup_data nuxbill_uploads nuxbill_themes nuxbill_pages; do
  actual="omnisync_${volume}"
  if docker volume inspect "$actual" >/dev/null 2>&1; then
    docker run --rm -v "$actual:/source:ro" -v "$BACKUP_DIR/volumes:/backup" alpine:3.20 \
      tar -czf "/backup/${volume}.tar.gz" -C /source .
  fi
done

echo "[4/8] Descargando la versión actual..."
git clone --depth 1 "$REPO_URL" "$TMP_DIR/app"

echo "[5/8] Actualizando archivos sin tocar datos ni credenciales..."
rsync -a --delete \
  --exclude='.env' \
  --exclude='frontend/dist/' \
  "$TMP_DIR/app/vps-stack/" "$APP_DIR/"
cp "$BACKUP_DIR/env" "$APP_DIR/.env"
chmod +x "$APP_DIR"/*.sh 2>/dev/null || true

echo "[6/8] Compilando el panel..."
cd "$TMP_DIR/app"
printf 'VITE_API_BASE_URL=/api\n' > .env.production
npm ci --legacy-peer-deps 2>/dev/null || npm install --legacy-peer-deps
npm run build
mkdir -p "$APP_DIR/frontend/dist"
rsync -a --delete dist/ "$APP_DIR/frontend/dist/"

echo "[7/8] Reconstruyendo todos los servicios..."
cd "$APP_DIR"
docker compose down --remove-orphans
docker compose build --no-cache api phpnuxbill

GENIEACS_NBI_URL="${GENIEACS_NBI_URL:-http://genieacs:7557}"
if [ "$GENIEACS_NBI_URL" = "http://genieacs:7557" ] || [ "$GENIEACS_NBI_URL" = "http://genieacs-nbi:7557" ]; then
  export COMPOSE_PROFILES=builtin-acs
fi
docker compose up -d --build

echo "[8/8] Verificando bases de datos y módulos..."
for _ in $(seq 1 30); do
  docker exec omnisync-postgres pg_isready -U "$DB_USER" >/dev/null 2>&1 && break
  sleep 2
done

docker exec omnisync-postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -c "
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE secretary_assignments ALTER COLUMN mikrotik_id DROP NOT NULL;
ALTER TABLE secretary_assignments ADD COLUMN IF NOT EXISTS can_manage_vps_services BOOLEAN DEFAULT true;
ALTER TABLE secretary_assignments ADD COLUMN IF NOT EXISTS can_view_vps BOOLEAN DEFAULT true;
ALTER TABLE secretary_assignments ADD COLUMN IF NOT EXISTS can_manage_vps_docker BOOLEAN DEFAULT true;
ALTER TABLE secretary_assignments ADD COLUMN IF NOT EXISTS can_manage_radius BOOLEAN DEFAULT true;
ALTER TABLE secretary_assignments ADD COLUMN IF NOT EXISTS can_manage_radius_users BOOLEAN DEFAULT true;
ALTER TABLE secretary_assignments ADD COLUMN IF NOT EXISTS can_view_radius_stats BOOLEAN DEFAULT true;
ALTER TABLE secretary_assignments ADD COLUMN IF NOT EXISTS can_manage_onu BOOLEAN DEFAULT true;
ALTER TABLE secretary_assignments ADD COLUMN IF NOT EXISTS can_configure_onu_wifi BOOLEAN DEFAULT true;
ALTER TABLE secretary_assignments ADD COLUMN IF NOT EXISTS can_reboot_onu BOOLEAN DEFAULT true;
ALTER TABLE secretary_assignments ADD COLUMN IF NOT EXISTS can_manage_settings BOOLEAN DEFAULT true;
ALTER TABLE secretary_assignments ADD COLUMN IF NOT EXISTS can_manage_diagnostics BOOLEAN DEFAULT true;
" >/dev/null

docker compose restart api nginx >/dev/null
sleep 5

failed=0
for container in omnisync-postgres omnisync-mariadb omnisync-api omnisync-nginx omnisync-genieacs omnisync-mongo; do
  if docker ps --format '{{.Names}}' | grep -qx "$container"; then
    echo "  ✓ $container"
  else
    echo "  ✗ $container no está activo"
    failed=1
  fi
done

if curl -fsS http://localhost/api/health >/dev/null; then
  echo "  ✓ API accesible por Nginx"
else
  echo "  ✗ La API no respondió por Nginx"
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  echo "La reinstalación terminó con servicios pendientes. El respaldo está en: $BACKUP_DIR"
  echo "Diagnóstico: cd $APP_DIR && COMPOSE_PROFILES=builtin-acs docker compose ps"
  exit 1
fi

echo ""
echo "✓ Reinstalación completada sin borrar datos."
echo "✓ VPN, GenieACS/ONUs, API y panel fueron reconstruidos."
echo "✓ Respaldo de seguridad: $BACKUP_DIR"