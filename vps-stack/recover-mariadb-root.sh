#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/omnisync"
ENV_FILE="$APP_DIR/.env"
NEW_ROOT_PASSWORD="root_sync_$(openssl rand -hex 8)"

log() { echo "[recover-mariadb-root] $1"; }

cd "$APP_DIR"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

RADIUS_DB_PASSWORD="${RADIUS_DB_PASSWORD:-changeme_radius}"
NUXBILL_DB_PASSWORD="${NUXBILL_DB_PASS:-${NUXBILL_DB_PASSWORD:-changeme_nuxbill}}"

log "Deteniendo MariaDB principal..."
docker compose stop mariadb >/dev/null

log "Iniciando MariaDB en modo recuperación..."
docker run --rm -d --name omnisync-mariadb-recover \
  --network omnisync_omnisync-net \
  -v omnisync_mariadb_data:/var/lib/mysql \
  mariadb:11 --skip-grant-tables --skip-networking >/dev/null

cleanup() {
  docker rm -f omnisync-mariadb-recover >/dev/null 2>&1 || true
}
trap cleanup EXIT

for i in $(seq 1 30); do
  if docker exec omnisync-mariadb-recover mariadb -uroot -e "SELECT 1;" >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    log "No fue posible entrar a MariaDB en modo recuperación"
    exit 1
  fi
  sleep 2
done

log "Aplicando nueva contraseña root y permisos..."
docker exec -i omnisync-mariadb-recover mariadb -uroot <<SQL
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY '${NEW_ROOT_PASSWORD}';
CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY '${NEW_ROOT_PASSWORD}';
ALTER USER 'root'@'%' IDENTIFIED BY '${NEW_ROOT_PASSWORD}';
CREATE USER IF NOT EXISTS 'radius'@'%' IDENTIFIED BY '${RADIUS_DB_PASSWORD}';
ALTER USER 'radius'@'%' IDENTIFIED BY '${RADIUS_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'nuxbill'@'%' IDENTIFIED BY '${NUXBILL_DB_PASSWORD}';
ALTER USER 'nuxbill'@'%' IDENTIFIED BY '${NUXBILL_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON radius.* TO 'radius'@'%';
GRANT ALL PRIVILEGES ON phpnuxbill.* TO 'nuxbill'@'%';
GRANT ALL PRIVILEGES ON radius.* TO 'nuxbill'@'%';
FLUSH PRIVILEGES;
SQL

log "Actualizando .env con nueva root password..."
if [ -f "$ENV_FILE" ]; then
  if grep -q '^MYSQL_ROOT_PASSWORD=' "$ENV_FILE"; then
    sed -i "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=${NEW_ROOT_PASSWORD}|" "$ENV_FILE"
  else
    echo "MYSQL_ROOT_PASSWORD=${NEW_ROOT_PASSWORD}" >> "$ENV_FILE"
  fi
fi

log "Levantando stack normal..."
docker compose up -d mariadb >/dev/null
sleep 5

docker exec omnisync-mariadb mariadb -uroot -p"${NEW_ROOT_PASSWORD}" -e "SELECT 1;" >/dev/null

docker compose up -d --force-recreate phpnuxbill freeradius api >/dev/null

log "Recuperación completada ✓"
log "Nueva MYSQL_ROOT_PASSWORD: ${NEW_ROOT_PASSWORD}"
