#!/bin/bash
set -e

# Configure daloRADIUS database connection
# Try multiple known config file locations
CONFIG_LOCATIONS=(
  "/var/www/html/library/daloradius.conf.php"
  "/var/www/html/app/common/includes/daloradius.conf.php"
)

for CONFIG_FILE in "${CONFIG_LOCATIONS[@]}"; do
  if [ -f "$CONFIG_FILE" ]; then
    echo "Configurando daloRADIUS en: $CONFIG_FILE"
    sed -i "s/\$configValues\['CONFIG_DB_HOST'\] = .*/\$configValues['CONFIG_DB_HOST'] = '${MYSQL_HOST:-mariadb}';/" "$CONFIG_FILE"
    sed -i "s/\$configValues\['CONFIG_DB_PORT'\] = .*/\$configValues['CONFIG_DB_PORT'] = '${MYSQL_PORT:-3306}';/" "$CONFIG_FILE"
    sed -i "s/\$configValues\['CONFIG_DB_USER'\] = .*/\$configValues['CONFIG_DB_USER'] = '${MYSQL_USER:-radius}';/" "$CONFIG_FILE"
    sed -i "s/\$configValues\['CONFIG_DB_PASS'\] = .*/\$configValues['CONFIG_DB_PASS'] = '${MYSQL_PASSWORD:-radiusdbpw}';/" "$CONFIG_FILE"
    sed -i "s/\$configValues\['CONFIG_DB_NAME'\] = .*/\$configValues['CONFIG_DB_NAME'] = '${MYSQL_DATABASE:-radius}';/" "$CONFIG_FILE"
    sed -i "s/\$configValues\['FREERADIUS_VERSION'\] = .*/\$configValues['FREERADIUS_VERSION'] = '3';/" "$CONFIG_FILE"
    echo "daloRADIUS configurado ✓"
  fi
done

# Import DB schema if tables don't exist yet
if command -v mysql &> /dev/null; then
  echo "Importando esquema de daloRADIUS si es necesario..."
  for sql_file in /var/www/html/contrib/db/fr3-mariadb-freeradius.sql /var/www/html/contrib/db/mariadb-daloradius.sql; do
    if [ -f "$sql_file" ]; then
      mysql -h "${MYSQL_HOST:-mariadb}" -u "${MYSQL_USER:-radius}" -p"${MYSQL_PASSWORD:-radiusdbpw}" "${MYSQL_DATABASE:-radius}" < "$sql_file" 2>/dev/null || true
    fi
  done
fi

exec "$@"