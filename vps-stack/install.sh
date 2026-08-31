#!/bin/bash
# ============================================
# OmniACS — Instalador VPS
# Panel de gestión de ONUs (TR-069 + VPN L2TP) multi-ISP
# Compatible: Ubuntu 20.04/22.04/24.04 · Debian 11/12
#
# Servicios que levanta:
#   PostgreSQL · API Node · Nginx · MongoDB · GenieACS · coturn (STUN) · L2TP (sin IPsec)
#   Escritorio remoto privado por usuario (Chromium/KasmVNC bajo demanda, puerto 8081)
# NO instala: PHPNuxBill, FreeRADIUS, Mikhmon, C-Data CMS, UISP, Winbox
# ============================================

set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

REPO_URL="https://github.com/drab10688-dot/mikrotik-connect-hub.git"
INSTALL_DIR="/opt/omnisync"
# Redes de ONUs/antenas detrás de la MikroTik (PPPoE 192.168.x.x cubierto por /16)
ONU_NETS="${ONU_NETS:-192.168.0.0/16}"

is_public_ipv4() {
  local ip="$1"
  echo "$ip" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || return 1
  case "$ip" in
    10.*|127.*|169.254.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) return 1 ;;
  esac
  return 0
}

detect_public_ip() {
  local detected=""
  for provider in ifconfig.me api.ipify.org icanhazip.com; do
    detected=$(curl -s -4 --max-time 5 "$provider" 2>/dev/null | tr -d '[:space:]' || true)
    if is_public_ipv4 "$detected"; then echo "$detected"; return 0; fi
  done
  return 1
}

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║   OmniACS — Gestión de ONUs multi-ISP        ║"
echo "║   TR-069 (GenieACS) + VPN L2TP/IPsec         ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: ejecuta este script como root (sudo)${NC}"; exit 1
fi

# ═══ FASE 1: Dependencias ═══
echo -e "${CYAN}═══ FASE 1/5: Dependencias ═══${NC}"

command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git curl; }
command -v openssl >/dev/null 2>&1 || apt-get install -y -qq openssl
command -v crontab >/dev/null 2>&1 || apt-get install -y -qq cron || true

if ! command -v docker >/dev/null 2>&1; then
  echo -e "${YELLOW}Instalando Docker...${NC}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker && systemctl start docker
fi
docker compose version >/dev/null 2>&1 || apt-get install -y -qq docker-compose-plugin

if ! command -v node >/dev/null 2>&1; then
  echo -e "${YELLOW}Instalando Node.js 20...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
echo -e "${GREEN}✓ Dependencias listas${NC}"

# ═══ FASE 2: Código + panel web ═══
echo ""
echo -e "${CYAN}═══ FASE 2/5: Descargando y compilando el panel ═══${NC}"

TEMP_DIR=$(mktemp -d)
git clone --depth 1 "$REPO_URL" "$TEMP_DIR"

