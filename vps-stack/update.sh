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
  --exclude 'nginx/certs' \
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
# Certificado autofirmado para los escritorios remotos (KasmVNC exige HTTPS)
mkdir -p "$INSTALL_DIR/nginx/certs"
if [ ! -f "$INSTALL_DIR/nginx/certs/remote.crt" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "$INSTALL_DIR/nginx/certs/remote.key" \
    -out "$INSTALL_DIR/nginx/certs/remote.crt" \
    -subj "/CN=omnisync-remote" >/dev/null 2>&1
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
# Directorio reservado para futuras rutas de escritorios aislados.
mkdir -p /opt/omnisync/nginx-dyn
# Elimina bloques dinámicos anteriores: podían dejar Nginx caído si un
# contenedor/puerto de ISP ya no existía o estaba ocupado.
rm -f /opt/omnisync/nginx-dyn/browser-*.conf

# Garantiza el certificado TLS justo antes de validar (los escritorios 8081/8082 lo exigen)
mkdir -p "$INSTALL_DIR/nginx/certs"
if [ ! -s "$INSTALL_DIR/nginx/certs/remote.crt" ] || [ ! -s "$INSTALL_DIR/nginx/certs/remote.key" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "$INSTALL_DIR/nginx/certs/remote.key" \
    -out "$INSTALL_DIR/nginx/certs/remote.crt" \
    -subj "/CN=omnisync-remote" >/dev/null 2>&1
fi
# Validación aislada: `docker compose run` intentaba recrear redes y fallaba
# con "network has active endpoints". Usamos un contenedor efímero sin redes.
if ! docker run --rm --network none \
  -v "$INSTALL_DIR/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$INSTALL_DIR/nginx-dyn:/etc/nginx/conf.d:ro" \
  -v "$INSTALL_DIR/nginx/certs:/etc/nginx/certs:ro" \
  -v "$FRONTEND_DIR:/usr/share/nginx/html:ro" \
  nginx:alpine nginx -t; then
  echo -e "${RED}✗ Configuración Nginx inválida. No se reinició el proxy.${NC}"
  exit 1
fi
# --force-recreate: los cambios de mapeo de puertos (8081/8082) sólo se
# aplican si el contenedor se recrea; un simple `up -d` lo deja igual.
docker compose up -d --force-recreate nginx

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

# Firewall: puertos de los escritorios remotos (Chromium 8081 / Winbox 8082)
if command -v ufw >/dev/null 2>&1; then
  ufw allow 8081/tcp >/dev/null 2>&1 || true
  ufw allow 8082/tcp >/dev/null 2>&1 || true
  echo -e "${GREEN}✓ Puertos 8081/8082 abiertos en UFW${NC}"
fi

# Recrea el navegador remoto para aplicar perfil efímero / incógnito forzado
docker compose -f "$INSTALL_DIR/docker-compose.yml" up -d --force-recreate remote-browser >/dev/null 2>&1 || true

# Aislamiento del navegador remoto (sin salida a internet, sólo redes privadas)
if [ -f "$INSTALL_DIR/browser-firewall.sh" ]; then
  bash "$INSTALL_DIR/browser-firewall.sh" || true
fi

# Comprobación real de los escritorios remotos (HTTPS autofirmado)
for P in 8081 8082; do
  CODE=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "https://localhost:$P/" || echo 000)
  if [ "$CODE" = "000" ]; then
    echo -e "${RED}✗ Puerto $P no responde. Mapeo publicado:${NC}"
    docker port omnisync-nginx || true
  else
    echo -e "${GREEN}✓ Puerto $P responde (HTTP $CODE)${NC}"
  fi
done


cd /root && rm -rf "$TEMP_DIR"

echo -e "${GREEN}=== Actualizado ✓  (${COMMIT}) ===${NC}"
echo "Verifica versión desplegada:  curl -s http://localhost/VERSION.txt"
echo "Logs API:                     docker compose -f $INSTALL_DIR/docker-compose.yml logs --tail=50 api"
echo "Probar navegador/ONU:         sudo bash $INSTALL_DIR/test-browser.sh 10.82.0.29 80"
echo -e "${CYAN}Recuerda en el navegador: Ctrl+Shift+R (recarga forzada)${NC}"
