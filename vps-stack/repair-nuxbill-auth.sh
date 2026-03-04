#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/omnisync"
ENV_FILE="$APP_DIR/.env"

log() {
  echo "[repair-nuxbill] $1"
}

if [ ! -f "$APP_DIR/docker-compose.yml" ]; then
  log "No se encontró $APP_DIR/docker-compose.yml"
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-changeme_mysql}"
RADIUS_DB_PASSWORD="${RADIUS_DB_PASSWORD:-changeme_radius}"

resolve_nuxbill_password() {
  if [ -n "${NUXBILL_DB_PASS:-}" ]; then
    echo "$NUXBILL_DB_PASS"
  elif [ -n "${NUXBILL_DB_PASSWORD:-}" ]; then
    echo "$NUXBILL_DB_PASSWORD"
  else
    echo "changeme_nuxbill"
  fi
}

NUXBILL_DB_PASSWORD="$(resolve_nuxbill_password)"
NUXBILL_DB_PASS="$NUXBILL_DB_PASSWORD"

sync_env_key() {
  local key="$1"
  local value="$2"
  local escaped

  escaped="${value//\\/\\\\}"
  escaped="${escaped//&/\\&}"

  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

if [ -f "$ENV_FILE" ]; then
  sync_env_key "NUXBILL_DB_PASSWORD" "$NUXBILL_DB_PASSWORD"
  sync_env_key "NUXBILL_DB_PASS" "$NUXBILL_DB_PASS"
fi

cd "$APP_DIR"

log "Levantando MariaDB..."
docker compose up -d mariadb

log "Esperando MariaDB..."
ROOT_AUTH_MODE=""
for i in $(seq 1 30); do
  if docker exec omnisync-mariadb mariadb -uroot -p"${MYSQL_ROOT_PASSWORD}" -e "SELECT 1;" >/dev/null 2>&1; then
    ROOT_AUTH_MODE="password"
    break
  fi

  if docker exec omnisync-mariadb mariadb -uroot -e "SELECT 1;" >/dev/null 2>&1; then
    ROOT_AUTH_MODE="socket"
    break
  fi

  if [ "$i" -eq 30 ]; then
    log "No se pudo conectar con MariaDB como root (ni por password ni por socket)"
    log "Ejecuta recuperación profunda: bash /opt/omnisync/recover-mariadb-root.sh"
    exit 1
  fi
  sleep 2
done

if [ "$ROOT_AUTH_MODE" = "password" ]; then
  ROOT_ARGS=(-uroot -p"${MYSQL_ROOT_PASSWORD}")
else
  ROOT_ARGS=(-uroot)
fi

log "Sincronizando usuarios y permisos (radius/nuxbill)..."
docker exec -i omnisync-mariadb mariadb "${ROOT_ARGS[@]}" >/dev/null 2>&1 <<SQL
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

log "Validando login nuxbill..."
if ! docker exec omnisync-mariadb mariadb -unuxbill -p"${NUXBILL_DB_PASSWORD}" -e "SELECT 1;" >/dev/null 2>&1; then
  log "Login nuxbill sigue fallando"
  exit 1
fi

log "Recreando PHPNuxBill + FreeRADIUS con variables saneadas..."
docker compose up -d --force-recreate phpnuxbill freeradius

log "Reparación completada ✓"
log "Acceso: http://$(hostname -I | awk '{print $1}')/nuxbill/admin"
