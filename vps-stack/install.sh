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
    read -p "¿Deseas continuar de todos modos? (s/N): " FORCE_INSTALL < /dev/tty
    if [ "$FORCE_INSTALL" != "s" ] && [ "$FORCE_INSTALL" != "S" ]; then
      exit 1
    fi
  fi
else
  echo -e "${YELLOW}⚠ No se pudo detectar el sistema operativo${NC}"
fi

# ─── Check existing installation ──────────────────
handle_existing_installation() {
  if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    echo ""
    echo -e "${YELLOW}⚠ OmniSync ya está instalado en este VPS${NC}"
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
        # Backup .env
        cp "$INSTALL_DIR/.env" /tmp/omnisync-env-backup 2>/dev/null || true
        # Copy new stack files
        cp -r "$TEMP_DIR"/vps-stack/* "$INSTALL_DIR"/
        # Restore .env
        cp /tmp/omnisync-env-backup "$INSTALL_DIR/.env" 2>/dev/null || true

        # Rebuild frontend
        echo -e "${YELLOW}Recompilando panel web...${NC}"
        cd "$TEMP_DIR"
        echo "VITE_API_BASE_URL=/api" > .env.production
        npm install --legacy-peer-deps 2>/dev/null || npm install
        npm run build
        mkdir -p "$INSTALL_DIR/frontend/dist"
        rm -rf "$INSTALL_DIR/frontend/dist"/*
        cp -r dist/* "$INSTALL_DIR/frontend/dist"/

        # Regenerate radius configs from .env
        cd "$INSTALL_DIR"
        source .env 2>/dev/null || true
        generate_radius_configs

        rm -rf "$TEMP_DIR" /tmp/omnisync-env-backup

        # Regenerate nuxbill init SQL
        generate_nuxbill_sql

        docker compose up -d --build
        echo -e "${GREEN}✓ Actualización completada${NC}"
        VPS_IP=$(hostname -I | awk '{print $1}')
        echo -e "${GREEN}Panel: http://$VPS_IP${NC}"
        exit 0
        ;;
      3)
        echo -e "${RED}⚠ Esto eliminará TODOS los datos.${NC}"
        read -p "Escribe 'ELIMINAR' para confirmar: " CONFIRM < /dev/tty
        if [ "$CONFIRM" = "ELIMINAR" ]; then
          cd "$INSTALL_DIR" && docker compose down -v 2>/dev/null || true
          rm -rf "$INSTALL_DIR"
          echo -e "${GREEN}OmniSync desinstalado ✓${NC}"
        fi
        exit 0
        ;;
      *)
        exit 0
        ;;
    esac
  fi
}

# ═══════════════════════════════════════════════════
# Helper functions
# ═══════════════════════════════════════════════════

generate_radius_configs() {
  local radius_pw="${RADIUS_DB_PASSWORD:-changeme_radius}"
  local radius_secret="${RADIUS_SECRET:-testing123}"
  
  # Generate FreeRADIUS SQL module config with actual password
  cat > "$INSTALL_DIR/radius/mods-enabled/sql" << SQLEOF
sql {
    dialect = "mysql"
    driver = "rlm_sql_mysql"

    server = "mariadb"
    port = 3306
    login = "radius"
    password = "${radius_pw}"

    radius_db = "radius"

    acct_table1 = "radacct"
    acct_table2 = "radacct"
    postauth_table = "radpostauth"
    authcheck_table = "radcheck"
    groupcheck_table = "radgroupcheck"
    authreply_table = "radreply"
    groupreply_table = "radgroupreply"
    usergroup_table = "radusergroup"

    delete_stale_sessions = yes
    pool {
        start = 5
        min = 3
        max = 10
        spare = 3
        uses = 0
        lifetime = 0
        idle_timeout = 60
    }

    read_clients = yes
    client_table = "nas"

    group_attribute = "SQL-Group"

    sql_user_name = "%{%{Stripped-User-Name}:-%{User-Name}}"
}
SQLEOF

  # Generate clients.conf with actual secret
  cat > "$INSTALL_DIR/radius/clients.conf" << CLIENTEOF
client mikrotik {
    ipaddr = 0.0.0.0/0
    secret = ${radius_secret}
    shortname = mikrotik
    nastype = other
}
CLIENTEOF
}

generate_nuxbill_sql() {
  local nuxbill_pw="${NUXBILL_DB_PASSWORD:-changeme_nuxbill}"
  
  mkdir -p "$INSTALL_DIR/mariadb-init"
  cat > "$INSTALL_DIR/mariadb-init/02-nuxbill.sql" << NUXEOF
-- PHPNuxBill Database Initialization
CREATE DATABASE IF NOT EXISTS phpnuxbill;
CREATE USER IF NOT EXISTS 'nuxbill'@'%' IDENTIFIED BY '${nuxbill_pw}';
GRANT ALL PRIVILEGES ON phpnuxbill.* TO 'nuxbill'@'%';
FLUSH PRIVILEGES;
NUXEOF
}

# Validate existing installation lifecycle actions (reinstall/update/uninstall)
handle_existing_installation

# ═══════════════════════════════════════════════════
# FASE 1: Dependencias del sistema
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 1/5: Instalando dependencias ═══${NC}"

# Git
if ! command -v git &> /dev/null; then
  apt-get update -qq && apt-get install -y -qq git curl
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
  apt-get update -qq && apt-get install -y -qq docker-compose-plugin
  echo -e "${GREEN}Docker Compose instalado ✓${NC}"
fi

# Node.js
if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}Instalando Node.js 20...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  echo -e "${GREEN}Node.js instalado ✓${NC}"
else
  echo -e "${GREEN}Node.js $(node -v) ya instalado ✓${NC}"
fi

echo -e "${GREEN}✓ Dependencias listas${NC}"

# ═══════════════════════════════════════════════════
# FASE 2: Descargar y compilar frontend PRIMERO
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 2/5: Descargando y compilando panel web ═══${NC}"

TEMP_DIR=$(mktemp -d)
git clone --depth 1 "$REPO_URL" "$TEMP_DIR"
echo -e "${GREEN}Código descargado ✓${NC}"

# Copy VPS stack files
mkdir -p "$INSTALL_DIR"
cp -r "$TEMP_DIR"/vps-stack/* "$INSTALL_DIR"/
echo -e "${GREEN}Archivos del stack copiados ✓${NC}"

# Build frontend
echo -e "${YELLOW}Compilando panel web (puede tardar unos minutos)...${NC}"
cd "$TEMP_DIR"
echo "VITE_API_BASE_URL=/api" > .env.production
npm install --legacy-peer-deps 2>/dev/null || npm install
npm run build

# Deploy frontend
FRONTEND_DIR="$INSTALL_DIR/frontend/dist"
mkdir -p "$FRONTEND_DIR"
rm -rf "$FRONTEND_DIR"/*
cp -r dist/* "$FRONTEND_DIR"/
echo -e "${GREEN}✓ Panel web compilado y desplegado${NC}"

cd /root
rm -rf "$TEMP_DIR"

# ═══════════════════════════════════════════════════
# FASE 3: Configuración
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 3/5: Configuración ═══${NC}"

cd "$INSTALL_DIR"

# Generate secure random secrets
JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)
RADIUS_DB_PASSWORD=$(openssl rand -hex 16)
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 16)
NUXBILL_DB_PASSWORD=$(openssl rand -hex 16)
RADIUS_SECRET=$(openssl rand -hex 16)

# MikroTik config (optional)
echo ""
echo -e "${YELLOW}Configuración MikroTik (opcional, se puede configurar desde el panel):${NC}"
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

# Create .env with actual passwords
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
RADIUS_SECRET=${RADIUS_SECRET}
RADIUS_DB_PASSWORD=${RADIUS_DB_PASSWORD}
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
NUXBILL_DB_PASSWORD=${NUXBILL_DB_PASSWORD}
NUXBILL_APP_URL=http://${VPS_IP}:8080
TZ=America/Bogota
EOF

echo -e "${GREEN}.env generado ✓${NC}"

# Generate FreeRADIUS configs with real passwords (no env interpolation in mounted files)
generate_radius_configs
echo -e "${GREEN}FreeRADIUS configs generados ✓${NC}"

# Generate NuxBill init SQL with real password
generate_nuxbill_sql
echo -e "${GREEN}NuxBill init SQL generado ✓${NC}"

# Create required directories
mkdir -p nginx/certs
mkdir -p frontend/dist
mkdir -p agent

# ── Instalar cloudflared ──────────────────────────
echo -e "${YELLOW}Instalando cloudflared para HTTPS del portal cautivo...${NC}"
if ! command -v cloudflared &> /dev/null; then
  curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x /usr/local/bin/cloudflared
  echo -e "${GREEN}cloudflared instalado ✓${NC}"
else
  echo -e "${GREEN}cloudflared ya instalado ✓${NC}"
fi

# ── Crear agente OmniSync (orquestador de tunnel) ──
AGENT_PORT=3847
AGENT_SECRET=$(openssl rand -hex 16)

cat > agent/agent.py << 'PYEOF'
#!/usr/bin/env python3
"""
OmniSync VPS Agent v2 - Docker Orchestrator + Cloudflare Tunnel
Controla contenedores Docker + Quick Tunnel desde el panel
"""
import http.server, json, subprocess, threading, os, signal, sys, re, time

PORT = int(os.environ.get("AGENT_PORT", "3847"))
SECRET = os.environ.get("AGENT_SECRET", "")
INSTALL_DIR = os.environ.get("INSTALL_DIR", "/opt/omnisync")

tunnel_process = None
tunnel_url = None
tunnel_status = "stopped"

def run_cmd(cmd, timeout=30):
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return result.stdout.strip(), result.stderr.strip(), result.returncode
    except subprocess.TimeoutExpired:
        return "", "timeout", 1

def start_tunnel():
    global tunnel_process, tunnel_url, tunnel_status
    if tunnel_process and tunnel_process.poll() is None:
        return {"status": "running", "url": tunnel_url}
    tunnel_status = "starting"
    tunnel_url = None
    # Tunnel apunta al portal cautivo del VPS (Nginx puerto 80)
    tunnel_process = subprocess.Popen(
        ["cloudflared", "tunnel", "--url", "http://localhost:80", "--no-autoupdate"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    def read_output():
        global tunnel_url, tunnel_status
        for line in tunnel_process.stderr:
            text = line.decode("utf-8", errors="ignore")
            match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", text)
            if match and not tunnel_url:
                tunnel_url = match.group(0)
                tunnel_status = "running"
                print(f"🌐 Tunnel HTTPS: {tunnel_url}")
    t = threading.Thread(target=read_output, daemon=True)
    t.start()
    for _ in range(25):
        time.sleep(1)
        if tunnel_url:
            return {"status": "running", "url": tunnel_url}
    return {"status": tunnel_status, "url": tunnel_url, "message": "Starting..."}

def stop_tunnel():
    global tunnel_process, tunnel_url, tunnel_status
    if tunnel_process:
        tunnel_process.terminate()
        try: tunnel_process.wait(timeout=5)
        except: tunnel_process.kill()
        tunnel_process = None
    tunnel_url = None
    tunnel_status = "stopped"
    os.system("pkill -f 'cloudflared tunnel' 2>/dev/null || true")
    return {"status": "stopped"}

def get_status():
    global tunnel_process, tunnel_status, tunnel_url
    if tunnel_process and tunnel_process.poll() is not None:
        tunnel_status = "stopped"
        tunnel_url = None
        tunnel_process = None
    containers = {}
    stdout, _, _ = run_cmd("docker ps --format '{{.Names}}|{{.Status}}|{{.Ports}}' --filter name=omnisync")
    if stdout:
        for line in stdout.split('\n'):
            parts = line.split('|')
            if len(parts) >= 2:
                name = parts[0].replace('omnisync-', '')
                containers[name] = {"status": parts[1], "ports": parts[2] if len(parts) > 2 else ""}
    disk_stdout, _, _ = run_cmd("df -h / | tail -1 | awk '{print $2,$3,$4,$5}'")
    disk = disk_stdout.split() if disk_stdout else []
    mem_stdout, _, _ = run_cmd("free -m | grep Mem | awk '{print $2,$3,$4}'")
    mem = mem_stdout.split() if mem_stdout else []
    return {
        "tunnel": {"status": tunnel_status, "url": tunnel_url},
        "containers": containers,
        "cloudflared_installed": os.system("which cloudflared > /dev/null 2>&1") == 0,
        "docker_installed": os.system("which docker > /dev/null 2>&1") == 0,
        "system": {
            "disk": {"total": disk[0] if disk else "?", "used": disk[1] if len(disk)>1 else "?", "free": disk[2] if len(disk)>2 else "?", "percent": disk[3] if len(disk)>3 else "?"},
            "memory": {"total": mem[0]+"M" if mem else "?", "used": mem[1]+"M" if len(mem)>1 else "?", "free": mem[2]+"M" if len(mem)>2 else "?"}
        }
    }

def docker_action(action, service=None):
    compose_file = f"{INSTALL_DIR}/docker-compose.yml"
    if action == "up":
        svc = f" {service}" if service else ""
        stdout, stderr, code = run_cmd(f"docker compose -f {compose_file} up -d{svc}", timeout=120)
        return {"success": code == 0, "message": stdout or stderr}
    elif action == "down":
        svc = f" {service}" if service else ""
        stdout, stderr, code = run_cmd(f"docker compose -f {compose_file} stop{svc}", timeout=60)
        return {"success": code == 0, "message": stdout or stderr}
    elif action == "restart":
        svc = f" {service}" if service else ""
        stdout, stderr, code = run_cmd(f"docker compose -f {compose_file} restart{svc}", timeout=120)
        return {"success": code == 0, "message": stdout or stderr}
    elif action == "logs":
        svc = f" {service}" if service else ""
        stdout, stderr, code = run_cmd(f"docker compose -f {compose_file} logs --tail=50{svc}", timeout=15)
        return {"success": True, "logs": stdout or stderr}
    return {"error": "Unknown docker action"}

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass

    def _check_auth(self):
        if self.headers.get("X-Agent-Secret") != SECRET:
            self.send_response(403)
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Forbidden"}).encode())
            return False
        return True

    def _respond(self, data, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length > 0:
            return json.loads(self.rfile.read(length))
        return {}

    def do_GET(self):
        if not self._check_auth(): return
        if self.path == "/status":
            self._respond(get_status())
        elif self.path == "/health":
            self._respond({"ok": True, "version": "2.0"})
        else:
            self._respond({"error": "Not found"}, 404)

    def do_POST(self):
        if not self._check_auth(): return
        body = self._read_body()
        if self.path == "/start":
            self._respond(start_tunnel())
        elif self.path == "/stop":
            self._respond(stop_tunnel())
        elif self.path == "/docker":
            action = body.get("action", "")
            service = body.get("service")
            self._respond(docker_action(action, service))
        else:
            self._respond({"error": "Not found"}, 404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

print(f"🟢 OmniSync Agent v2 en puerto {PORT}")
http.server.HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
PYEOF

# ── Crear servicio systemd para el agente ──
cat > /etc/systemd/system/omnisync-agent.service << EOF
[Unit]
Description=OmniSync VPS Agent v2 (Docker + Cloudflare Tunnel)
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/agent
Environment=AGENT_PORT=${AGENT_PORT}
Environment=AGENT_SECRET=${AGENT_SECRET}
Environment=INSTALL_DIR=${INSTALL_DIR}
ExecStart=/usr/bin/python3 $INSTALL_DIR/agent/agent.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable omnisync-agent
echo -e "${GREEN}Agente OmniSync configurado ✓${NC}"

# Firewall
if command -v ufw &> /dev/null; then
  echo -e "${YELLOW}Abriendo puertos en firewall...${NC}"
  ufw allow 80/tcp >/dev/null 2>&1
  ufw allow 443/tcp >/dev/null 2>&1
  ufw allow ${AGENT_PORT}/tcp comment "OmniSync Agent" >/dev/null 2>&1
  ufw allow 1812/udp >/dev/null 2>&1
  ufw allow 1813/udp >/dev/null 2>&1
  echo -e "${GREEN}Puertos abiertos ✓${NC}"
fi

# ═══════════════════════════════════════════════════
# FASE 4: Levantar servicios Docker
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 4/5: Iniciando servicios Docker ═══${NC}"
echo -e "${YELLOW}Construyendo contenedores (esto puede tardar varios minutos)...${NC}"

docker compose up -d --build 2>&1 | tail -5

# Start the agent
systemctl restart omnisync-agent

# Wait for services to stabilize
echo -e "${YELLOW}Esperando 20 segundos para estabilización...${NC}"
sleep 20

# ═══════════════════════════════════════════════════
# FASE 5: Verificación de servicios
# ═══════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══ FASE 5/5: Verificando servicios ═══${NC}"

TOTAL_OK=0
TOTAL_FAIL=0
FAILED_SERVICES=""

check_service() {
  local name=$1
  local container=$2
  
  if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    local status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null)
    if [ "$status" = "running" ]; then
      echo -e "  ${GREEN}✓ $name${NC}"
      TOTAL_OK=$((TOTAL_OK + 1))
      return 0
    fi
  fi
  
  echo -e "  ${RED}✗ $name — FALLO${NC}"
  # Show last 5 lines of logs for failed service
  local svc_name=$(echo "$container" | sed 's/omnisync-//')
  echo -e "    ${YELLOW}Últimas líneas de log:${NC}"
  docker compose logs "$svc_name" --tail 5 2>/dev/null | sed 's/^/    /'
  TOTAL_FAIL=$((TOTAL_FAIL + 1))
  FAILED_SERVICES="$FAILED_SERVICES $name"
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
echo -e "  Resultado: ${GREEN}$TOTAL_OK OK${NC} / ${RED}$TOTAL_FAIL fallidos${NC}"

# Test HTTP endpoints
echo ""
echo -e "${CYAN}Probando endpoints HTTP...${NC}"

HTTP_OK=0
HTTP_FAIL=0
FAILED_ENDPOINTS=""

test_endpoint() {
  local name=$1
  local url=$2
  local service=${3:-}
  local status

  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$url" 2>/dev/null || echo "000")

  if [ "$status" -ge 200 ] && [ "$status" -lt 400 ]; then
    echo -e "  ${GREEN}✓ $name — HTTP $status${NC}"
    HTTP_OK=$((HTTP_OK + 1))
  else
    echo -e "  ${RED}✗ $name — HTTP $status${NC}"
    HTTP_FAIL=$((HTTP_FAIL + 1))
    FAILED_ENDPOINTS="$FAILED_ENDPOINTS $name"

    if [ -n "$service" ]; then
      echo -e "    ${YELLOW}Últimas líneas de $service:${NC}"
      docker compose logs "$service" --tail 5 2>/dev/null | sed 's/^/    /'
    fi
  fi
}

test_endpoint "Panel Web"    "http://localhost" "nginx"
test_endpoint "API Health"   "http://localhost/api/health" "api"
test_endpoint "daloRADIUS"   "http://localhost/daloradius/" "daloradius"
test_endpoint "PHPNuxBill"   "http://localhost/nuxbill/" "phpnuxbill"

echo ""
echo -e "  Resultado HTTP: ${GREEN}$HTTP_OK OK${NC} / ${RED}$HTTP_FAIL fallidos${NC}"

if [ "$HTTP_FAIL" -gt 0 ]; then
  echo -e "${YELLOW}  Endpoints con fallo:${FAILED_ENDPOINTS}${NC}"
fi

if [ "$TOTAL_FAIL" -gt 0 ]; then
  echo ""
  echo -e "${YELLOW}╔══════════════════════════════════════════════════════════╗"
  echo "║  ⚠ Servicios fallidos:${FAILED_SERVICES}"
  echo "║  El panel web YA está disponible para gestionar backups."
  echo "║                                                          "
  echo "║  Reintentar: cd $INSTALL_DIR && docker compose up -d     "
  echo "║  Ver logs:   cd $INSTALL_DIR && docker compose logs      "
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
echo "║  🌐 ACCESOS                                               ║"
echo "║  ─────────────────────────────────────────────           ║"
echo "║  Panel Web:     http://$VPS_IP                            "
echo "║  API Health:    http://$VPS_IP/api/health                 "
echo "║  daloRADIUS:    http://$VPS_IP/daloradius/                "
echo "║  PHPNuxBill:    http://$VPS_IP/nuxbill/                   "
echo "║  Portal Cautivo: http://$VPS_IP/portal                   "
echo "║                                                          ║"
echo "║  🔒 HTTPS (Cloudflare Tunnel)                             ║"
echo "║  ─────────────────────────────────────────────           ║"
echo "║  Agente:     puerto $AGENT_PORT (activo)                  "
echo "║  Secret:     ${AGENT_SECRET}                              "
echo "║  cloudflared: $(cloudflared --version 2>/dev/null | head -1 || echo 'instalado')"
echo "║                                                          ║"
echo "║  Para activar HTTPS:                                     ║"
echo "║  1. Ve a Servicios VPS → Cloudflare → Quick Tunnel       ║"
echo "║  2. Ingresa IP: $VPS_IP y puerto: $AGENT_PORT            "
echo "║  3. Haz clic en 'Iniciar' para obtener la URL HTTPS      ║"
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
echo "║    URL:      http://$VPS_IP/nuxbill/                     ║"
echo "║    DB Host: mariadb | DB: phpnuxbill                     ║"
echo "║    DB User: nuxbill | DB Pass: ${NUXBILL_DB_PASSWORD}    "
echo "║                                                          ║"
echo "║  PostgreSQL:                                             ║"
echo "║    DB: omnisync | User: omnisync                         ║"
echo "║    Pass: ${DB_PASSWORD}                                  "
echo "║                                                          ║"
echo "║  MariaDB (RADIUS):                                      ║"
echo "║    DB: radius | User: radius                             ║"
echo "║    Pass: ${RADIUS_DB_PASSWORD}                           "
echo "║                                                          ║"
echo "║  📡 CONFIGURAR MIKROTIK HOTSPOT                          ║"
echo "║  ─────────────────────────────────────────────           ║"
echo "║  1. IP → Hotspot → Server Profiles → tu_perfil           ║"
echo "║     Login Page: http://$VPS_IP/portal                    ║"
echo "║                                                          ║"
echo "║  2. IP → Hotspot → Walled Garden → Add:                  ║"
echo "║     Dst. Host: $VPS_IP                                   ║"
echo "║     Action: allow                                        ║"
echo "║                                                          ║"
echo "║  3. Cuando actives el tunnel HTTPS, agregar también:     ║"
echo "║     Dst. Host: *.trycloudflare.com                       ║"
echo "║     Action: allow                                        ║"
echo "║                                                          ║"
echo "║  ⚠️  CAMBIA LAS CONTRASEÑAS DEL PANEL INMEDIATAMENTE     ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Comandos útiles:${NC}"
echo "  Estado:          cd $INSTALL_DIR && docker compose ps"
echo "  Logs:            cd $INSTALL_DIR && docker compose logs -f"
echo "  Agente:          systemctl status omnisync-agent"
echo "  Logs agente:     journalctl -u omnisync-agent -f"
echo "  Reiniciar:       cd $INSTALL_DIR && docker compose restart"
echo "  Reconstruir:     cd $INSTALL_DIR && docker compose up -d --build"
echo ""
echo -e "${CYAN}Reinstalar:${NC}"
echo "  curl -fsSL https://raw.githubusercontent.com/drab10688-dot/mikrotik-connect-hub/main/vps-stack/install.sh | sudo bash"
