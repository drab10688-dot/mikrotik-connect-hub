#!/bin/bash
# ============================================
# OmniSync ISP Manager - Instalador VPS
# Compatible: Ubuntu 20.04+ / Debian 11+
# ============================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}"
echo "╔══════════════════════════════════════════╗"
echo "║     OmniSync ISP Manager Installer       ║"
echo "║     Docker Stack - All-in-One             ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# Check root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Ejecuta este script como root (sudo)${NC}"
  exit 1
fi

# Install Docker if not present
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}Instalando Docker...${NC}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo -e "${GREEN}Docker instalado ✓${NC}"
else
  echo -e "${GREEN}Docker ya instalado ✓${NC}"
fi

# Install Docker Compose plugin
if ! docker compose version &> /dev/null; then
  echo -e "${YELLOW}Instalando Docker Compose...${NC}"
  apt-get update -qq
  apt-get install -y -qq docker-compose-plugin
  echo -e "${GREEN}Docker Compose instalado ✓${NC}"
fi

# Setup directory
INSTALL_DIR="/opt/omnisync"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Generate secrets
JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)
RADIUS_DB_PASSWORD=$(openssl rand -hex 16)
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 16)

# Ask for MikroTik config
echo ""
echo -e "${YELLOW}Configuración MikroTik:${NC}"
read -p "Host/IP del MikroTik: " MIKROTIK_HOST
read -p "Puerto API REST (443): " MIKROTIK_PORT
MIKROTIK_PORT=${MIKROTIK_PORT:-443}
read -p "Usuario MikroTik: " MIKROTIK_USER
read -sp "Contraseña MikroTik: " MIKROTIK_PASS
echo ""

# Create .env
cat > .env << EOF
# Auto-generated - $(date)
DB_NAME=omnisync
DB_USER=omnisync
DB_PASSWORD=${DB_PASSWORD}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d
MIKROTIK_HOST=${MIKROTIK_HOST}
MIKROTIK_PORT=${MIKROTIK_PORT}
MIKROTIK_USER=${MIKROTIK_USER}
MIKROTIK_PASS=${MIKROTIK_PASS}
RADIUS_SECRET=testing123
RADIUS_DB_PASSWORD=${RADIUS_DB_PASSWORD}
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
TZ=America/Bogota
EOF

echo -e "${GREEN}.env generado ✓${NC}"

# Copy files (assumes they're in the same directory as this script)
echo -e "${YELLOW}Preparando archivos...${NC}"

# Create required directories
mkdir -p nginx/certs frontend/dist

# Placeholder frontend
echo "<html><body><h1>OmniSync - Build frontend and place in /opt/omnisync/frontend/dist/</h1></body></html>" > frontend/dist/index.html

# Start services
echo -e "${YELLOW}Iniciando servicios...${NC}"
docker compose up -d --build

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗"
echo "║   ¡Instalación completada!                ║"
echo "╠══════════════════════════════════════════╣"
echo "║                                            ║"
echo "║  Panel Web:    http://$(hostname -I | awk '{print $1}')         ║"
echo "║  API:          http://$(hostname -I | awk '{print $1}'):3000    ║"
echo "║  daloRADIUS:   http://$(hostname -I | awk '{print $1}'):8000   ║"
echo "║  Netdata:      http://$(hostname -I | awk '{print $1}'):19999  ║"
echo "║                                            ║"
echo "║  Login: admin@omnisync.local / admin123    ║"
echo "║  ⚠ CAMBIA LA CONTRASEÑA INMEDIATAMENTE     ║"
echo "║                                            ║"
echo "╚══════════════════════════════════════════╝${NC}"
