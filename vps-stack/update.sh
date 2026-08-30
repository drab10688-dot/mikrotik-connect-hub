#!/bin/bash
# ============================================
# OmniSync - Actualización COMPLETA (API + Frontend)
# Ejecutar DESDE EL VPS:  bash update.sh
# ============================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

INSTALL_DIR="/opt/omnisync"
FRONTEND_DIR="$INSTALL_DIR/frontend/dist"
REPO_URL="${REPO_URL:-https://github.com/drab10688-dot/mikrotik-connect-hub.git}"
BRANCH="${BRANCH:-main}"

echo -e "${CYAN}=== OmniSync :: Actualización completa ===${NC}"

command -v git >/dev/null || { apt-get update && apt-get install -y git; }
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

TEMP_DIR=$(mktemp -d)
echo -e "${YELLOW}1/5 Descargando código (${BRANCH})...${NC}"
git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$TEMP_DIR"
cd "$TEMP_DIR"
COMMIT=$(git log -1 --format='%h %ad %s' --date=short)
echo -e "${GREEN}Commit descargado: ${COMMIT}${NC}"

echo -e "${YELLOW}2/5 Sincronizando stack (preservando .env y datos)...${NC}"
mkdir -p "$INSTALL_DIR"
rsync -a --delete \
  --exclude '.env' \
  --exclude 'frontend' \
  --exclude 'data' \
  --exclude '*.log' \
  "$TEMP_DIR/vps-stack/" "$INSTALL_DIR/"

echo -e "${YELLOW}3/5 Reconstruyendo API (sin caché)...${NC}"
cd "$INSTALL_DIR"
grep -q '^BROWSER_USER=' .env || echo 'BROWSER_USER=admin' >> .env
grep -q '^BROWSER_PASSWORD=' .env || echo "BROWSER_PASSWORD=$(openssl rand -hex 12)" >> .env
grep -q '^BROWSER_HOME_URL=' .env || echo 'BROWSER_HOME_URL=about:blank' >> .env
docker compose build --no-cache api
docker compose pull remote-browser
docker compose up -d api remote-browser
bash "$INSTALL_DIR/configure-browser-routing.sh"

echo -e "${YELLOW}4/5 Compilando frontend...${NC}"
cd "$TEMP_DIR"
echo "VITE_API_BASE_URL=/api" > .env.production
npm install --legacy-peer-deps 2>/dev/null || npm install
npm run build
mkdir -p "$FRONTEND_DIR"
rm -rf "${FRONTEND_DIR:?}"/*
cp -r dist/* "$FRONTEND_DIR"/
echo "$COMMIT" > "$FRONTEND_DIR/VERSION.txt"

echo -e "${YELLOW}5/5 Reiniciando Nginx...${NC}"
cd "$INSTALL_DIR"
docker compose up -d nginx remote-browser
docker compose restart nginx

cd /root && rm -rf "$TEMP_DIR"

echo -e "${GREEN}=== Actualizado ✓  (${COMMIT}) ===${NC}"
echo "Verifica versión desplegada:  curl -s http://localhost/VERSION.txt"
echo "Logs API:                     docker compose -f $INSTALL_DIR/docker-compose.yml logs --tail=50 api"
echo -e "${CYAN}Recuerda en el navegador: Ctrl+Shift+R (recarga forzada)${NC}"
