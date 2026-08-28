#!/usr/bin/env bash
# ============================================================
# OmniSync - VPN principal: L2TP/IPsec
# Levanta el servidor L2TP/IPsec en el VPS, sincroniza los
# usuarios de cada ISP (tabla tenant_vpn_peers) y deja listo el
# script para pegar en la MikroTik (RouterOS v6/v7).
#
# Uso:
#   bash vps-stack/install-l2tp.sh
#   bash vps-stack/install-l2tp.sh --onu-nets "10.82.0.0/21,192.168.20.0/24"
# ============================================================
set -uo pipefail

C='\033[0;36m'; G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
info(){ echo -e "${C}==>${N} $*"; }
ok(){ echo -e "${G}[OK]${N} $*"; }
warn(){ echo -e "${Y}[!]${N} $*"; }
err(){ echo -e "${R}[X]${N} $*"; }

ONU_NETS="${ONU_NETS:-10.82.0.0/21}"
while [ $# -gt 0 ]; do
  case "$1" in
    --onu-nets) ONU_NETS="${2:-}"; shift 2;;
    *) shift;;
  esac
done

[ "$(id -u)" -eq 0 ] || { err "Ejecuta como root"; exit 1; }

DIR=/opt/omnisync-l2tp
STACK_DIR=/opt/omnisync
mkdir -p "$DIR"

TUNNEL_NET="192.168.42.0/24"
TUNNEL_SRV="192.168.42.1"
TUNNEL_POOL_START="192.168.42.10"

# --- Credenciales (persistentes) ---
ENVF="$DIR/vpn.env"
if [ -f "$ENVF" ]; then
  # shellcheck disable=SC1090
  . "$ENVF"
  info "Usando credenciales existentes en $ENVF"
else
  VPN_IPSEC_PSK="$(openssl rand -hex 16)"
  VPN_USER="mikrotik"
  VPN_PASSWORD="$(openssl rand -hex 12)"
  cat > "$ENVF" <<EOF
VPN_IPSEC_PSK=$VPN_IPSEC_PSK
VPN_USER=$VPN_USER
VPN_PASSWORD=$VPN_PASSWORD
EOF
  chmod 600 "$ENVF"
  ok "Credenciales generadas"
fi

PUBIP="${VPS_PUBLIC_IP:-$(curl -4 -s --max-time 8 https://ifconfig.me || curl -4 -s --max-time 8 https://api.ipify.org)}"
[ -n "$PUBIP" ] || { err "No se pudo detectar la IP pública. Exporta VPS_PUBLIC_IP=..."; exit 1; }

# ------------------------------------------------------------
# Script para MikroTik (se genera SIEMPRE, antes de todo lo demás)
# ------------------------------------------------------------
MT="$DIR/mikrotik-l2tp.rsc"
cat > "$MT" <<EOF
# ============================================
# OmniACS L2TP/IPsec — RouterOS v6/v7
# Pegar completo en la terminal de la MikroTik
# ============================================

# 1) Túnel L2TP/IPsec hacia el VPS
/interface l2tp-client
remove [find name="OmniACS-VPN"]
add name="OmniACS-VPN" connect-to=$PUBIP user="$VPN_USER" password="$VPN_PASSWORD" \\
    profile=default-encryption use-ipsec=yes ipsec-secret="$VPN_IPSEC_PSK" \\
    add-default-route=no allow=mschap2 keepalive-timeout=30 disabled=no comment="OmniACS VPN"

# 2) Ruta hacia el ACS (VPS) por el túnel
/ip route
add dst-address=$TUNNEL_SRV/32 gateway="OmniACS-VPN" comment="Ruta hacia ACS"

# 3) NAT para que el ACS llegue directo al segmento de las ONUs
/ip firewall nat
add chain=srcnat out-interface="OmniACS-VPN" action=masquerade comment="NAT TR-069 OmniACS"

