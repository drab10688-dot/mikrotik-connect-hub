-- Base fallback for local docker compose runs.
-- install.sh will overwrite this file with a secure random password.
CREATE DATABASE IF NOT EXISTS phpnuxbill CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS 'nuxbill'@'%' IDENTIFIED BY 'changeme_nuxbill';
GRANT ALL PRIVILEGES ON phpnuxbill.* TO 'nuxbill'@'%';
-- PHPNuxBill needs access to the radius database for its RADIUS module
GRANT ALL PRIVILEGES ON radius.* TO 'nuxbill'@'%';
FLUSH PRIVILEGES;
