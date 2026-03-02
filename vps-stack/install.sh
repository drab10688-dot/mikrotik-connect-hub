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

# Check root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Ejecuta este script como root (sudo)${NC}"
  exit 1
fi

# Check OS compatibility
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

# Check if already installed
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
      rm -rf "$INSTALL_DIR"
      echo -e "${GREEN}Instalación anterior eliminada ✓${NC}"
      ;;
    2)
      echo -e "${YELLOW}Actualizando archivos...${NC}"
      TEMP_DIR=$(mktemp -d)
      git clone --depth 1 "$REPO_URL" "$TEMP_DIR"
      # Preserve .env and data
      cp "$INSTALL_DIR/.env" /tmp/omnisync-env-backup 2>/dev/null || true
      cp -r "$TEMP_DIR"/vps-stack/* "$INSTALL_DIR"/
      cp /tmp/omnisync-env-backup "$INSTALL_DIR/.env" 2>/dev/null || true
      rm -rf "$TEMP_DIR" /tmp/omnisync-env-backup
      cd "$INSTALL_DIR"
      docker compose up -d --build
      echo -e "${GREEN}✓ Actualización completada${NC}"
      echo -e "${YELLOW}API: http://$(hostname -I | awk '{print $1}'):3000${NC}"
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
read -p "Host/IP del MikroTik: " MIKROTIK_HOST < /dev/tty
read -p "Puerto API REST (443): " MIKROTIK_PORT < /dev/tty
MIKROTIK_PORT=${MIKROTIK_PORT:-443}
read -p "Usuario MikroTik: " MIKROTIK_USER < /dev/tty
read -sp "Contraseña MikroTik: " MIKROTIK_PASS < /dev/tty
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
echo "<html><body><h1>OmniSync - Desplegando frontend...</h1></body></html>" > frontend/dist/index.html

# Open firewall ports
if command -v ufw &> /dev/null; then
  echo -e "${YELLOW}Abriendo puertos en firewall...${NC}"
  ufw allow 80/tcp >/dev/null 2>&1
  ufw allow 443/tcp >/dev/null 2>&1
  ufw allow 3000/tcp >/dev/null 2>&1
  ufw allow 8000/tcp >/dev/null 2>&1
  ufw allow 19999/tcp >/dev/null 2>&1
  ufw allow 1812/udp >/dev/null 2>&1
  ufw allow 1813/udp >/dev/null 2>&1
  echo -e "${GREEN}Puertos abiertos ✓${NC}"
fi

# Start services
echo -e "${YELLOW}Iniciando servicios (esto puede tardar unos minutos)...${NC}"
docker compose up -d --build

VPS_IP=$(hostname -I | awk '{print $1}')
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗"
echo "║       ¡Instalación completada! ✓             ║"
echo "╠══════════════════════════════════════════════╣"
echo "║                                              ║"
echo "║  Panel Web:    http://$VPS_IP                 ║"
echo "║  API:          http://$VPS_IP:3000            ║"
echo "║  daloRADIUS:   http://$VPS_IP:8000            ║"
echo "║  Netdata:      http://$VPS_IP:19999           ║"
echo "║                                              ║"
echo "║  Login: admin@omnisync.local / admin123       ║"
echo "║  ⚠ CAMBIA LA CONTRASEÑA INMEDIATAMENTE        ║"
echo "║                                              ║"
echo "╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Comandos útiles:${NC}"
echo "  Ver estado:      cd $INSTALL_DIR && docker compose ps"
echo "  Ver logs:        cd $INSTALL_DIR && docker compose logs -f"
echo "  Reinstalar:      curl -fsSL https://raw.githubusercontent.com/drab10688-dot/mikrotik-connect-hub/main/vps-stack/install.sh | sudo bash"
