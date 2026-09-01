#!/usr/bin/env bash
# ============================================================================
#  OmniSync — Recuperación ante desastre
#  Reinstala el stack (si hace falta) y restaura la base de datos desde una
#  copia .sql.gz generada por el panel (o descargada de Dropbox).
#
#  Uso:
#    sudo bash restore.sh /ruta/sistema-2026-09-01T10-00-00.sql.gz
#    sudo bash restore.sh --dropbox sistema-2026-09-01T10-00-00.sql.gz
# ============================================================================
set -euo pipefail

STACK_DIR="${STACK_DIR:-/opt/omnisync}"
BACKUP_DIR="${BACKUP_DIR:-$STACK_DIR/backups}"
FILE="${1:-}"

log()  { echo -e "\033[1;36m[OmniSync]\033[0m $*"; }
err()  { echo -e "\033[1;31m[Error]\033[0m $*" >&2; exit 1; }

[ -n "$FILE" ] || err "Indica el archivo de la copia. Ej: sudo bash restore.sh $BACKUP_DIR/sistema-....sql.gz"

# ── Descarga desde Dropbox si se pide ───────────────────────────────────────
if [ "$FILE" = "--dropbox" ]; then
  NAME="${2:-}"
  [ -n "$NAME" ] || err "Indica el nombre del archivo en Dropbox"
  [ -f "$STACK_DIR/.env" ] || err "No existe $STACK_DIR/.env"
  # Reutiliza las credenciales guardadas en la base de datos vía el API
  log "Descargando $NAME desde Dropbox…"
  docker exec omnisync-api node -e "
    const {pool}=require('/app/dist/lib/db');
    const dbx=require('/app/dist/lib/dropbox');
    (async()=>{
      const {rows}=await pool.query(\"SELECT * FROM backup_settings WHERE dropbox_refresh_token IS NOT NULL ORDER BY tenant_id NULLS FIRST LIMIT 1\");
      if(!rows[0]) throw new Error('Dropbox no configurado');
      const c={app_key:rows[0].dropbox_app_key,app_secret:rows[0].dropbox_app_secret,refresh_token:rows[0].dropbox_refresh_token,folder:rows[0].dropbox_folder};
      await dbx.downloadFile(c,'$NAME','/opt/omnisync/backups/$NAME');
      console.log('ok');process.exit(0);
    })().catch(e=>{console.error(e.message);process.exit(1);});
  " || err "No se pudo descargar de Dropbox"
  FILE="$BACKUP_DIR/$NAME"
fi

[ -f "$FILE" ] || err "No se encuentra el archivo: $FILE"
cd "$STACK_DIR" || err "No existe $STACK_DIR (ejecuta primero install.sh)"

# ── Levanta sólo la base de datos ───────────────────────────────────────────
log "Levantando PostgreSQL…"
docker compose up -d postgres
for i in $(seq 1 60); do
  docker compose exec -T postgres pg_isready -U omnisync >/dev/null 2>&1 && break
  sleep 2
done

# ── Copia de resguardo del estado actual, por si acaso ──────────────────────
mkdir -p "$BACKUP_DIR"
PRE="$BACKUP_DIR/pre-restore-$(date +%Y%m%d-%H%M%S).sql.gz"
log "Guardando el estado actual en $PRE"
docker compose exec -T postgres pg_dump -U omnisync -d omnisync --no-owner --no-privileges 2>/dev/null | gzip > "$PRE" || true

# ── Restauración ────────────────────────────────────────────────────────────
log "Vaciando el esquema actual…"
docker compose exec -T postgres psql -U omnisync -d omnisync -c \
  "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO omnisync; GRANT ALL ON SCHEMA public TO public;"

log "Restaurando $FILE …"
if [[ "$FILE" == *.gz ]]; then
  gunzip -c "$FILE" | docker compose exec -T postgres psql -U omnisync -d omnisync
else
  docker compose exec -T postgres psql -U omnisync -d omnisync < "$FILE"
fi

# ── Reinicia el resto del stack ─────────────────────────────────────────────
log "Reiniciando servicios…"
docker compose up -d
sleep 5
docker compose restart api >/dev/null 2>&1 || true

log "Restauración completada. Resguardo previo: $PRE"
log "Entra al panel y verifica ISPs, usuarios y equipos."
