FROM php:8.2-apache

RUN apt-get update && apt-get install -y \
    git unzip libfreetype6-dev libjpeg62-turbo-dev libpng-dev \
    libmariadb-dev libgd-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) gd mysqli pdo pdo_mysql \
    && a2enmod rewrite \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install PEAR and DB package (required by daloRADIUS)
RUN curl -fsSL https://pear.php.net/go-pear.phar -o /tmp/go-pear.phar \
    && php /tmp/go-pear.phar || true \
    && pear install DB || true \
    && rm -f /tmp/go-pear.phar

# Clone daloRADIUS
RUN git clone --depth 1 https://github.com/lirantal/daloradius.git /tmp/daloradius \
    && cp -r /tmp/daloradius/. /var/www/html/ \
    && rm -rf /tmp/daloradius \
    && rm -f /var/www/html/index.html

# Fallback entrypoint for newer daloRADIUS layouts
RUN if [ ! -f /var/www/html/index.php ]; then \
      printf '%s\n' \
        "<?php" \
        "\$targets = [" \
        "  'login.php'," \
        "  'app/users/login.php'," \
        "  'app/operators/login.php'," \
        "  'app/index.php'" \
        "];" \
        "" \
        "foreach (\$targets as \$target) {" \
        "  if (file_exists(__DIR__ . '/' . \$target)) {" \
        "    header('Location: ' . \$target);" \
        "    exit;" \
        "  }" \
        "}" \
        "" \
        "http_response_code(500);" \
        "echo 'daloRADIUS entrypoint not found';" \
        > /var/www/html/index.php; \
    fi

# Pre-create config directory for v2 layout
RUN mkdir -p /var/www/html/app/common/includes \
    && mkdir -p /var/www/html/var \
    && mkdir -p /var/www/html/library

# Apache config for port 8000
RUN sed -i 's/80/8000/g' /etc/apache2/sites-available/000-default.conf \
    && sed -i 's/Listen 80/Listen 8000/g' /etc/apache2/ports.conf

# Enable .htaccess
RUN sed -i '/<Directory \/var\/www/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf

# Suppress PHP warnings in production
RUN { \
      echo 'display_errors=Off'; \
      echo 'log_errors=On'; \
      echo 'error_reporting=E_ALL & ~E_DEPRECATED & ~E_NOTICE & ~E_WARNING'; \
    } > /usr/local/etc/php/conf.d/zz-production.ini

# Set permissions
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["apache2-foreground"]
