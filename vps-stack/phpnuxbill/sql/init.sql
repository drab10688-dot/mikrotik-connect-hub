-- PHPNuxBill Database Initialization
-- Creates the database and user for PHPNuxBill
-- The actual schema is created by PHPNuxBill's web installer

CREATE DATABASE IF NOT EXISTS phpnuxbill;
CREATE USER IF NOT EXISTS 'nuxbill'@'%' IDENTIFIED BY 'changeme_nuxbill';
GRANT ALL PRIVILEGES ON phpnuxbill.* TO 'nuxbill'@'%';
FLUSH PRIVILEGES;
