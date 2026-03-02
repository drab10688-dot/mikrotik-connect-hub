#!/bin/bash
# ============================================
# OmniSync ISP Manager - Instalador VPS
# Compatible: Ubuntu 20.04, 22.04, 24.04
#             Debian 11, 12
# ============================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_URL="https://github.com/drab10688-dot/mikrotik-connect-hub.git"
INSTALL_DIR="/opt/omnisync"

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║       OmniSync ISP Manager Installer         ║"
echo "║       Docker Stack - All-in-One               ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Compatible:                                  ║"
echo "║    • Ubuntu 20.04 / 22.04 / 24.04             ║"
echo "║    • Debian 11 / 12                           ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Check root ───────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Ejecuta este script como root (sudo)${NC}"
  exit 1
fi

# ─── Check OS ─────────────────────────────────────
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_NAME=$ID
  OS_VERSION=$VERSION_ID
  echo -e "${GREEN}Sistema detectado: $PRETTY_NAME${NC}"
  
  COMPATIBLE=false
  if [ "$OS_NAME" = "ubuntu" ]; then
    case "$OS_VERSION" in
      20.04|22.04|24.04) COMPATIBLE=true ;;
    esac
  elif [ "$OS_NAME" = "debian" ]; then
    case "$OS_VERSION" in
      11|12) COMPATIBLE=true ;;
    esac
  fi
  
  if [ "$COMPATIBLE" = false ]; then
    echo -e "${RED}⚠ Sistema no soportado oficialmente: $PRETTY_NAME${NC}"
    echo -e "${YELLOW}Versiones soportadas: Ubuntu 20.04/22.04/24.04, Debian 11/12${NC}"
    read -p "¿Deseas continuar de todos modos? (s/N): " FORCE_INSTALL < /dev/tty
    if [ "$FORCE_INSTALL" != "s" ] && [ "$FORCE_INSTALL" != "S" ]; then
      echo -e "${RED}Instalación cancelada.${NC}"
      exit 1
    fi
  fi
else
  echo -e "${YELLOW}⚠ No se pudo detectar el sistema operativo${NC}"
fi

