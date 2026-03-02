#!/bin/bash
# ============================================
# OmniSync - Deploy Frontend al VPS
# Ejecutar DESDE EL VPS
# ============================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

INSTALL_DIR="/opt/omnisync"
FRONTEND_DIR="$INSTALL_DIR/frontend/dist"
REPO_URL="https://github.com/drab10688-dot/mikrotik-connect-hub.git"

echo -e "${CYAN}╔══════════════════════════════════════════════╗"
echo "║     OmniSync - Deploy Frontend               ║"
echo "╚══════════════════════════════════════════════╝${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}Instalando Node.js 20...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  echo -e "${GREEN}Node.js instalado ✓${NC}"
fi

echo -e "${YELLOW}Descargando código fuente...${NC}"
TEMP_DIR=$(mktemp -d)
git clone --depth 1 "$REPO_URL" "$TEMP_DIR"

cd "$TEMP_DIR"

# Configure API URL to point to localhost VPS API
VPS_IP=$(hostname -I | awk '{print $1}')
echo "VITE_API_BASE_URL=http://$VPS_IP:3000/api" > .env.production

echo -e "${YELLOW}Instalando dependencias...${NC}"
npm install --legacy-peer-deps 2>/dev/null || npm install

echo -e "${YELLOW}Compilando frontend...${NC}"
npm run build

# Copy built files
echo -e "${YELLOW}Desplegando archivos...${NC}"
mkdir -p "$FRONTEND_DIR"
rm -rf "$FRONTEND_DIR"/*
cp -r dist/* "$FRONTEND_DIR"/

# Cleanup
cd /root
rm -rf "$TEMP_DIR"

# Restart nginx
echo -e "${YELLOW}Reiniciando Nginx...${NC}"
docker compose -f "$INSTALL_DIR/docker-compose.yml" restart nginx

echo -e "${GREEN}╔══════════════════════════════════════════════╗"
echo "║     ✓ Frontend desplegado correctamente       ║"
echo "║                                               ║"
echo "║  Accede a: http://$VPS_IP                      ║"
echo "╚══════════════════════════════════════════════╝${NC}"