mkdir -p "$INSTALL_DIR"
[ -f "$INSTALL_DIR/.env" ] && cp "$INSTALL_DIR/.env" /tmp/omniacs-env-backup
cp -r "$TEMP_DIR"/vps-stack/* "$INSTALL_DIR"/
[ -f /tmp/omniacs-env-backup ] && cp /tmp/omniacs-env-backup "$INSTALL_DIR/.env"
echo -e "${GREEN}✓ Stack copiado${NC}"

echo -e "${YELLOW}Compilando panel web (unos minutos)...${NC}"
cd "$TEMP_DIR"
echo "VITE_API_BASE_URL=/api" > .env.production
npm install --legacy-peer-deps 2>/dev/null || npm install
npm run build

FRONTEND_DIR="$INSTALL_DIR/frontend/dist"
mkdir -p "$FRONTEND_DIR"
rm -rf "${FRONTEND_DIR:?}"/*
cp -r dist/* "$FRONTEND_DIR"/
git -C "$TEMP_DIR" log -1 --format='%h %ad %s' --date=short > "$INSTALL_DIR/VERSION.txt" 2>/dev/null || true
cp -f "$INSTALL_DIR/VERSION.txt" "$FRONTEND_DIR/VERSION.txt" 2>/dev/null || true
cd /root && rm -rf "$TEMP_DIR"
echo -e "${GREEN}✓ Panel compilado${NC}"

# ═══ FASE 3: Configuración ═══
echo ""
echo -e "${CYAN}═══ FASE 3/5: Configuración ═══${NC}"
cd "$INSTALL_DIR"

VPS_PUBLIC_IP=$(detect_public_ip || true)
if ! is_public_ipv4 "$VPS_PUBLIC_IP"; then
  echo -e "${RED}✗ No se detectó IP pública válida. Revisa DNS/salida a Internet.${NC}"; exit 1
fi
echo -e "${CYAN}→ IP pública: ${VPS_PUBLIC_IP}${NC}"

if [ ! -f .env ]; then
  cat > .env << EOF
# Auto-generado - $(date)
DB_NAME=omnisync
DB_USER=omnisync
DB_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRES_IN=7d
MIKROTIK_HOST=
MIKROTIK_PORT=443
MIKROTIK_USER=
MIKROTIK_PASS=
GENIEACS_JWT_SECRET=$(openssl rand -hex 24)
GENIEACS_NBI_URL=http://genieacs:7557
BROWSER_HOME_URL=about:blank
VPS_PUBLIC_IP=${VPS_PUBLIC_IP}
TZ=America/Bogota
EOF
  echo -e "${GREEN}✓ .env generado${NC}"
else
  grep -q '^BROWSER_HOME_URL=' .env || echo "BROWSER_HOME_URL=about:blank" >> .env
  grep -q '^VPS_PUBLIC_IP=' .env && sed -i "s|^VPS_PUBLIC_IP=.*|VPS_PUBLIC_IP=${VPS_PUBLIC_IP}|" .env \
    || echo "VPS_PUBLIC_IP=${VPS_PUBLIC_IP}" >> .env
  echo -e "${GREEN}✓ .env existente conservado${NC}"
fi

# shellcheck disable=SC1091
set -a; . "$INSTALL_DIR/.env"; set +a

mkdir -p nginx/certs frontend/dist scripts
if [ ! -f nginx/certs/remote.crt ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout nginx/certs/remote.key -out nginx/certs/remote.crt \
    -subj "/CN=omnisync-remote" >/dev/null 2>&1
fi

if command -v ufw >/dev/null 2>&1; then
  # 8081 = escritorio remoto privado (HTTPS + token). Los escritorios por
  # usuario NO publican puertos: sólo son accesibles a través de Nginx.
  for p in 80/tcp 443/tcp 7547/tcp 7547/udp 7557/tcp 7567/tcp 3001/tcp 3478/tcp 3478/udp 1701/udp 8081/tcp; do
    ufw allow "$p" >/dev/null 2>&1 || true
  done
  # Restos de versiones anteriores (Winbox 8082 y escritorios por ISP 8100-8129)
  ufw delete allow 8082/tcp >/dev/null 2>&1 || true
  ufw delete allow 8100:8129/tcp >/dev/null 2>&1 || true
  echo -e "${GREEN}✓ Puertos abiertos en firewall${NC}"
fi

# ═══ FASE 4: Docker ═══
echo ""
echo -e "${CYAN}═══ FASE 4/5: Iniciando servicios ═══${NC}"

docker compose down --remove-orphans 2>/dev/null || true
# Restos de instalaciones anteriores (NuxBill/RADIUS/Mikhmon/CMS/Winbox) — ya no se usan
for cname in omnisync-mariadb omnisync-freeradius omnisync-phpnuxbill omnisync-mikhmon \
             omnisync-winbox omnisync-uisp \
             omnisync-postgres omnisync-api omnisync-nginx omnisync-genieacs omnisync-mongo; do
  docker rm -f "$cname" 2>/dev/null || true
done

if [ -f /opt/genieacs/docker-compose.yml ]; then
  echo -e "${YELLOW}Deteniendo GenieACS standalone en /opt/genieacs...${NC}"
  (cd /opt/genieacs && docker compose down 2>/dev/null) || true
fi
for gport in 7547 7557 7567 3001 3478; do
  conflict=$(docker ps --format '{{.Names}}\t{{.Ports}}' | grep ":${gport}->" | grep -v '^omnisync-' | cut -f1 || true)
  [ -n "$conflict" ] && docker stop $conflict >/dev/null 2>&1 || true
done

echo -e "${YELLOW}Construyendo API...${NC}"
docker compose build api

docker compose up -d postgres mongo genieacs coturn api nginx 2>&1 | tail -5
# TR-069 TCP :7547 lo publica NGINX (valida /tr069/<token>/ y añade X-Tenant-Token).
# --force-recreate garantiza el mapeo correcto aunque exista un despliegue previo.
docker compose up -d --force-recreate genieacs nginx 2>&1 | tail -3

# Imagen base de los escritorios remotos privados (Chromium + KasmVNC).
# Se precarga para que el primer usuario no espere la descarga.
echo -e "${YELLOW}Descargando navegador remoto (Chromium, sin clave: lo protege tu sesión)...${NC}"
docker compose pull remote-browser 2>&1 | tail -2 || true
docker compose up -d remote-browser 2>&1 | tail -3 || echo -e "${YELLOW}⚠ Navegador remoto no disponible; se creará al primer uso${NC}"
ONU_NETS="$ONU_NETS" bash "$INSTALL_DIR/configure-browser-routing.sh"

echo -e "${YELLOW}Esperando estabilización (20s)...${NC}"
sleep 20

# Vistas, columnas y parámetros virtuales de GenieACS (señal óptica, WiFi, PPPoE)
if [ -f "$INSTALL_DIR/genieacs-config.sh" ]; then
  ACS_HOST="$VPS_PUBLIC_IP" bash "$INSTALL_DIR/genieacs-config.sh" 2>&1 | tail -8 \
    || echo -e "${YELLOW}⚠ Configuración GenieACS incompleta; reintenta: bash $INSTALL_DIR/genieacs-config.sh${NC}"
fi


# Migraciones idempotentes (esquema multi-ISP / ONUs)
if [ -d "$INSTALL_DIR/db/migrations" ]; then
  for f in "$INSTALL_DIR"/db/migrations/*.sql; do
    [ -f "$f" ] || continue
    docker exec -i omnisync-postgres psql -U "${DB_USER:-omnisync}" -d "${DB_NAME:-omnisync}" < "$f" >/dev/null 2>&1 \
      && echo -e "${GREEN}✓ Migración $(basename "$f")${NC}" \
      || echo -e "${YELLOW}⚠ Migración $(basename "$f") omitida${NC}"
  done
fi

# ═══ VPN principal: L2TP (sin IPsec, más estable con NAT) ═══
echo ""
echo -e "${CYAN}═══ VPN principal: L2TP ═══${NC}"
if VPS_PUBLIC_IP="$VPS_PUBLIC_IP" bash "$INSTALL_DIR/install-l2tp.sh" --onu-nets "$ONU_NETS"; then
  echo -e "${GREEN}✓ VPN L2TP lista — script MikroTik en /opt/omnisync-l2tp/mikrotik-l2tp.rsc${NC}"
else
  echo -e "${YELLOW}⚠ L2TP no se levantó; reintenta: bash $INSTALL_DIR/install-l2tp.sh${NC}"
fi

# ═══ FASE 5: Verificación ═══
echo ""
echo -e "${CYAN}═══ FASE 5/5: Verificación ═══${NC}"

TOTAL_FAIL=0
check_service() {
  local name=$1 container=$2
  if [ "$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null)" = "running" ]; then
    echo -e "  ${GREEN}✓ $name${NC}"
  else
    echo -e "  ${RED}✗ $name — FALLO${NC}"
    docker logs "$container" --tail 8 2>&1 | sed 's/^/    /'
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
  fi
}

check_service "PostgreSQL"      "omnisync-postgres"
check_service "API Backend"     "omnisync-api"
check_service "Nginx"           "omnisync-nginx"
check_service "MongoDB (ACS)"   "omnisync-mongo"
check_service "GenieACS TR-069" "omnisync-genieacs"
check_service "coturn (STUN)"   "omnisync-coturn"
check_service "Navegador remoto" "omnisync-browser"
check_service "VPN L2TP"         "omnisync-l2tp"

ACS_CWMP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:7547 2>/dev/null || true)
if [ "$ACS_CWMP_STATUS" = "405" ]; then
  echo -e "  ${GREEN}✓ GenieACS CWMP responde en :7547${NC}"
else
  echo -e "  ${YELLOW}⚠ GenieACS CWMP HTTP ${ACS_CWMP_STATUS:-000} (revisa logs)${NC}"
fi

# Enlace TR-069 por ISP: /tr069/<token>/ debe pasar por Nginx (no directo a GenieACS)
TR069_TOKEN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  http://127.0.0.1:7547/tr069/0000000000000000/ 2>/dev/null || true)
if [ "$TR069_TOKEN_STATUS" = "405" ] || [ "$TR069_TOKEN_STATUS" = "200" ]; then
  echo -e "  ${GREEN}✓ Enlace TR-069 por ISP activo: http://${VPS_PUBLIC_IP}:7547/tr069/<token>/${NC}"
else
  echo -e "  ${YELLOW}⚠ Ruta /tr069/<token>/ HTTP ${TR069_TOKEN_STATUS:-000} — recrea proxy: docker compose up -d --force-recreate genieacs nginx${NC}"
fi
if command -v ufw >/dev/null 2>&1; then
  ufw allow 7547/tcp >/dev/null 2>&1 || true
fi


# Aislamiento del navegador remoto (sin salida a internet, sólo redes privadas)
if [ -f "$INSTALL_DIR/browser-firewall.sh" ]; then
  bash "$INSTALL_DIR/browser-firewall.sh" || true
fi

echo ""
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║        OmniACS instalado correctamente       ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
else
  echo -e "${YELLOW}Instalación terminada con ${TOTAL_FAIL} servicio(s) en fallo.${NC}"
fi

echo ""
echo -e "  Panel web:        ${GREEN}http://${VPS_PUBLIC_IP}${NC}"
echo -e "  Escritorio remoto: ${GREEN}https://${VPS_PUBLIC_IP}:8081${NC}  (privado por usuario, sin clave: usa tu sesión del panel)"
echo -e "  GenieACS UI:      ${GREEN}http://${VPS_PUBLIC_IP}:3001${NC}  (admin/admin)"
echo -e "  TR-069 por ISP:   ${GREEN}http://${VPS_PUBLIC_IP}:7547/tr069/<token>/${NC}  (token en el panel → cada ISP ve solo sus ONUs)"
echo -e "  TR-069 por VPN:   ${GREEN}http://192.168.42.1:7547/tr069/<token>/${NC}"
echo -e "  Credenciales VPN: ${GREEN}/opt/omnisync-l2tp/vpn.conf${NC}"
echo -e "  Script MikroTik:  ${GREEN}/opt/omnisync-l2tp/mikrotik-l2tp.rsc${NC} (o genéralo desde el panel → Credenciales y VPN)"

echo ""
echo -e "  Logs:        ${CYAN}cd $INSTALL_DIR && docker compose logs -f${NC}"
echo -e "  Reconstruir: ${CYAN}cd $INSTALL_DIR && docker compose up -d --build${NC}"
echo -e "  Actualizar:  ${CYAN}cd $INSTALL_DIR && sudo bash update.sh${NC}"
echo -e "  Probar ONU:  ${CYAN}sudo bash $INSTALL_DIR/test-browser.sh 192.168.50.1 80${NC}"
echo -e "  HTTPS real (opcional, evita avisos de certificado):"
echo -e "               ${CYAN}sudo bash $INSTALL_DIR/setup-ssl.sh <tu-dominio> tucorreo@dominio.com${NC}"
echo ""
