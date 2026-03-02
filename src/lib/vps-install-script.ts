// VPS Docker Installation Script Generator for OmniSync
// Generates a comprehensive bash script that installs Docker + all containers

export function generateVpsInstallScript(params: {
  secret: string;
  port: number;
  portalUrl: string;
  mikrotikHost?: string;
  mikrotikPort?: number;
  mikrotikUser?: string;
  mikrotikPass?: string;
}) {
  const { secret, port, portalUrl, mikrotikHost, mikrotikPort, mikrotikUser, mikrotikPass } = params;

  return `#!/bin/bash
# =====================================================
#  OmniSync VPS - Instalador Completo con Docker
#  Incluye: RouterOS API Proxy, FreeRADIUS, Portal
#           Cautivo, Cloudflare Tunnel Agent, Netdata
# =====================================================
set -e

AGENT_PORT=${port}
AGENT_SECRET="${secret}"
PORTAL_URL="${portalUrl}"
INSTALL_DIR="/opt/omnisync"
MIKROTIK_HOST="${mikrotikHost || ''}"
MIKROTIK_PORT=${mikrotikPort || 8728}
MIKROTIK_USER="${mikrotikUser || 'admin'}"
MIKROTIK_PASS="${mikrotikPass || ''}"

RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
NC='\\033[0m'

echo -e "\${BLUE}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     🚀 OmniSync VPS Installer         ║"
echo "  ║     Docker + MikroTik Management       ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "\${NC}"

# ── 1. Actualizar sistema ──────────────────────────
echo -e "\${YELLOW}[1/7] Actualizando sistema...\${NC}"
apt-get update -qq
apt-get install -y -qq curl wget git apt-transport-https ca-certificates software-properties-common gnupg lsb-release python3 python3-pip > /dev/null 2>&1
echo -e "\${GREEN}✅ Sistema actualizado\${NC}"

# ── 2. Instalar Docker ────────────────────────────
echo -e "\${YELLOW}[2/7] Instalando Docker...\${NC}"
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo -e "\${GREEN}✅ Docker instalado\${NC}"
else
  echo -e "\${GREEN}✅ Docker ya instalado\${NC}"
fi

if ! command -v docker compose &> /dev/null; then
  COMPOSE_VERSION=\$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep -oP '"tag_name": "\\K[^"]+')
  curl -fsSL -o /usr/local/bin/docker-compose "https://github.com/docker/compose/releases/download/\${COMPOSE_VERSION}/docker-compose-linux-x86_64"
  chmod +x /usr/local/bin/docker-compose
fi
echo -e "\${GREEN}✅ Docker Compose disponible\${NC}"

# ── 3. Instalar cloudflared ───────────────────────
echo -e "\${YELLOW}[3/7] Instalando cloudflared...\${NC}"
if ! command -v cloudflared &> /dev/null; then
  curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x /usr/local/bin/cloudflared
  echo -e "\${GREEN}✅ cloudflared instalado\${NC}"
else
  echo -e "\${GREEN}✅ cloudflared ya instalado\${NC}"
fi

# ── 4. Crear estructura de directorios ────────────
echo -e "\${YELLOW}[4/7] Creando estructura...\${NC}"
mkdir -p $INSTALL_DIR/{agent,radius/config,radius/mods,routeros-proxy,portal,data/mysql}

# ── 5. Crear Docker Compose ──────────────────────
echo -e "\${YELLOW}[5/7] Generando Docker Compose...\${NC}"

cat > $INSTALL_DIR/docker-compose.yml << 'COMPOSEOF'
version: '3.8'

services:
  # ═══════════════════════════════════════════
  # RouterOS API Proxy - REST API para MikroTik
  # ═══════════════════════════════════════════
  routeros-proxy:
    image: node:20-alpine
    container_name: omnisync-routeros-proxy
    working_dir: /app
    volumes:
      - ./routeros-proxy:/app
    ports:
      - "8728:3000"
    environment:
      - MIKROTIK_HOST=\${MIKROTIK_HOST}
      - MIKROTIK_PORT=\${MIKROTIK_PORT:-8728}
      - MIKROTIK_USER=\${MIKROTIK_USER:-admin}
      - MIKROTIK_PASS=\${MIKROTIK_PASS}
      - API_SECRET=\${AGENT_SECRET}
    command: sh -c "npm install && node server.js"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ═══════════════════════════════════════════
  # FreeRADIUS - Autenticación Hotspot + PPPoE
  # ═══════════════════════════════════════════
  radius:
    image: freeradius/freeradius-server:latest
    container_name: omnisync-radius
    ports:
      - "1812:1812/udp"
      - "1813:1813/udp"
      - "18120:18120/tcp"
    volumes:
      - ./radius/config:/etc/raddb/custom
      - ./radius/mods:/etc/raddb/mods-enabled-custom
    environment:
      - RADIUS_SECRET=\${AGENT_SECRET}
      - MYSQL_HOST=radius-db
      - MYSQL_DATABASE=radius
      - MYSQL_USER=radius
      - MYSQL_PASS=omnisync_radius_2024
    depends_on:
      radius-db:
        condition: service_healthy
    restart: unless-stopped

  radius-db:
    image: mariadb:11
    container_name: omnisync-radius-db
    environment:
      - MYSQL_ROOT_PASSWORD=omnisync_root_2024
      - MYSQL_DATABASE=radius
      - MYSQL_USER=radius
      - MYSQL_PASSWORD=omnisync_radius_2024
    volumes:
      - ./data/mysql:/var/lib/mysql
    ports:
      - "3306:3306"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ═══════════════════════════════════════════
  # Netdata - Monitoreo del VPS en tiempo real
  # ═══════════════════════════════════════════
  netdata:
    image: netdata/netdata:stable
    container_name: omnisync-netdata
    ports:
      - "19999:19999"
    cap_add:
      - SYS_PTRACE
      - SYS_ADMIN
    security_opt:
      - apparmor:unconfined
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /etc/os-release:/host/etc/os-release:ro
    restart: unless-stopped

  # ═══════════════════════════════════════════
  # daloRADIUS - Panel Web para FreeRADIUS
  # ═══════════════════════════════════════════
  daloradius:
    image: lhaig/daloradius:latest
    container_name: omnisync-daloradius
    ports:
      - "8000:80"
    environment:
      - MYSQL_HOST=radius-db
      - MYSQL_PORT=3306
      - MYSQL_DATABASE=radius
      - MYSQL_USER=radius
      - MYSQL_PASSWORD=omnisync_radius_2024
    depends_on:
      radius-db:
        condition: service_healthy
    restart: unless-stopped

COMPOSEOF

# ── 6. Crear RouterOS API Proxy ──────────────────
cat > $INSTALL_DIR/routeros-proxy/package.json << 'PKGEOF'
{
  "name": "omnisync-routeros-proxy",
  "version": "1.0.0",
  "dependencies": {
    "routeros": "^3.1.0",
    "express": "^4.18.2",
    "cors": "^2.8.5"
  }
}
PKGEOF

cat > $INSTALL_DIR/routeros-proxy/server.js << 'SERVEREOF'
const express = require('express');
const cors = require('cors');
const RouterOSAPI = require('routeros').RouterOSAPI;

const app = express();
app.use(cors());
app.use(express.json());

const API_SECRET = process.env.API_SECRET || '';
const MK_HOST = process.env.MIKROTIK_HOST || '192.168.88.1';
const MK_PORT = parseInt(process.env.MIKROTIK_PORT || '8728');
const MK_USER = process.env.MIKROTIK_USER || 'admin';
const MK_PASS = process.env.MIKROTIK_PASS || '';

// Auth middleware
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const secret = req.headers['x-api-secret'];
  if (secret !== API_SECRET) return res.status(403).json({ error: 'Forbidden' });
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'routeros-proxy' }));

// Generic MikroTik API endpoint
app.post('/api', async (req, res) => {
  const { command, params } = req.body;
  if (!command) return res.status(400).json({ error: 'Missing command' });

  let conn;
  try {
    conn = new RouterOSAPI({ host: MK_HOST, port: MK_PORT, user: MK_USER, password: MK_PASS, timeout: 15 });
    await conn.connect();

    let result;
    if (params && Object.keys(params).length > 0) {
      const queryParams = Object.entries(params).map(([k, v]) => \`=\${k}=\${v}\`);
      result = await conn.write(command, queryParams);
    } else {
      result = await conn.write(command);
    }

    await conn.close();
    res.json({ success: true, data: result });
  } catch (err) {
    if (conn) try { await conn.close(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// Hotspot users
app.get('/hotspot/active', async (req, res) => {
  let conn;
  try {
    conn = new RouterOSAPI({ host: MK_HOST, port: MK_PORT, user: MK_USER, password: MK_PASS, timeout: 15 });
    await conn.connect();
    const result = await conn.write('/ip/hotspot/active/print');
    await conn.close();
    res.json({ success: true, data: result });
  } catch (err) {
    if (conn) try { await conn.close(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

app.get('/hotspot/users', async (req, res) => {
  let conn;
  try {
    conn = new RouterOSAPI({ host: MK_HOST, port: MK_PORT, user: MK_USER, password: MK_PASS, timeout: 15 });
    await conn.connect();
    const result = await conn.write('/ip/hotspot/user/print');
    await conn.close();
    res.json({ success: true, data: result });
  } catch (err) {
    if (conn) try { await conn.close(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// PPPoE
app.get('/pppoe/active', async (req, res) => {
  let conn;
  try {
    conn = new RouterOSAPI({ host: MK_HOST, port: MK_PORT, user: MK_USER, password: MK_PASS, timeout: 15 });
    await conn.connect();
    const result = await conn.write('/ppp/active/print');
    await conn.close();
    res.json({ success: true, data: result });
  } catch (err) {
    if (conn) try { await conn.close(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// System resources
app.get('/system/resources', async (req, res) => {
  let conn;
  try {
    conn = new RouterOSAPI({ host: MK_HOST, port: MK_PORT, user: MK_USER, password: MK_PASS, timeout: 15 });
    await conn.connect();
    const result = await conn.write('/system/resource/print');
    await conn.close();
    res.json({ success: true, data: result[0] || {} });
  } catch (err) {
    if (conn) try { await conn.close(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// Simple Queues
app.get('/queues', async (req, res) => {
  let conn;
  try {
    conn = new RouterOSAPI({ host: MK_HOST, port: MK_PORT, user: MK_USER, password: MK_PASS, timeout: 15 });
    await conn.connect();
    const result = await conn.write('/queue/simple/print');
    await conn.close();
    res.json({ success: true, data: result });
  } catch (err) {
    if (conn) try { await conn.close(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(\`🟢 RouterOS API Proxy on port \${PORT}\`));
SERVEREOF

# ── 7. Crear FreeRADIUS configs ──────────────────
cat > $INSTALL_DIR/radius/config/clients.conf << RADIUSEOF
client mikrotik {
    ipaddr = 0.0.0.0/0
    secret = $AGENT_SECRET
    shortname = mikrotik
    nastype = other
}
RADIUSEOF

# ── 8. Crear agente OmniSync (orquestador) ──────
cat > $INSTALL_DIR/agent/agent.py << 'PYEOF'
#!/usr/bin/env python3
"""
OmniSync VPS Agent v2 - Docker Orchestrator
Controla contenedores Docker + Cloudflare Tunnel desde el panel
"""
import http.server, json, subprocess, threading, os, signal, sys, re, time

PORT = int(os.environ.get("AGENT_PORT", "3847"))
SECRET = os.environ.get("AGENT_SECRET", "")
PORTAL_URL = os.environ.get("PORTAL_URL", "")
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
    tunnel_process = subprocess.Popen(
        ["cloudflared", "tunnel", "--url", PORTAL_URL, "--no-autoupdate"],
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
                print(f"🌐 Tunnel: {tunnel_url}")
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
    # Get Docker container status
    containers = {}
    stdout, _, _ = run_cmd("docker ps --format '{{.Names}}|{{.Status}}|{{.Ports}}' --filter name=omnisync")
    if stdout:
        for line in stdout.split('\n'):
            parts = line.split('|')
            if len(parts) >= 2:
                name = parts[0].replace('omnisync-', '')
                containers[name] = {"status": parts[1], "ports": parts[2] if len(parts) > 2 else ""}
    # Check all expected containers
    all_stdout, _, _ = run_cmd("docker ps -a --format '{{.Names}}|{{.Status}}' --filter name=omnisync")
    if all_stdout:
        for line in all_stdout.split('\n'):
            parts = line.split('|')
            if len(parts) >= 2:
                name = parts[0].replace('omnisync-', '')
                if name not in containers:
                    containers[name] = {"status": parts[1], "ports": ""}
    # Disk usage
    disk_stdout, _, _ = run_cmd("df -h / | tail -1 | awk '{print $2,$3,$4,$5}'")
    disk = disk_stdout.split() if disk_stdout else []
    # Memory
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
    elif action == "pull":
        stdout, stderr, code = run_cmd(f"docker compose -f {compose_file} pull", timeout=300)
        return {"success": code == 0, "message": stdout or stderr}
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
        elif self.path == "/install":
            installed = os.system("which cloudflared > /dev/null 2>&1") == 0
            if installed:
                self._respond({"success": True, "message": "Ya instalado"})
            else:
                os.system("curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /usr/local/bin/cloudflared")
                self._respond({"success": True, "message": "Instalado"})
        else:
            self._respond({"error": "Not found"}, 404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

print(f"🟢 OmniSync Agent v2 (Docker) en puerto {PORT}")
http.server.HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
PYEOF

# ── 9. Archivo de entorno ────────────────────────
cat > $INSTALL_DIR/.env << EOF
AGENT_PORT=$AGENT_PORT
AGENT_SECRET=$AGENT_SECRET
PORTAL_URL=$PORTAL_URL
INSTALL_DIR=$INSTALL_DIR
MIKROTIK_HOST=$MIKROTIK_HOST
MIKROTIK_PORT=$MIKROTIK_PORT
MIKROTIK_USER=$MIKROTIK_USER
MIKROTIK_PASS=$MIKROTIK_PASS
EOF

# ── 10. Crear servicio systemd para el agente ────
cat > /etc/systemd/system/omnisync-agent.service << EOF
[Unit]
Description=OmniSync VPS Agent v2 (Docker Orchestrator)
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/agent
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=/usr/bin/python3 $INSTALL_DIR/agent/agent.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# ── 11. Activar servicios ────────────────────────
echo -e "\${YELLOW}[6/7] Iniciando servicios...\${NC}"
systemctl daemon-reload
systemctl enable omnisync-agent
systemctl restart omnisync-agent

# Levantar contenedores Docker
cd $INSTALL_DIR
docker compose up -d
echo -e "\${GREEN}✅ Contenedores Docker iniciados\${NC}"

# ── 12. Configurar firewall ─────────────────────
echo -e "\${YELLOW}[7/7] Configurando firewall...\${NC}"
if command -v ufw &> /dev/null; then
  ufw allow $AGENT_PORT/tcp comment "OmniSync Agent" 2>/dev/null || true
  ufw allow 1812/udp comment "RADIUS Auth" 2>/dev/null || true
  ufw allow 1813/udp comment "RADIUS Acct" 2>/dev/null || true
  echo -e "\${GREEN}✅ Firewall configurado\${NC}"
fi

echo ""
echo -e "\${GREEN}╔═══════════════════════════════════════════════════╗"
echo -e "║  ✅ OmniSync VPS instalado exitosamente!           ║"
echo -e "╚═══════════════════════════════════════════════════╝\${NC}"
echo ""
echo -e "\${BLUE}📦 Servicios activos:\${NC}"
echo "   🤖 Agente OmniSync   → puerto $AGENT_PORT"
echo "   🔌 RouterOS API Proxy→ puerto 8728"
echo "   🔐 FreeRADIUS        → puertos 1812/1813 UDP"
echo "   📊 Netdata Monitor   → puerto 19999"
echo "   🌐 daloRADIUS Panel  → puerto 8000"
echo "   🗄️  MariaDB (RADIUS)  → puerto 3306"
echo ""
echo -e "\${YELLOW}📋 Comandos útiles:\${NC}"
echo "   Estado agente:    systemctl status omnisync-agent"
echo "   Logs agente:      journalctl -u omnisync-agent -f"
echo "   Estado Docker:    cd /opt/omnisync && docker compose ps"
echo "   Logs Docker:      cd /opt/omnisync && docker compose logs -f"
echo "   Reiniciar todo:   cd /opt/omnisync && docker compose restart"
echo ""
echo -e "\${RED}⚠️  IMPORTANTE:\${NC}"
echo "   Asegúrate de que los puertos estén abiertos en tu proveedor de VPS"
echo "   Configura el MikroTik RADIUS: IP → RADIUS → Add"
echo "   Server: $(hostname -I | awk '{print $1}'), Secret: $AGENT_SECRET"
echo ""
echo -e "\${GREEN}🎉 ¡Ahora puedes controlar todo desde el panel de OmniSync!\${NC}"
`;
}
