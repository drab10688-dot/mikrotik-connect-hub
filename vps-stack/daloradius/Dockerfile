FROM php:8.2-apache

RUN apt-get update && apt-get install -y \
    git unzip libfreetype6-dev libjpeg62-turbo-dev libpng-dev \
    libmariadb-dev libgd-dev default-mysql-client \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) gd mysqli pdo pdo_mysql \
    && a2enmod rewrite \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Clone daloRADIUS into web root
RUN git clone --depth 1 https://github.com/lirantal/daloradius.git /tmp/daloradius \
    && cp -r /tmp/daloradius/. /var/www/html/ \
    && rm -rf /tmp/daloradius \
    && rm -f /var/www/html/index.html

# Apache config for port 8000
RUN sed -i 's/80/8000/g' /etc/apache2/sites-available/000-default.conf \
    && sed -i 's/Listen 80/Listen 8000/g' /etc/apache2/ports.conf

# Enable .htaccess
RUN sed -i '/<Directory \/var\/www\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf

# Set permissions
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["apache2-foreground"]
