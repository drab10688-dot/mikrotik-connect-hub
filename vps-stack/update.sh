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
docker compose build --no-cache api
docker compose up -d api
# Navegador remoto: se actualiza/levanta SIN tocar el túnel L2TP.
docker compose pull remote-browser >/dev/null 2>&1 || true
# --force-recreate aplica cambios de seguridad/red aunque la imagen sea la misma.
docker compose up -d --force-recreate remote-browser >/dev/null 2>&1 || \
  echo -e "${YELLOW}⚠ Navegador remoto no disponible; el proxy integrado sigue activo${NC}"
# Winbox nativo bajo Wine (se construye local; la primera vez tarda varios minutos)
echo -e "${YELLOW}   Construyendo Winbox (Wine)... puede tardar${NC}"
if docker compose build remote-winbox 2>&1 | tail -5; then
  docker compose up -d --force-recreate remote-winbox 2>&1 | tail -3 || \
    echo -e "${YELLOW}⚠ Winbox remoto no arrancó; usa WebFig${NC}"
else
  echo -e "${YELLOW}⚠ No se pudo construir Winbox; el resto del sistema sigue igual${NC}"
fi
bash "$INSTALL_DIR/configure-browser-routing.sh"

# Conserva el servidor L2TP existente. El instalador ahora es idempotente:
# actualiza usuarios/hooks/rutas sin eliminar el contenedor ni cortar ppp0.
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
echo "$COMMIT" > "$INSTALL_DIR/VERSION.txt"

echo -e "${YELLOW}5/5 Validando y reiniciando Nginx...${NC}"
cd "$INSTALL_DIR"
# No reemplazar el proxy por una configuración inválida. Esta validación
# detecta llaves faltantes, upstreams mal escritos y directivas incorrectas.
if ! docker compose run --rm --no-deps nginx nginx -t; then
  echo -e "${RED}✗ Configuración Nginx inválida. No se reinició el proxy.${NC}"
  exit 1
fi
docker compose up -d nginx

# `docker compose up` puede mostrar "Started" aunque Nginx falle enseguida.
# Esperamos brevemente y comprobamos tanto el contenedor como el frontend.
NGINX_READY=false
for _ in $(seq 1 15); do
  if [ "$(docker inspect --format '{{.State.Running}}' omnisync-nginx 2>/dev/null || true)" = "true" ] && \
     curl -fsS --max-time 3 http://localhost/VERSION.txt >/dev/null 2>&1; then
    NGINX_READY=true
    break
  fi
  sleep 1
done
if [ "$NGINX_READY" != "true" ]; then
  echo -e "${RED}✗ Nginx no quedó activo; mostrando diagnóstico:${NC}"
  docker compose ps nginx || true
  docker compose logs --tail=50 nginx || true
  exit 1
fi

cd /root && rm -rf "$TEMP_DIR"

echo -e "${GREEN}=== Actualizado ✓  (${COMMIT}) ===${NC}"
echo "Verifica versión desplegada:  curl -s http://localhost/VERSION.txt"
echo "Logs API:                     docker compose -f $INSTALL_DIR/docker-compose.yml logs --tail=50 api"
echo "Probar navegador/ONU:         sudo bash $INSTALL_DIR/test-browser.sh 10.82.0.29 80"
echo -e "${CYAN}Recuerda en el navegador: Ctrl+Shift+R (recarga forzada)${NC}"
