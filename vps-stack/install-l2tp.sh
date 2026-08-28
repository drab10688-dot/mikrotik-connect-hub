#!/usr/bin/env bash
# ============================================================
# OmniSync - Servidor VPN L2TP/IPsec (alternativa a WireGuard)
# Levanta un servidor L2TP/IPsec en el VPS y deja listo el
# script para pegar en la MikroTik (RouterOS v6/v7).
#
# Uso:
#   bash vps-stack/install-l2tp.sh
#   bash vps-stack/install-l2tp.sh --onu-nets "10.82.0.0/21,192.168.20.0/24"
# ============================================================
set -euo pipefail

C='\033[0;36m'; G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
info(){ echo -e "${C}==>${N} $*"; }
ok(){ echo -e "${G}[OK]${N} $*"; }
warn(){ echo -e "${Y}[!]${N} $*"; }
err(){ echo -e "${R}[X]${N} $*"; }

ONU_NETS="${ONU_NETS:-10.82.0.0/21}"
while [ $# -gt 0 ]; do
  case "$1" in
    --onu-nets) ONU_NETS="$2"; shift 2;;
    *) shift;;
  esac
done

[ "$(id -u)" -eq 0 ] || { err "Ejecuta como root"; exit 1; }

DIR=/opt/omnisync-l2tp
mkdir -p "$DIR"

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

# --- Docker ---
if ! command -v docker >/dev/null 2>&1; then
  info "Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
fi

# --- Kernel modules ---
modprobe af_key   2>/dev/null || true
modprobe ip_tables 2>/dev/null || true
modprobe xfrm_user 2>/dev/null || true

sysctl -w net.ipv4.ip_forward=1 >/dev/null
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf

# --- Contenedor L2TP/IPsec ---
info "Desplegando servidor L2TP/IPsec..."
docker rm -f omnisync-l2tp >/dev/null 2>&1 || true

cat > "$DIR/vpn.conf" <<EOF
VPN_IPSEC_PSK=$VPN_IPSEC_PSK
VPN_USER=$VPN_USER
VPN_PASSWORD=$VPN_PASSWORD
VPN_L2TP_NET=192.168.42.0/24
VPN_L2TP_LOCAL=192.168.42.1
VPN_L2TP_POOL=192.168.42.10-192.168.42.250
VPN_DNS_SRV1=8.8.8.8
VPN_DNS_SRV2=1.1.1.1
VPN_SHA2_TRUNCBUG=no
EOF
chmod 600 "$DIR/vpn.conf"

docker run -d --name omnisync-l2tp \
  --restart unless-stopped \
  --privileged \
  -p 500:500/udp -p 4500:4500/udp -p 1701:1701/udp \
  --env-file "$DIR/vpn.conf" \
  -v "$DIR/ikev2-vpn-data":/etc/ipsec.d \
  -v /lib/modules:/lib/modules:ro \
  hwdsl2/ipsec-vpn-server >/dev/null

sleep 8
docker ps --format '{{.Names}}' | grep -q omnisync-l2tp || { err "El contenedor no arrancó"; docker logs --tail 40 omnisync-l2tp; exit 1; }
ok "Servidor L2TP/IPsec activo"

# --- Firewall ---
if command -v ufw >/dev/null 2>&1; then
  ufw allow 500/udp  >/dev/null 2>&1 || true
  ufw allow 4500/udp >/dev/null 2>&1 || true
  ufw allow 1701/udp >/dev/null 2>&1 || true
fi

# --- Rutas hacia las redes de ONUs por el túnel L2TP ---
cat > "$DIR/l2tp-routes.sh" <<'EOS'
#!/usr/bin/env bash
# Reaplica rutas hacia las redes de ONUs a través del cliente L2TP (MikroTik)
set -u
NETS="__NETS__"
PEER="$(ip -4 route show 192.168.42.0/24 2>/dev/null | head -1 >/dev/null; echo)"
# La MikroTik es el primer cliente del pool
GW="192.168.42.10"
for n in $(echo "$NETS" | tr ',' ' '); do
  [ -n "$n" ] || continue
  ip route replace "$n" via "$GW" 2>/dev/null || true
  docker exec omnisync-api ip route replace "$n" via "$GW" 2>/dev/null || true
done
iptables -t nat -C POSTROUTING -s 192.168.42.0/24 -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s 192.168.42.0/24 -j MASQUERADE 2>/dev/null || true
EOS
sed -i "s|__NETS__|$ONU_NETS|" "$DIR/l2tp-routes.sh"
chmod +x "$DIR/l2tp-routes.sh"
"$DIR/l2tp-routes.sh" || true
if ! command -v crontab >/dev/null 2>&1; then
  info "Instalando cron..."
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y cron >/dev/null 2>&1 || warn "No se pudo instalar cron (rutas no persistentes tras reinicio)"
fi
if command -v crontab >/dev/null 2>&1; then
  { { crontab -l 2>/dev/null || true; } | { grep -v l2tp-routes.sh || true; }; echo "* * * * * $DIR/l2tp-routes.sh >/dev/null 2>&1"; } | crontab - || warn "No se pudo registrar el cron"
  ok "Rutas hacia $ONU_NETS configuradas y persistentes (cron)"
else
  warn "Rutas aplicadas solo para esta sesión"
fi

# --- Script para MikroTik ---
MT="$DIR/mikrotik-l2tp.rsc"
cat > "$MT" <<EOF
# ============================================
# OmniSync L2TP/IPsec - RouterOS v6/v7
# Pegar completo en la terminal de la MikroTik
# ============================================
/interface l2tp-client
remove [find name="l2tp-omnisync"]
add name="l2tp-omnisync" connect-to=$PUBIP user="$VPN_USER" password="$VPN_PASSWORD" \\
    use-ipsec=yes ipsec-secret="$VPN_IPSEC_PSK" disabled=no \\
    add-default-route=no allow=mschap2 keepalive-timeout=30 comment="OmniSync VPN"

/ip firewall filter
add chain=input protocol=udp dst-port=1701,500,4500 action=accept comment="OmniSync L2TP" place-before=0
add chain=input in-interface="l2tp-omnisync" action=accept comment="OmniSync VPN in" place-before=0

/ip service
set api disabled=no port=8728
set www disabled=no port=80

# Permitir que el VPS llegue a la red de ONUs
/ip firewall nat
add chain=srcnat src-address=192.168.42.0/24 action=masquerade comment="OmniSync VPN -> ONUs"
EOF

echo
echo "════════════════════════════════════════════"
echo -e "${G} VPN L2TP/IPsec lista${N}"
echo "════════════════════════════════════════════"
echo " Servidor    : $PUBIP"
echo " Usuario     : $VPN_USER"
echo " Contraseña  : $VPN_PASSWORD"
echo " IPsec PSK   : $VPN_IPSEC_PSK"
echo " Red túnel   : 192.168.42.0/24 (VPS = 192.168.42.1)"
echo " Redes ONU   : $ONU_NETS"
echo
echo " Script MikroTik: $MT"
echo " (cat $MT  y pega el contenido en la MikroTik)"
echo "════════════════════════════════════════════"
