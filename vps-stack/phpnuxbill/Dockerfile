FROM php:8.2-apache

RUN apt-get update && apt-get install -y \
    git unzip libfreetype6-dev libjpeg62-turbo-dev libpng-dev \
    libmariadb-dev libgd-dev libcurl4-openssl-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) gd mysqli pdo pdo_mysql curl \
    && a2enmod rewrite \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Clone PHPNuxBill
RUN git clone --depth 1 https://github.com/hotspotbilling/phpnuxbill.git /tmp/phpnuxbill \
    && cp -r /tmp/phpnuxbill/* /var/www/html/ 2>/dev/null || true \
    && cp -r /tmp/phpnuxbill/. /var/www/html/ 2>/dev/null || true \
    && rm -rf /tmp/phpnuxbill \
    && rm -f /var/www/html/index.html

# Apache config for port 8080
RUN sed -i 's/80/8080/g' /etc/apache2/sites-available/000-default.conf \
    && sed -i 's/Listen 80/Listen 8080/g' /etc/apache2/ports.conf

# Enable .htaccess
RUN sed -i '/<Directory \/var\/www\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf

# Production PHP settings
RUN { \
      echo 'display_errors=Off'; \
      echo 'log_errors=On'; \
      echo 'error_reporting=E_ALL & ~E_DEPRECATED & ~E_NOTICE & ~E_WARNING'; \
    } > /usr/local/etc/php/conf.d/zz-production.ini

# Ensure required dirs exist
RUN mkdir -p /var/www/html/system/uploads \
    && mkdir -p /var/www/html/system/cache \
    && mkdir -p /var/www/html/pages \
    && mkdir -p /var/www/html/ui/themes

# Set permissions
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
CMD ["apache2-foreground"]
