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

# Clone daloRADIUS - try tagged release first, then master
RUN git clone --depth 1 --branch 2.0 https://github.com/lirantal/daloradius.git /tmp/daloradius 2>/dev/null \
    || git clone --depth 1 https://github.com/lirantal/daloradius.git /tmp/daloradius \
    && cp -r /tmp/daloradius/. /var/www/html/ \
    && rm -rf /tmp/daloradius \
    && rm -f /var/www/html/index.html

# Debug: list what we got so we can see the structure in build logs
RUN echo "=== daloRADIUS file structure ===" && ls -la /var/www/html/ && echo "=== end ==="

# index.php router is created at runtime by entrypoint.sh
# (git clone overwrites any file created here during build)

# Pre-create config directories for both v1 and v2 layouts
RUN mkdir -p /var/www/html/app/common/includes \
    && mkdir -p /var/www/html/var \
    && mkdir -p /var/www/html/library

# Apache config for port 8000
RUN sed -i 's/80/8000/g' /etc/apache2/sites-available/000-default.conf \
    && sed -i 's/Listen 80/Listen 8000/g' /etc/apache2/ports.conf

# Enable .htaccess and fix DocumentRoot permissions
RUN sed -i '/<Directory \/var\/www/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf

# Also ensure DirectoryIndex includes index.php
RUN echo "DirectoryIndex index.php index.html" >> /etc/apache2/apache2.conf

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