# 4) TR-069 de las ONUs
#   ACS URL (por VPN) : http://$TUNNEL_SRV:7547/
#   ACS URL (público) : http://$PUBIP:7547/
#   Usuario / clave   : omnisync / <token-del-ISP>
#   Inform periódico  : 60s   |   STUN: desactivado (se usa la VPN)
# ============================================
:put "OmniACS: túnel L2TP configurado hacia $PUBIP"
EOF
ok "Script MikroTik generado: $MT"

# --- Docker ---
if ! command -v docker >/dev/null 2>&1; then
  info "Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
fi

# --- Kernel modules ---
modprobe af_key    2>/dev/null || true
modprobe ip_tables 2>/dev/null || true
modprobe xfrm_user 2>/dev/null || true

sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf 2>/dev/null || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf

# --- Contenedor L2TP/IPsec ---
info "Desplegando servidor L2TP/IPsec..."
docker rm -f omnisync-l2tp >/dev/null 2>&1 || true

cat > "$DIR/vpn.conf" <<EOF
VPN_IPSEC_PSK=$VPN_IPSEC_PSK
VPN_USER=$VPN_USER
VPN_PASSWORD=$VPN_PASSWORD
VPN_L2TP_NET=$TUNNEL_NET
VPN_L2TP_LOCAL=$TUNNEL_SRV
VPN_L2TP_POOL=192.168.42.10-192.168.42.250
VPN_DNS_SRV1=8.8.8.8
VPN_DNS_SRV2=1.1.1.1
VPN_SHA2_TRUNCBUG=no
EOF
chmod 600 "$DIR/vpn.conf"

# IMPORTANTE: red host. Con -p (docker-proxy) IKE/ESP se rompe y el cliente
# solo ve retransmisiones en fase 1.
docker run -d --name omnisync-l2tp \
  --restart unless-stopped \
  --privileged \
  --network host \
  --env-file "$DIR/vpn.conf" \
  -v "$DIR/ikev2-vpn-data":/etc/ipsec.d \
  -v /lib/modules:/lib/modules:ro \
  hwdsl2/ipsec-vpn-server >/dev/null

sleep 8
if ! docker ps --format '{{.Names}}' | grep -q omnisync-l2tp; then
  err "El contenedor no arrancó"; docker logs --tail 40 omnisync-l2tp; exit 1
fi
ok "Servidor L2TP/IPsec activo"

# --- Firewall ---
if command -v ufw >/dev/null 2>&1; then
  ufw allow 500/udp  >/dev/null 2>&1 || true
  ufw allow 4500/udp >/dev/null 2>&1 || true
  ufw allow 1701/udp >/dev/null 2>&1 || true
fi

# --- Publicar datos de la VPN al stack (los usa el panel) ---
if [ -f "$STACK_DIR/.env" ]; then
  sed -i '/^L2TP_/d;/^VPN_SERVER_IP=/d' "$STACK_DIR/.env" 2>/dev/null || true
  {
    echo "L2TP_HOST=$PUBIP"
    echo "L2TP_IPSEC_PSK=$VPN_IPSEC_PSK"
    echo "L2TP_TUNNEL_NET=$TUNNEL_NET"
    echo "VPN_SERVER_IP=$TUNNEL_SRV"
  } >> "$STACK_DIR/.env"
  ok "Datos de la VPN publicados en $STACK_DIR/.env"
  (cd "$STACK_DIR/vps-stack" 2>/dev/null && docker compose up -d api >/dev/null 2>&1) || true
fi

# --- Sincronizador de usuarios VPN por ISP ---
cat > "$DIR/l2tp-users-sync.sh" <<'EOS'
#!/usr/bin/env bash
# Copia los usuarios VPN de cada ISP (tenant_vpn_peers) al servidor L2TP,
# asignando a cada router su IP fija dentro del túnel.
set -u
docker ps --format '{{.Names}}' | grep -q '^omnisync-l2tp$' || exit 0
docker ps --format '{{.Names}}' | grep -q '^omnisync-postgres$' || exit 0

