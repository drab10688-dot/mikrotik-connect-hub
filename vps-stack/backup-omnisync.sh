#!/usr/bin/env bash
# ============================================================================
#  OmniSync — Respaldo automático diario (lo ejecuta /etc/cron.d/omnisync-backup)
#
#  Guarda en $DEST (fuera de /opt/omnisync: update.sh no lo borra):
#    sistema-<fecha>.sql.gz      PostgreSQL completo (compatible con restore.sh)
#    genieacs-<fecha>.archive.gz MongoDB de GenieACS (ONUs, presets, provisions)
#    config-<fecha>.tar.gz       .env, certificados y VPN L2TP (contiene claves)
#  Conserva KEEP_DAYS días.
#
#  Manual:    sudo bash /opt/omnisync/backup-omnisync.sh
#  Restaurar: sudo bash /opt/omnisync/restore.sh /var/backups/omnisync/sistema-....sql.gz
#             docker exec -i omnisync-mongo mongorestore --drop --gzip --archive \
#               < /var/backups/omnisync/genieacs-....archive.gz
# ============================================================================
set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/omnisync}"
DEST="${DEST:-/var/backups/omnisync}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP=$(date +%Y-%m-%dT%H-%M-%S)
FAIL=0

# shellcheck disable=SC1091
[ -f "$INSTALL_DIR/.env" ] && { set -a; . "$INSTALL_DIR/.env"; set +a; }

umask 077
mkdir -p "$DEST"
chmod 700 "$DEST"

log() { echo "[$(date '+%F %T')] $*"; }

# ── PostgreSQL ─────────────────────────────────────────────────────────────
F="$DEST/sistema-$STAMP.sql.gz"
if docker exec omnisync-postgres pg_dump -U "${DB_USER:-omnisync}" -d "${DB_NAME:-omnisync}" \
     --no-owner --no-privileges | gzip > "$F" && [ -s "$F" ]; then
  log "OK PostgreSQL $(du -h "$F" | cut -f1)"
else
  log "ERROR PostgreSQL"; rm -f "$F"; FAIL=1
fi

# ── MongoDB (GenieACS) ─────────────────────────────────────────────────────
F="$DEST/genieacs-$STAMP.archive.gz"
if docker exec omnisync-mongo mongodump --quiet --db genieacs --gzip --archive > "$F" && [ -s "$F" ]; then
  log "OK GenieACS $(du -h "$F" | cut -f1)"
else
  log "ERROR GenieACS"; rm -f "$F"; FAIL=1
fi

# ── Configuración ──────────────────────────────────────────────────────────
F="$DEST/config-$STAMP.tar.gz"
PATHS=()
for p in "$INSTALL_DIR/.env" "$INSTALL_DIR/nginx/certs" /opt/omnisync-l2tp /etc/omnisync; do
  [ -e "$p" ] && PATHS+=("$p")
done
if [ ${#PATHS[@]} -gt 0 ] && tar -czf "$F" "${PATHS[@]}" 2>/dev/null; then
  log "OK configuración $(du -h "$F" | cut -f1)"
else
  log "ERROR configuración"; rm -f "$F"; FAIL=1
fi

# ── Retención ──────────────────────────────────────────────────────────────
find "$DEST" -maxdepth 1 -type f \( -name 'sistema-*.sql.gz' -o -name 'genieacs-*.archive.gz' -o -name 'config-*.tar.gz' \) \
  -mtime +"$KEEP_DAYS" -delete

exit $FAIL
