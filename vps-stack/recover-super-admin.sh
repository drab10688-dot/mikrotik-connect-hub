#!/usr/bin/env bash
# Recupera o crea de forma segura un superadministrador del VPS OmniSync.
set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
EMAIL="${1:-drab10688@gmail.com}"
TENANT_SEARCH="${2:-Suros Comunicaciones}"

if [[ ! "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo -e "${RED}Correo inválido.${NC}" >&2
  exit 1
fi

if ! docker inspect omnisync-api omnisync-postgres >/dev/null 2>&1; then
  echo -e "${RED}OmniSync API o PostgreSQL no están en ejecución.${NC}" >&2
  exit 1
fi

read -r -s -p "Nueva contraseña para ${EMAIL}: " PASSWORD
echo
read -r -s -p "Confirma la contraseña: " PASSWORD_CONFIRM
echo

if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
  echo -e "${RED}Las contraseñas no coinciden.${NC}" >&2
  exit 1
fi
if [ "${#PASSWORD}" -lt 10 ]; then
  echo -e "${RED}Usa una contraseña de al menos 10 caracteres.${NC}" >&2
  exit 1
fi

# bcrypt se ejecuta dentro del contenedor y recibe la contraseña por stdin;
# no queda escrita en el historial, argumentos del proceso ni archivos.
PASSWORD_HASH="$(printf '%s' "$PASSWORD" | docker exec -i omnisync-api node -e \
  "const fs=require('fs'),bcrypt=require('bcryptjs');const p=fs.readFileSync(0,'utf8');process.stdout.write(bcrypt.hashSync(p,12));")"
unset PASSWORD PASSWORD_CONFIRM

DB_USER="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' omnisync-postgres | sed -n 's/^POSTGRES_USER=//p' | head -1)"
DB_NAME="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' omnisync-postgres | sed -n 's/^POSTGRES_DB=//p' | head -1)"
DB_USER="${DB_USER:-omnisync}"
DB_NAME="${DB_NAME:-omnisync}"

RESULT="$(docker exec -i omnisync-postgres psql -X -v ON_ERROR_STOP=1 \
  -U "$DB_USER" -d "$DB_NAME" -At \
  -v email="$EMAIL" -v tenant_search="$TENANT_SEARCH" -v password_hash="$PASSWORD_HASH" <<'SQL'
BEGIN;
SELECT set_config('omnisync.recovery_email', :'email', true);
SELECT set_config('omnisync.recovery_tenant', :'tenant_search', true);
SELECT set_config('omnisync.recovery_hash', :'password_hash', true);
DO $recover$
DECLARE
  selected_tenant UUID;
  matched_tenants INTEGER;
  recovered_user UUID;
  recovery_email TEXT := current_setting('omnisync.recovery_email');
  recovery_tenant TEXT := current_setting('omnisync.recovery_tenant');
  recovery_hash TEXT := current_setting('omnisync.recovery_hash');
BEGIN
  -- PostgreSQL no define min(uuid); convertir a texto permite seleccionar
  -- el único UUID encontrado sin depender de una extensión adicional.
  SELECT count(*), min(id::text)::uuid
    INTO matched_tenants, selected_tenant
    FROM tenants
   WHERE lower(name) = lower(recovery_tenant)
      OR lower(slug) = lower(regexp_replace(recovery_tenant, '[^a-zA-Z0-9]+', '-', 'g'))
      OR name ILIKE '%' || recovery_tenant || '%';

  IF matched_tenants = 0 THEN
    RAISE EXCEPTION 'No se encontró la empresa "%"', recovery_tenant;
  ELSIF matched_tenants > 1 THEN
    RAISE EXCEPTION 'Hay varias empresas que coinciden con "%"', recovery_tenant;
  END IF;

  INSERT INTO users (email, password_hash, full_name, is_active, tenant_id)
  VALUES (lower(recovery_email), recovery_hash, 'Super Administrador Suros', true, selected_tenant)
  ON CONFLICT (email) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        full_name = EXCLUDED.full_name,
        is_active = true,
        tenant_id = EXCLUDED.tenant_id,
        updated_at = now()
  RETURNING id INTO recovered_user;

  DELETE FROM user_roles WHERE user_id = recovered_user;
  INSERT INTO user_roles (user_id, role) VALUES (recovered_user, 'super_admin'::app_role);
END
$recover$;
COMMIT;
SELECT u.email || '|' || t.name || '|super_admin'
  FROM users u JOIN tenants t ON t.id = u.tenant_id
 WHERE u.email = lower(:'email');
SQL
)"
unset PASSWORD_HASH

if [ -z "$RESULT" ]; then
  echo -e "${RED}No se pudo verificar la cuenta recuperada.${NC}" >&2
  exit 1
fi

echo -e "${GREEN}Acceso recuperado correctamente: ${RESULT}${NC}"
echo "Inicia sesión con ${EMAIL} y la contraseña que acabas de definir."
