#!/usr/bin/env bash
# OmniSync — CMS C-Data oficial (igual que el video de beryindo) pero con WireGuard
# en lugar de L2TP/IPsec.
#
# Flujo:
#   1. Docker (repo oficial de Docker, Ubuntu 22.04/24.04)
#   2. WireGuard + panel MikroTik (opcional, ya instalado se respeta)
#   3. Instalador OFICIAL de C-Data (cms_install.sh 4.5.14) con sus puertos por
#      defecto y sus preguntas — sin remapeos ni parches nuestros.
#   4. Rutas del VPS hacia la LAN de las ONU a través del túnel WireGuard.
#
# Uso:
#   bash install-cms-official.sh
#   ONU_NETS="10.0.0.0/24,192.168.100.0/24" bash install-cms-official.sh
#   SKIP_VPN=1 bash install-cms-official.sh        # solo CMS
#   SKIP_CMS=1 ONU_NETS=10.0.0.0/24 bash install-cms-official.sh  # solo rutas

set -Eeuo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
LOG="/var/log/omnisync-cms-official.log"
touch "$LOG" 2>/dev/null || LOG="/tmp/omnisync-cms-official.log"

STAGE="inicio"
on_error() {
  local code=$? line="${BASH_LINENO[0]:-?}"
  set +e
  echo -e "${RED}✗ Falló '${STAGE}' (línea ${line}, código ${code}).${NC}"
  echo -e "${YELLOW}Log: ${LOG}${NC}"
  command -v docker >/dev/null 2>&1 && docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  exit "$code"
}
trap on_error ERR

[ "$EUID" -eq 0 ] || { echo -e "${RED}Ejecuta como root.${NC}"; exit 1; }

CMS_VERSION="${CMS_VERSION:-4.5.14}"
CMS_DIR="${CMS_DIR:-/opt/cms}"
WG_SUBNET="${WG_SUBNET:-10.13.13.0/24}"
WG_CONTAINER="${WG_CONTAINER:-omnisync-wireguard}"
ONU_NETS="${ONU_NETS:-}"
SKIP_VPN="${SKIP_VPN:-0}"
SKIP_CMS="${SKIP_CMS:-0}"
PANEL_URL="${PANEL_URL:-https://raw.githubusercontent.com/drab10688-dot/mikrotik-connect-hub/main/vps-stack/install-wireguard-panel.sh}"

echo -e "${CYAN}=========================================${NC}"
echo -e "${CYAN} CMS C-Data oficial + WireGuard${NC}"
echo -e "${CYAN}=========================================${NC}"

# ---------------------------------------------------------------- 1. Docker
STAGE="Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo -e "${CYAN}▶ Instalando Docker...${NC}"
  export DEBIAN_FRONTEND=noninteractive
  # Espera si otro apt tiene el lock (unattended-upgrades al arrancar el VPS)
  for _ in $(seq 1 60); do
    fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || break
    echo "  · esperando a que otro proceso apt termine..."
    sleep 5
  done
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg iproute2 iptables
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker --version
echo -e "${GREEN}✓ Docker listo${NC}"

# ------------------------------------------------------------- 2. WireGuard
STAGE="WireGuard"
if [ "$SKIP_VPN" != "1" ]; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$WG_CONTAINER"; then
    echo -e "${GREEN}✓ WireGuard ya instalado (se conserva)${NC}"
    docker start "$WG_CONTAINER" >/dev/null 2>&1 || true
  else
    echo -e "${CYAN}▶ Instalando WireGuard + panel MikroTik...${NC}"
    curl -fsSL --retry 3 -o /tmp/install-wireguard-panel.sh "$PANEL_URL"
    bash /tmp/install-wireguard-panel.sh
  fi
fi

# ------------------------------------------------------------------- 3. CMS
STAGE="instalador oficial C-Data"
if [ "$SKIP_CMS" != "1" ]; then
  echo -e "${CYAN}▶ Descargando instalador oficial de C-Data ${CMS_VERSION}...${NC}"
  mkdir -p "$CMS_DIR"
  cd "$CMS_DIR"
  curl -fsSL --retry 3 -o cms_install.sh https://cms.s.cdatayun.com/cms_linux/cms_install.sh
  chmod +x cms_install.sh
  echo -e "${YELLOW}El instalador oficial hará preguntas (puertos, volumen de datos,${NC}"
  echo -e "${YELLOW}tenant multi/isp). Responde 'n' a los cambios de puerto y elige${NC}"
  echo -e "${YELLOW}'multi' si vas a manejar varios ISP.${NC}"
  echo
  ./cms_install.sh install --version "$CMS_VERSION"
  echo -e "${GREEN}✓ CMS instalado${NC}"
