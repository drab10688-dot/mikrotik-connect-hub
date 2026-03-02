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

REPO_URL="https://github.com/drab10688-dot/mikrotik-connect-hub.git"
INSTALL_DIR="/opt/omnisync"

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

# Install git if not present
if ! command -v git &> /dev/null; then
  echo -e "${YELLOW}Instalando git...${NC}"
  apt-get update -qq && apt-get install -y -qq git
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

# Clone repo
echo -e "${YELLOW}Descargando archivos del proyecto...${NC}"
TEMP_DIR=$(mktemp -d)
git clone --depth 1 "$REPO_URL" "$TEMP_DIR"

# Setup directory
mkdir -p "$INSTALL_DIR"
cp -r "$TEMP_DIR"/vps-stack/* "$INSTALL_DIR"/
rm -rf "$TEMP_DIR"
echo -e "${GREEN}Archivos descargados ✓${NC}"

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

# Create required directories
mkdir -p nginx/certs frontend/dist

# Build frontend placeholder
echo "<html><body><h1>OmniSync - Desplegando frontend...</h1></body></html>" > frontend/dist/index.html

# Open firewall ports
if command -v ufw &> /dev/null; then
  echo -e "${YELLOW}Abriendo puertos en firewall...${NC}"
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 3000/tcp
  ufw allow 8000/tcp
  ufw allow 19999/tcp
  ufw allow 1812/udp
  ufw allow 1813/udp
  echo -e "${GREEN}Puertos abiertos ✓${NC}"
fi

# Start services
echo -e "${YELLOW}Iniciando servicios (esto puede tardar unos minutos)...${NC}"
docker compose up -d --build

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗"
echo "║       ¡Instalación completada! ✓             ║"
echo "╠══════════════════════════════════════════════╣"
echo "║                                              ║"
echo "║  Panel Web:    http://$(hostname -I | awk '{print $1}')            ║"
echo "║  API:          http://$(hostname -I | awk '{print $1}'):3000       ║"
echo "║  daloRADIUS:   http://$(hostname -I | awk '{print $1}'):8000      ║"
echo "║  Netdata:      http://$(hostname -I | awk '{print $1}'):19999     ║"
echo "║                                              ║"
echo "║  Login: admin@omnisync.local / admin123       ║"
echo "║  ⚠ CAMBIA LA CONTRASEÑA INMEDIATAMENTE        ║"
echo "║                                              ║"
echo "╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Verifica el estado con: docker compose -f $INSTALL_DIR/docker-compose.yml ps${NC}"
