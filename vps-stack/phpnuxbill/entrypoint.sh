#!/bin/bash
set -e

# Auto-configure PHPNuxBill database connection
CONFIG_FILE="/var/www/html/config.php"

# Create config.php if PHPNuxBill has been installed (config created by installer)
# The first-time setup will be done via the web UI at http://IP:8080
# This script pre-creates the config to skip the installer if env vars are set

if [ -n "$NUXBILL_DB_HOST" ]; then
  cat > "$CONFIG_FILE" << PHPEOF
<?php
// Compatibilidad con distintas versiones de PHPNuxBill
\$db_host = '${NUXBILL_DB_HOST}';
\$db_user = '${NUXBILL_DB_USER}';
\$db_pass = '${NUXBILL_DB_PASS}';
\$db_password = '${NUXBILL_DB_PASS}';
\$db_name = '${NUXBILL_DB_NAME}';

define('APP_URL', '${NUXBILL_APP_URL:-http://localhost:8080}');
\$APP_URL = APP_URL;

\$_app_stage = 'Live';
\$app_stage = \$_app_stage;

\$APP_KEY = '$(openssl rand -hex 16 2>/dev/null || echo "omnisync_nuxbill_key_2024")';

date_default_timezone_set('${TZ:-America/Bogota}');
PHPEOF
  echo "PHPNuxBill config.php actualizado ✓"
fi

# Wait for MariaDB to be ready
echo "Esperando conexión a MariaDB..."
for i in $(seq 1 30); do
  if php -r "new mysqli('${NUXBILL_DB_HOST:-mariadb}', '${NUXBILL_DB_USER:-nuxbill}', '${NUXBILL_DB_PASS:-changeme}', '${NUXBILL_DB_NAME:-phpnuxbill}');" 2>/dev/null; then
    echo "MariaDB conectada ✓"
    break
  fi
  echo "Reintentando ($i/30)..."
  sleep 2
done

exec "$@"
