#!/bin/bash
set -e

echo "=== Configurando daloRADIUS ==="

# Find and configure daloRADIUS config file
CONFIG_LOCATIONS=(
  "/var/www/html/library/daloradius.conf.php"
  "/var/www/html/app/common/includes/daloradius.conf.php"
  "/var/www/html/daloradius/library/daloradius.conf.php"
  "/var/www/html/daloradius/app/common/includes/daloradius.conf.php"
)

CONFIGURED=false
for CONFIG_FILE in "${CONFIG_LOCATIONS[@]}"; do
  if [ -f "$CONFIG_FILE" ]; then
    echo "Config encontrado: $CONFIG_FILE"
    sed -i "s/\$configValues\['CONFIG_DB_HOST'\] = .*/\$configValues['CONFIG_DB_HOST'] = '${MYSQL_HOST:-mariadb}';/" "$CONFIG_FILE"
    sed -i "s/\$configValues\['CONFIG_DB_PORT'\] = .*/\$configValues['CONFIG_DB_PORT'] = '${MYSQL_PORT:-3306}';/" "$CONFIG_FILE"
    sed -i "s/\$configValues\['CONFIG_DB_USER'\] = .*/\$configValues['CONFIG_DB_USER'] = '${MYSQL_USER:-radius}';/" "$CONFIG_FILE"
    sed -i "s/\$configValues\['CONFIG_DB_PASS'\] = .*/\$configValues['CONFIG_DB_PASS'] = '${MYSQL_PASSWORD:-radiusdbpw}';/" "$CONFIG_FILE"
    sed -i "s/\$configValues\['CONFIG_DB_NAME'\] = .*/\$configValues['CONFIG_DB_NAME'] = '${MYSQL_DATABASE:-radius}';/" "$CONFIG_FILE"
    sed -i "s/\$configValues\['FREERADIUS_VERSION'\] = .*/\$configValues['FREERADIUS_VERSION'] = '3';/" "$CONFIG_FILE"
    CONFIGURED=true
    echo "daloRADIUS configurado ✓"
  fi
done

if [ "$CONFIGURED" = false ]; then
  echo "⚠ No se encontró archivo de configuración de daloRADIUS"
  echo "Archivos en /var/www/html:"
  ls -la /var/www/html/ 2>/dev/null | head -20
fi

# Wait for MariaDB and import schema if needed
echo "Esperando MariaDB..."
for i in $(seq 1 30); do
  if mysql -h "${MYSQL_HOST:-mariadb}" -u "${MYSQL_USER:-radius}" -p"${MYSQL_PASSWORD:-radiusdbpw}" -e "SELECT 1" "${MYSQL_DATABASE:-radius}" >/dev/null 2>&1; then
    echo "MariaDB conectada ✓"
    
    # Check if radcheck table exists (schema already imported)
    TABLE_EXISTS=$(mysql -h "${MYSQL_HOST:-mariadb}" -u "${MYSQL_USER:-radius}" -p"${MYSQL_PASSWORD:-radiusdbpw}" "${MYSQL_DATABASE:-radius}" -N -e "SHOW TABLES LIKE 'radcheck'" 2>/dev/null)
    
    if [ -z "$TABLE_EXISTS" ]; then
      echo "Importando esquema RADIUS..."
      # Try different schema file locations
      for sql_file in \
        /var/www/html/contrib/db/fr3-mariadb-freeradius.sql \
        /var/www/html/contrib/db/mariadb-freeradius.sql \
        /var/www/html/contrib/db/mysql-freeradius.sql \
        /var/www/html/daloradius/contrib/db/fr3-mariadb-freeradius.sql \
        /var/www/html/daloradius/contrib/db/mariadb-freeradius.sql \
        /var/www/html/daloradius/contrib/db/mysql-freeradius.sql; do
        if [ -f "$sql_file" ]; then
          echo "Importando: $sql_file"
          mysql -h "${MYSQL_HOST:-mariadb}" -u "${MYSQL_USER:-radius}" -p"${MYSQL_PASSWORD:-radiusdbpw}" "${MYSQL_DATABASE:-radius}" < "$sql_file" 2>/dev/null || true
          break
        fi
      done
      
      # Import daloRADIUS schema
      for sql_file in \
        /var/www/html/contrib/db/mariadb-daloradius.sql \
        /var/www/html/contrib/db/mysql-daloradius.sql \
        /var/www/html/daloradius/contrib/db/mariadb-daloradius.sql \
        /var/www/html/daloradius/contrib/db/mysql-daloradius.sql; do
        if [ -f "$sql_file" ]; then
          echo "Importando: $sql_file"
          mysql -h "${MYSQL_HOST:-mariadb}" -u "${MYSQL_USER:-radius}" -p"${MYSQL_PASSWORD:-radiusdbpw}" "${MYSQL_DATABASE:-radius}" < "$sql_file" 2>/dev/null || true
          break
        fi
      done
    else
      echo "Esquema RADIUS ya existe ✓"
    fi
    break
  fi
  echo "Reintentando ($i/30)..."
  sleep 2
done

exec "$@"