ROWS=$(docker exec omnisync-postgres psql -U "${DB_USER:-omnisync}" -d "${DB_NAME:-omnisync}" -tAF'|' \
  -c "SELECT username, password, tunnel_ip FROM tenant_vpn_peers WHERE username IS NOT NULL" 2>/dev/null)
[ -n "$ROWS" ] || exit 0

TMP=$(mktemp)
docker exec omnisync-l2tp cat /etc/ppp/chap-secrets 2>/dev/null | grep -v '# omnisync' > "$TMP" || true
while IFS='|' read -r user pass ip; do
  [ -n "$user" ] || continue
  echo "\"$user\" l2tpd \"$pass\" ${ip:-*} # omnisync" >> "$TMP"
done <<< "$ROWS"

docker cp "$TMP" omnisync-l2tp:/etc/ppp/chap-secrets >/dev/null 2>&1
rm -f "$TMP"
EOS
chmod +x "$DIR/l2tp-users-sync.sh"
[ -f "$STACK_DIR/.env" ] && set -a && . "$STACK_DIR/.env" 2>/dev/null; set +a
"$DIR/l2tp-users-sync.sh" >/dev/null 2>&1 || true

# --- Rutas hacia las redes de ONUs por el túnel L2TP ---
cat > "$DIR/l2tp-routes.sh" <<'EOS'
#!/usr/bin/env bash
# Reaplica rutas hacia las redes de ONUs a través del cliente L2TP (MikroTik)
set -u
NETS="__NETS__"
GW="__GW__"
for n in $(echo "$NETS" | tr ',' ' '); do
  [ -n "$n" ] || continue
  ip route replace "$n" via "$GW" 2>/dev/null || true
  docker exec omnisync-api ip route replace "$n" via "$GW" 2>/dev/null || true
done
iptables -t nat -C POSTROUTING -s 192.168.42.0/24 -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s 192.168.42.0/24 -j MASQUERADE 2>/dev/null || true
EOS
sed -i "s|__NETS__|$ONU_NETS|; s|__GW__|$TUNNEL_POOL_START|" "$DIR/l2tp-routes.sh"
chmod +x "$DIR/l2tp-routes.sh"
"$DIR/l2tp-routes.sh" >/dev/null 2>&1 || true

if ! command -v crontab >/dev/null 2>&1; then
  info "Instalando cron..."
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y cron >/dev/null 2>&1 || warn "No se pudo instalar cron"
fi
if command -v crontab >/dev/null 2>&1; then
  CRON=$({ crontab -l 2>/dev/null || true; } | grep -v 'omnisync-l2tp/l2tp-' || true)
  printf '%s\n* * * * * %s >/dev/null 2>&1\n*/2 * * * * %s >/dev/null 2>&1\n' \
    "$CRON" "$DIR/l2tp-routes.sh" "$DIR/l2tp-users-sync.sh" | crontab - 2>/dev/null \
    && ok "Rutas y usuarios VPN persistentes (cron)" \
    || warn "No se pudo registrar el cron"
else
  warn "Rutas aplicadas solo para esta sesión"
fi

echo
echo "════════════════════════════════════════════"
echo -e "${G} VPN L2TP/IPsec lista (VPN principal)${N}"
echo "════════════════════════════════════════════"
echo " Servidor    : $PUBIP"
echo " Usuario     : $VPN_USER"
echo " Contraseña  : $VPN_PASSWORD"
echo " IPsec PSK   : $VPN_IPSEC_PSK"
echo " Red túnel   : $TUNNEL_NET (VPS = $TUNNEL_SRV)"
echo " Redes ONU   : $ONU_NETS"
echo
echo " Script MikroTik: $MT"
echo " (o genéralo por ISP desde el panel → TR-069 y VPN)"
echo "════════════════════════════════════════════"
