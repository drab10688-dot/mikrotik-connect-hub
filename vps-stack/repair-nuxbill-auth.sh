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

normalize_nuxbill_app_url() {
  local vps_ip current normalized

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
}

if [ -f "$ENV_FILE" ]; then
  normalize_nuxbill_app_url
  sync_env_key "NUXBILL_DB_PASSWORD" "$NUXBILL_DB_PASSWORD"
  sync_env_key "NUXBILL_DB_PASS" "$NUXBILL_DB_PASS"
  sync_env_key "NUXBILL_APP_URL" "$NUXBILL_APP_URL"
fi

cd "$APP_DIR"

log "Levantando MariaDB..."
docker compose up -d mariadb

log "Esperando MariaDB..."

get_container_mysql_root_password() {
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' omnisync-mariadb 2>/dev/null \
    | awk -F= '/^MYSQL_ROOT_PASSWORD=/{sub(/^MYSQL_ROOT_PASSWORD=/, ""); print; exit}'
}

resolve_root_auth() {
  local env_root_pw="${MYSQL_ROOT_PASSWORD:-}"
  local container_root_pw=""

  ROOT_AUTH_MODE=""

  for _ in $(seq 1 25); do
    if [ -n "$env_root_pw" ] && docker exec omnisync-mariadb mariadb -uroot -p"${env_root_pw}" -e "SELECT 1;" >/dev/null 2>&1; then
      ROOT_AUTH_MODE="password"
      ROOT_ARGS=(-uroot -p"${env_root_pw}")
      return 0
    fi

    if [ -z "$container_root_pw" ]; then
      container_root_pw="$(get_container_mysql_root_password || true)"
    fi

    if [ -n "$container_root_pw" ] && [ "$container_root_pw" != "$env_root_pw" ] \
      && docker exec omnisync-mariadb mariadb -uroot -p"${container_root_pw}" -e "SELECT 1;" >/dev/null 2>&1; then
      ROOT_AUTH_MODE="password(container)"
      ROOT_ARGS=(-uroot -p"${container_root_pw}")
      MYSQL_ROOT_PASSWORD="$container_root_pw"
      if [ -f "$ENV_FILE" ]; then
        sync_env_key "MYSQL_ROOT_PASSWORD" "$container_root_pw"
      fi
      return 0
    fi

    if docker exec omnisync-mariadb mariadb -uroot -e "SELECT 1;" >/dev/null 2>&1; then
      ROOT_AUTH_MODE="socket"
      ROOT_ARGS=(-uroot)
      return 0
    fi

    sleep 2
  done

  return 1
}

if ! resolve_root_auth; then
  log "Root MariaDB inaccesible. Ejecutando recuperación profunda automática..."
  if [ -x "$APP_DIR/recover-mariadb-root.sh" ] && bash "$APP_DIR/recover-mariadb-root.sh" >/dev/null 2>&1; then
    if [ -f "$ENV_FILE" ]; then
      set -a
      # shellcheck disable=SC1090
      . "$ENV_FILE"
      set +a
    fi

    MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-changeme_mysql}"

    if ! resolve_root_auth; then
      log "No se pudo conectar con MariaDB como root (ni por password ni por socket)"
      log "Ejecuta recuperación profunda manual: bash /opt/omnisync/recover-mariadb-root.sh"
      exit 1
    fi
  else
    log "No se pudo ejecutar recuperación profunda automática"
    log "Ejecuta recuperación profunda manual: bash /opt/omnisync/recover-mariadb-root.sh"
    exit 1
  fi
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
