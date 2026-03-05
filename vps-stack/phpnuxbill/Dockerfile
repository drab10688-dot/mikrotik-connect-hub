FROM php:8.1-apache

# ── System deps + PHP extensions ──
RUN apt-get update && apt-get install -y --no-install-recommends \
    git unzip cron curl default-mysql-client \
    libfreetype6-dev libjpeg62-turbo-dev libpng-dev \
    libmariadb-dev libgd-dev libcurl4-openssl-dev libzip-dev \
  && docker-php-ext-configure gd --with-freetype --with-jpeg \
  && docker-php-ext-install -j$(nproc) gd mysqli pdo pdo_mysql curl zip \
  && a2enmod rewrite headers \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# ── Clone PHPNuxBill from official repo ──
RUN git clone --depth 1 https://github.com/hotspotbilling/phpnuxbill.git /tmp/phpnuxbill \
  && rm -rf /var/www/html/* \
  && cp -a /tmp/phpnuxbill/. /var/www/html/ \
  && rm -rf /tmp/phpnuxbill /var/www/html/.git /var/www/html/index.html

# ── Apache: listen on 8080 ──
RUN sed -i 's/80/8080/g' /etc/apache2/sites-available/000-default.conf \
  && sed -i 's/Listen 80/Listen 8080/g' /etc/apache2/ports.conf

# ── Enable .htaccess ──
RUN sed -i '/<Directory \/var\/www\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' \
    /etc/apache2/apache2.conf

# ── PHP production settings ──
RUN { \
  echo 'display_errors=Off'; \
  echo 'log_errors=On'; \
  echo 'error_log=/var/log/php_errors.log'; \
  echo 'error_reporting=E_ALL & ~E_DEPRECATED & ~E_NOTICE & ~E_WARNING'; \
  echo 'upload_max_filesize=20M'; \
  echo 'post_max_size=25M'; \
  echo 'memory_limit=256M'; \
  echo 'max_execution_time=120'; \
} > /usr/local/etc/php/conf.d/zz-production.ini

# ── Ensure writable dirs exist ──
RUN mkdir -p /var/www/html/system/uploads \
             /var/www/html/system/cache \
             /var/www/html/pages \
             /var/www/html/ui/themes \
             /var/www/html/ui/cache

# ── Ownership ──
RUN chown -R www-data:www-data /var/www/html \
  && chmod -R 755 /var/www/html \
  && chmod -R 775 /var/www/html/system/uploads \
                   /var/www/html/system/cache \
                   /var/www/html/ui/cache

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
CMD ["apache2-foreground"]
