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

# Firefox remoto: descarga tolerante a fallos (reintentos + espejo docker.io)
pull_browser() {
  for i in 1 2 3; do
    docker compose pull remote-browser && return 0
    echo -e "${YELLOW}⚠ Reintento $i/3 de descarga de Firefox...${NC}" && sleep 5
  done
  docker pull docker.io/linuxserver/firefox:latest \
    && docker tag docker.io/linuxserver/firefox:latest lscr.io/linuxserver/firefox:latest \
    && return 0
  echo -e "${YELLOW}⚠ No se pudo descargar Firefox remoto; el panel seguirá con el proxy integrado.${NC}"
  return 1
}
BROWSER_OK=0
pull_browser && BROWSER_OK=1
docker compose up -d api
[ "$BROWSER_OK" = "1" ] && docker compose up -d remote-browser || true
bash "$INSTALL_DIR/configure-browser-routing.sh"

# Actualiza también el servidor L2TP, sus hooks de rutas y el watchdog que
# hace reconectar la MikroTik automáticamente después de una caída.
set -a
. "$INSTALL_DIR/.env"
set +a
bash "$INSTALL_DIR/install-l2tp.sh" --onu-nets "${ONU_NETS:-10.82.0.0/21}"

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
docker compose up -d nginx
[ "$BROWSER_OK" = "1" ] && docker compose up -d remote-browser || true
docker compose restart nginx

# Verifica el Firefox remoto (causa habitual de 502 en /browser/)
if [ "$BROWSER_OK" = "1" ]; then
  sleep 5
  if [ "$(docker inspect -f '{{.State.Running}}' omnisync-browser 2>/dev/null)" != "true" ]; then
    echo -e "${YELLOW}⚠ Firefox remoto no está corriendo. Reintentando...${NC}"
    docker compose up -d --force-recreate remote-browser || true
    sleep 5
    docker compose logs --tail=40 remote-browser || true
  fi
fi

cd /root && rm -rf "$TEMP_DIR"

echo -e "${GREEN}=== Actualizado ✓  (${COMMIT}) ===${NC}"
echo "Verifica versión desplegada:  curl -s http://localhost/VERSION.txt"
echo "Logs API:                     docker compose -f $INSTALL_DIR/docker-compose.yml logs --tail=50 api"
echo -e "${CYAN}Recuerda en el navegador: Ctrl+Shift+R (recarga forzada)${NC}"
