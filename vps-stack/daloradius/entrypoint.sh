#!/bin/bash
set -e

# Configure daloRADIUS database connection
CONFIG_FILE="/var/www/html/library/daloradius.conf.php"

if [ -f "$CONFIG_FILE" ]; then
  sed -i "s/\$configValues\['CONFIG_DB_HOST'\] = .*/\$configValues['CONFIG_DB_HOST'] = '${MYSQL_HOST:-mariadb}';/" "$CONFIG_FILE"
  sed -i "s/\$configValues\['CONFIG_DB_PORT'\] = .*/\$configValues['CONFIG_DB_PORT'] = '${MYSQL_PORT:-3306}';/" "$CONFIG_FILE"
  sed -i "s/\$configValues\['CONFIG_DB_USER'\] = .*/\$configValues['CONFIG_DB_USER'] = '${MYSQL_USER:-radius}';/" "$CONFIG_FILE"
  sed -i "s/\$configValues\['CONFIG_DB_PASS'\] = .*/\$configValues['CONFIG_DB_PASS'] = '${MYSQL_PASSWORD:-radiusdbpw}';/" "$CONFIG_FILE"
  sed -i "s/\$configValues\['CONFIG_DB_NAME'\] = .*/\$configValues['CONFIG_DB_NAME'] = '${MYSQL_DATABASE:-radius}';/" "$CONFIG_FILE"
  echo "daloRADIUS configurado ✓"
fi

exec "$@"