fi

# --------------------------------------------------- 4. Rutas hacia las ONU
STAGE="rutas hacia la LAN de ONU"
wg_gateway() {
  # IP del contenedor WireGuard vista desde el host
  docker inspect "$WG_CONTAINER" \
    --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' 2>/dev/null \
    | awk '{print $NF}'
}

apply_routes() {
  local gw="$1" net
  ip route replace "$WG_SUBNET" via "$gw" 2>/dev/null || true
  IFS=', ' read -r -a nets <<< "${ONU_NETS}"
  for net in "${nets[@]}"; do
    [ -n "$net" ] || continue
    ip route replace "$net" via "$gw" 2>/dev/null \
      && echo -e "  ${GREEN}✓${NC} ruta $net vía $gw" \
      || echo -e "  ${YELLOW}⚠${NC} no se pudo aplicar $net"
  done
}

if docker ps --format '{{.Names}}' | grep -qx "$WG_CONTAINER"; then
  GW="$(wg_gateway)"
  if [ -n "$GW" ]; then
    sysctl -qw net.ipv4.ip_forward=1
    grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
    apply_routes "$GW"

    # Persistencia: reaplica rutas al arrancar y cada 5 min (la IP del
    # contenedor cambia al recrearlo).
    cat > /usr/local/bin/omnisync-onu-routes.sh <<EOF
#!/usr/bin/env bash
GW=\$(docker inspect $WG_CONTAINER --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' 2>/dev/null | awk '{print \$NF}')
[ -n "\$GW" ] || exit 0
ip route replace $WG_SUBNET via "\$GW" 2>/dev/null
for net in ${ONU_NETS//,/ }; do
  ip route replace "\$net" via "\$GW" 2>/dev/null
done
docker exec $WG_CONTAINER sh -c '
  iptables -C FORWARD -i eth0 -o wg0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i eth0 -o wg0 -j ACCEPT
  iptables -C FORWARD -i wg0 -o eth0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i wg0 -o eth0 -j ACCEPT
  iptables -t nat -C POSTROUTING -s 172.16.0.0/12 -o wg0 -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 172.16.0.0/12 -o wg0 -j MASQUERADE
' >/dev/null 2>&1
EOF
    chmod +x /usr/local/bin/omnisync-onu-routes.sh
    cat > /etc/systemd/system/omnisync-onu-routes.service <<'EOF'
[Unit]
Description=OmniSync - rutas VPN hacia la LAN de ONU
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/omnisync-onu-routes.sh
EOF
    cat > /etc/systemd/system/omnisync-onu-routes.timer <<'EOF'
[Unit]
Description=Reaplica las rutas VPN hacia la LAN de ONU

[Timer]
OnBootSec=60
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now omnisync-onu-routes.timer >/dev/null 2>&1 || true
    /usr/local/bin/omnisync-onu-routes.sh || true
    echo -e "${GREEN}✓ Rutas persistentes configuradas${NC}"
  else
    echo -e "${YELLOW}⚠ No se detectó la IP del contenedor WireGuard.${NC}"
  fi
else
  echo -e "${YELLOW}⚠ WireGuard no está corriendo; omito las rutas.${NC}"
fi

VPS_IP="${VPS_PUBLIC_IP:-$(curl -4 -fsS --connect-timeout 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')}"
WG_IP="${WG_SUBNET%.*}.1"

cat <<EOF

$(echo -e "${GREEN}=========================================${NC}")
$(echo -e "${GREEN} Instalación terminada${NC}")
$(echo -e "${GREEN}=========================================${NC}")

  CMS C-Data      http://${VPS_IP}          (root / adminisp)
  ACS TR-069      http://${WG_IP}:9909/v1/acs   ← ponlo en la ONU
  Panel WireGuard http://${VPS_IP}:51821
  Panel MikroTik  http://${VPS_IP}:51822

  Rutas hacia ONU: ${ONU_NETS:-(ninguna; usa ONU_NETS=10.0.0.0/24)}

  Equivalencia con el video:
    L2TP (vpnsetup.sh)          →  WireGuard (panel 51821)
    ip route add 10.0.0.0/24 dev ppp0  →  ONU_NETS=10.0.0.0/24 (automático)
    install_docker.sh + cms_install.sh →  este script

EOF
