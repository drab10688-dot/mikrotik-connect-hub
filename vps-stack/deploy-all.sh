#!/usr/bin/env bash
# ============================================
# OmniSync - Deploy API + Frontend
# Actualiza código desde GitHub, reconstruye API y frontend
# Ejecutar DESDE EL VPS: bash /opt/omnisync/deploy-all.sh
# ============================================
set -Eeuo pipefail

APP_DIR="/opt/omnisync"
REPO_URL="https://github.com/drab10688-dot/mikrotik-connect-hub.git"
BRANCH="main"
DIST_DIR="$APP_DIR/frontend/dist"
TMP_DIR="$(mktemp -d)"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "╔══════════════════════════════════════════════╗"
echo "║  OmniSync - Deploy API + Frontend            ║"
echo "╚══════════════════════════════════════════════╝"

# ─── Prerequisites ─────────────────────────────
echo "[1/8] Verificando dependencias..."
apt-get update -y >/dev/null 2>&1 || true
apt-get install -y git curl rsync ca-certificates >/dev/null 2>&1 || true

if ! command -v node >/dev/null 2>&1; then
  echo "  → Instalando Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# ─── Clone ─────────────────────────────────────
echo "[2/8] Clonando repositorio..."
git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$TMP_DIR/app"

# ─── Update API source ────────────────────────
echo "[3/8] Actualizando código del API..."
# Preserve .env and docker volumes, only update source code
rsync -a --delete \
  --exclude='node_modules' \
  "$TMP_DIR/app/vps-stack/api/" "$APP_DIR/api/"

# Also update shared VPS files (docker-compose, db init, nginx, radius, etc.)
for item in docker-compose.yml db nginx radius mariadb-init daloradius phpnuxbill; do
  if [ -e "$TMP_DIR/app/vps-stack/$item" ]; then
    if [ -d "$TMP_DIR/app/vps-stack/$item" ]; then
      rsync -a "$TMP_DIR/app/vps-stack/$item/" "$APP_DIR/$item/"
    else
      cp "$TMP_DIR/app/vps-stack/$item" "$APP_DIR/$item"
    fi
  fi
done

# Copy deploy scripts
cp "$TMP_DIR/app/vps-stack/deploy-frontend.sh" "$APP_DIR/deploy-frontend.sh" 2>/dev/null || true
cp "$TMP_DIR/app/vps-stack/deploy-all.sh" "$APP_DIR/deploy-all.sh" 2>/dev/null || true
chmod +x "$APP_DIR"/*.sh 2>/dev/null || true

# ─── Rebuild API container ────────────────────
echo "[4/8] Reconstruyendo contenedor API..."
cd "$APP_DIR"
docker compose build --no-cache api

echo "[5/8] Reiniciando API..."
docker compose up -d api

# ─── Build Frontend ───────────────────────────
echo "[6/8] Compilando frontend..."
cd "$TMP_DIR/app"
echo "VITE_API_BASE_URL=/api" > .env.production
npm ci --legacy-peer-deps 2>/dev/null || npm install --legacy-peer-deps
npm run build

echo "[7/8] Desplegando frontend..."
mkdir -p "$DIST_DIR"
rsync -a --delete dist/ "$DIST_DIR/"

# ─── Restart Nginx ────────────────────────────
echo "[8/8] Reiniciando Nginx..."
cd "$APP_DIR"
docker compose restart nginx

VPS_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✓ API + Frontend desplegados correctamente  ║"
echo "║                                              ║"
echo "║  Panel: http://$VPS_IP                       ║"
echo "║  API:   http://$VPS_IP/api/health            ║"
echo "║                                              ║"
echo "║  Abre el panel y presiona Ctrl+F5            ║"
echo "╚══════════════════════════════════════════════╝"