# ─── Check existing installation ──────────────────
if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
  echo ""
  echo -e "${YELLOW}╔══════════════════════════════════════════════╗"
  echo "║  ⚠ OmniSync ya está instalado en este VPS    ║"
  echo "╚══════════════════════════════════════════════╝${NC}"
  echo ""
  echo "  1) Reinstalar (elimina todo y vuelve a instalar)"
  echo "  2) Actualizar (descarga código nuevo, mantiene datos)"
  echo "  3) Desinstalar (elimina todo completamente)"
  echo "  4) Cancelar"
  echo ""
  read -p "Selecciona una opción [1-4]: " OPTION < /dev/tty
  
  case "$OPTION" in
    1)
      echo -e "${YELLOW}Deteniendo servicios...${NC}"
      cd "$INSTALL_DIR" && docker compose down -v 2>/dev/null || true
      cd /root
      rm -rf "$INSTALL_DIR"
      echo -e "${GREEN}Instalación anterior eliminada ✓${NC}"
      ;;
    2)
      echo -e "${YELLOW}Actualizando archivos...${NC}"
      TEMP_DIR=$(mktemp -d)
      git clone --depth 1 "$REPO_URL" "$TEMP_DIR"
      cp "$INSTALL_DIR/.env" /tmp/omnisync-env-backup 2>/dev/null || true
      cp -r "$TEMP_DIR"/vps-stack/* "$INSTALL_DIR"/
      cp /tmp/omnisync-env-backup "$INSTALL_DIR/.env" 2>/dev/null || true
      rm -rf "$TEMP_DIR" /tmp/omnisync-env-backup
      cd "$INSTALL_DIR"
      docker compose up -d --build
      echo -e "${GREEN}✓ Actualización completada${NC}"
      echo -e "${YELLOW}Panel: http://$(hostname -I | awk '{print $1}')${NC}"
      exit 0
      ;;
    3)
      echo -e "${RED}⚠ Esto eliminará TODOS los datos, contenedores y configuración.${NC}"
      read -p "¿Estás seguro? Escribe 'ELIMINAR' para confirmar: " CONFIRM < /dev/tty
      if [ "$CONFIRM" = "ELIMINAR" ]; then
        cd "$INSTALL_DIR" && docker compose down -v 2>/dev/null || true
        rm -rf "$INSTALL_DIR"
        echo -e "${GREEN}OmniSync desinstalado completamente ✓${NC}"
      else
        echo -e "${YELLOW}Desinstalación cancelada.${NC}"
      fi
      exit 0
      ;;
    *)
      echo -e "${YELLOW}Instalación cancelada.${NC}"
      exit 0
      ;;
  esac
fi

# ═══════════════════════════════════════════════════
# FASE 1: Dependencias del sistema
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 1/5: Instalando dependencias del sistema ═══${NC}"

# Git
if ! command -v git &> /dev/null; then
  echo -e "${YELLOW}Instalando git...${NC}"
  apt-get update -qq && apt-get install -y -qq git
fi

# Docker
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}Instalando Docker...${NC}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo -e "${GREEN}Docker instalado ✓${NC}"
else
  echo -e "${GREEN}Docker ya instalado ✓${NC}"
fi

# Docker Compose
if ! docker compose version &> /dev/null; then
  echo -e "${YELLOW}Instalando Docker Compose...${NC}"
  apt-get update -qq
  apt-get install -y -qq docker-compose-plugin
  echo -e "${GREEN}Docker Compose instalado ✓${NC}"
fi

# Node.js
if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}Instalando Node.js 20...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  echo -e "${GREEN}Node.js instalado ✓${NC}"
else
  echo -e "${GREEN}Node.js ya instalado ✓${NC}"
fi

echo -e "${GREEN}✓ Dependencias listas${NC}"

# ═══════════════════════════════════════════════════
# FASE 2: Descargar proyecto y compilar frontend
# (El panel queda funcional PRIMERO para poder
#  hacer backups si un contenedor falla después)
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 2/5: Descargando proyecto y compilando panel web ═══${NC}"

TEMP_DIR=$(mktemp -d)
git clone --depth 1 "$REPO_URL" "$TEMP_DIR"
echo -e "${GREEN}Código descargado ✓${NC}"

# Copiar archivos del stack VPS
mkdir -p "$INSTALL_DIR"
cp -r "$TEMP_DIR"/vps-stack/* "$INSTALL_DIR"/
echo -e "${GREEN}Archivos del stack copiados ✓${NC}"

# Compilar frontend
echo -e "${YELLOW}Compilando panel web (esto puede tardar unos minutos)...${NC}"
cd "$TEMP_DIR"
echo "VITE_API_BASE_URL=/api" > .env.production
npm install --legacy-peer-deps 2>/dev/null || npm install
npm run build

# Desplegar frontend compilado
FRONTEND_DIR="$INSTALL_DIR/frontend/dist"
mkdir -p "$FRONTEND_DIR"
rm -rf "$FRONTEND_DIR"/*
cp -r dist/* "$FRONTEND_DIR"/
echo -e "${GREEN}✓ Panel web compilado y desplegado${NC}"

# Limpiar temp
cd /root
rm -rf "$TEMP_DIR"

# ═══════════════════════════════════════════════════
# FASE 3: Configuración
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 3/5: Configuración ═══${NC}"

cd "$INSTALL_DIR"

# Generar secretos
JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)
RADIUS_DB_PASSWORD=$(openssl rand -hex 16)
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 16)
NUXBILL_DB_PASSWORD=$(openssl rand -hex 16)

# MikroTik (opcional)
echo ""
echo -e "${YELLOW}Configuración MikroTik (opcional, puedes configurar después desde el panel):${NC}"
read -p "Host/IP del MikroTik (Enter para omitir): " MIKROTIK_HOST < /dev/tty
MIKROTIK_HOST=${MIKROTIK_HOST:-}
if [ -n "$MIKROTIK_HOST" ]; then
  read -p "Puerto API REST (443): " MIKROTIK_PORT < /dev/tty
  MIKROTIK_PORT=${MIKROTIK_PORT:-443}
  read -p "Usuario MikroTik (admin): " MIKROTIK_USER < /dev/tty
  MIKROTIK_USER=${MIKROTIK_USER:-admin}
  read -sp "Contraseña MikroTik: " MIKROTIK_PASS < /dev/tty
  echo ""
else
  MIKROTIK_PORT=443
  MIKROTIK_USER=""
  MIKROTIK_PASS=""
  echo -e "${CYAN}→ Podrás agregar dispositivos MikroTik desde el panel web${NC}"
fi

VPS_IP=$(hostname -I | awk '{print $1}')

# Crear .env
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
NUXBILL_DB_PASSWORD=${NUXBILL_DB_PASSWORD}
NUXBILL_APP_URL=http://${VPS_IP}:8080
TZ=America/Bogota
EOF

echo -e "${GREEN}.env generado ✓${NC}"

# Crear directorios necesarios
mkdir -p nginx/certs

# Firewall
if command -v ufw &> /dev/null; then
  echo -e "${YELLOW}Abriendo puertos en firewall...${NC}"
  ufw allow 80/tcp >/dev/null 2>&1
  ufw allow 443/tcp >/dev/null 2>&1
  ufw allow 3000/tcp >/dev/null 2>&1
  ufw allow 8000/tcp >/dev/null 2>&1
  ufw allow 8080/tcp >/dev/null 2>&1
  ufw allow 1812/udp >/dev/null 2>&1
  ufw allow 1813/udp >/dev/null 2>&1
  echo -e "${GREEN}Puertos abiertos ✓${NC}"
fi

# ═══════════════════════════════════════════════════
# FASE 4: Levantar servicios Docker
# (Frontend ya está desplegado, si algo falla
#  el usuario puede acceder al panel y hacer backup)
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 4/5: Iniciando servicios Docker ═══${NC}"
echo -e "${YELLOW}Construyendo e iniciando contenedores (esto puede tardar)...${NC}"

docker compose up -d --build

# Esperar a que los servicios se estabilicen
echo -e "${YELLOW}Esperando 15 segundos para estabilización...${NC}"
sleep 15

# ═══════════════════════════════════════════════════
# FASE 5: Verificación de servicios
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 5/5: Verificando servicios ═══${NC}"

TOTAL_OK=0
TOTAL_FAIL=0

check_service() {
  local name=$1
  local container=$2
  
  if docker ps --format '{{.Names}}' | grep -q "$container"; then
    local status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null)
    if [ "$status" = "running" ]; then
      echo -e "  ${GREEN}✓ $name ($container) — running${NC}"
      TOTAL_OK=$((TOTAL_OK + 1))
      return 0
    fi
  fi
  
  echo -e "  ${RED}✗ $name ($container) — FALLO${NC}"
  echo -e "    ${YELLOW}→ Logs: docker compose logs $container --tail 30${NC}"
  TOTAL_FAIL=$((TOTAL_FAIL + 1))
  return 1
}

check_service "PostgreSQL"  "omnisync-postgres"
check_service "API Backend" "omnisync-api"
check_service "Nginx"       "omnisync-nginx"
check_service "MariaDB"     "omnisync-mariadb"
check_service "FreeRADIUS"  "omnisync-freeradius"
check_service "daloRADIUS"  "omnisync-daloradius"
check_service "PHPNuxBill"  "omnisync-phpnuxbill"

echo ""
echo -e "${GREEN}Servicios OK: $TOTAL_OK${NC}  ${RED}Fallidos: $TOTAL_FAIL${NC}"

if [ "$TOTAL_FAIL" -gt 0 ]; then
  echo ""
  echo -e "${YELLOW}╔══════════════════════════════════════════════════════════╗"
  echo "║  ⚠ Algunos servicios fallaron. El PANEL WEB ya está    ║"
  echo "║  disponible para que puedas gestionar y hacer backups.  ║"
  echo "║                                                          ║"
  echo "║  Puedes reintentar con:                                  ║"
  echo "║    cd $INSTALL_DIR && docker compose up -d --build       ║"
  echo "╚══════════════════════════════════════════════════════════╝${NC}"
fi

# ═══════════════════════════════════════════════════
# Resumen final
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗"
echo "║           ¡Instalación completada! ✓                    ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║  🌐 SERVICIOS                                             ║"
echo "║  ─────────────────────────────────────────────           ║"
echo "║  Panel Web:     http://$VPS_IP                            ║"
echo "║  API Backend:   http://$VPS_IP/api/health                 ║"
echo "║  daloRADIUS:    http://$VPS_IP/daloradius/                ║"
echo "║  PHPNuxBill:    http://$VPS_IP/nuxbill/                   ║"
echo "║                                                          ║"
echo "║  (Directo por puertos, opcional):                        ║"
echo "║  API :3000 | daloRADIUS :8000 | NuxBill :8080            ║"
echo "║                                                          ║"
echo "║  🔑 CREDENCIALES                                          ║"
echo "║  ─────────────────────────────────────────────           ║"
echo "║  OmniSync Panel:                                         ║"
echo "║    Email:    admin@omnisync.local                         ║"
echo "║    Pass:     admin123                                     ║"
echo "║                                                          ║"
echo "║  daloRADIUS:                                             ║"
echo "║    Usuario:  administrator                               ║"
echo "║    Pass:     radius                                      ║"
echo "║                                                          ║"
echo "║  PHPNuxBill:                                             ║"
echo "║    Usuario:  admin                                       ║"
echo "║    Pass:     admin                                       ║"
echo "║                                                          ║"
echo "║  PostgreSQL:                                             ║"
echo "║    DB:       omnisync                                    ║"
echo "║    Usuario:  omnisync                                    ║"
echo "║    Pass:     ${DB_PASSWORD}                              ║"
echo "║                                                          ║"
echo "║  MariaDB (RADIUS):                                      ║"
echo "║    DB:       radius                                      ║"
echo "║    Usuario:  radius                                      ║"
echo "║    Pass:     ${RADIUS_DB_PASSWORD}                       ║"
echo "║                                                          ║"
echo "║  ⚠️  CAMBIA TODAS LAS CONTRASEÑAS INMEDIATAMENTE         ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Comandos útiles:${NC}"
echo "  Ver estado:      cd $INSTALL_DIR && docker compose ps"
echo "  Ver logs:        cd $INSTALL_DIR && docker compose logs -f"
echo "  Logs de API:     cd $INSTALL_DIR && docker compose logs api --tail 50"
echo "  Reiniciar todo:  cd $INSTALL_DIR && docker compose restart"
echo "  Reinstalar:      curl -fsSL https://raw.githubusercontent.com/drab10688-dot/mikrotik-connect-hub/main/vps-stack/install.sh | sudo bash"