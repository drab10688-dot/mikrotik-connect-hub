#!/usr/bin/env bash
# OmniSync - Restaura el enrutamiento VPN (WireGuard) del VPS
# Reaplica: contenedor WG en la red del stack, rutas host + API hacia
# 10.13.13.0/24 y redes remotas, forwarding/MASQUERADE y cron de auto-curación.
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/omnisync}"
DB_USER="${DB_USER:-omnisync}"
DB_NAME="${DB_NAME:-omnisync}"

if [ -f "$APP_DIR/.env" ]; then
  set -a; . "$APP_DIR/.env"; set +a
fi

echo "▶ Restaurando enrutamiento VPN..."

# 1. Asegurar que el contenedor WireGuard esté arriba (restart: no)
if ! docker ps --format '{{.Names}}' | grep -qx 'omnisync-wireguard'; then
  echo "  · WireGuard apagado, iniciándolo..."
  (cd "$APP_DIR" && docker compose up -d wireguard) >/dev/null 2>&1
  sleep 5
fi

if ! docker ps --format '{{.Names}}' | grep -qx 'omnisync-wireguard'; then
  echo "  ✗ No se pudo iniciar omnisync-wireguard"
  exit 1
fi

# 2. Conectar WG a la red del stack y obtener su IP interna
docker network connect omnisync_omnisync-net omnisync-wireguard 2>/dev/null || true
WG_IP=$(docker inspect omnisync-wireguard --format '{{range $k,$v := .NetworkSettings.Networks}}{{if eq $k "omnisync_omnisync-net"}}{{$v.IPAddress}}{{end}}{{end}}' 2>/dev/null)
[ -z "$WG_IP" ] && WG_IP=$(docker inspect omnisync-wireguard --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' 2>/dev/null | awk '{print $NF}')

if [ -z "$WG_IP" ]; then
  echo "  ✗ No se detectó la IP del contenedor WireGuard"
  exit 1
fi
echo "  · WireGuard en $WG_IP"

# 3. Ruta dentro del contenedor API
docker exec omnisync-api ip route replace 10.13.13.0/24 via "$WG_IP" 2>/dev/null \
  && echo "  ✓ Ruta API 10.13.13.0/24" || echo "  ⚠ Ruta API no aplicada"

# 4. Rutas host (VPN + redes remotas de los peers activos)
ip route replace 10.13.13.0/24 via "$WG_IP" 2>/dev/null && echo "  ✓ Ruta host 10.13.13.0/24"

REMOTE_NETS=$(docker exec omnisync-postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT DISTINCT remote_networks FROM vpn_peers WHERE is_active=true AND remote_networks IS NOT NULL" 2>/dev/null)
if [ -n "$REMOTE_NETS" ]; then
  echo "$REMOTE_NETS" | tr ', ' '\n\n' | while read -r net; do
    [ -z "$net" ] && continue
    ip route replace "$net" via "$WG_IP" 2>/dev/null && echo "  ✓ Ruta host $net"
  done
fi

# 5. Forwarding y MASQUERADE dentro del contenedor WireGuard
docker exec omnisync-wireguard sh -c '
  iptables -C FORWARD -i eth0 -o wg0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i eth0 -o wg0 -j ACCEPT
  iptables -C FORWARD -i wg0 -o eth0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i wg0 -o eth0 -j ACCEPT
  iptables -t nat -C POSTROUTING -s 172.16.0.0/12 -o wg0 -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 172.16.0.0/12 -o wg0 -j MASQUERADE
' >/dev/null 2>&1 && echo "  ✓ Forwarding/NAT VPN" || echo "  ⚠ Forwarding VPN no aplicado"

# 6. Auto-curación por cron (reaplica rutas si WG cambia de IP)
REFRESH_SCRIPT="$APP_DIR/scripts/refresh-vpn-routes.sh"
mkdir -p "$APP_DIR/scripts"
cat > "$REFRESH_SCRIPT" <<'ROUTE_EOF'
#!/bin/bash
WG_IP=$(docker inspect omnisync-wireguard --format '{{range $k,$v := .NetworkSettings.Networks}}{{if eq $k "omnisync_omnisync-net"}}{{$v.IPAddress}}{{end}}{{end}}' 2>/dev/null)
[ -z "$WG_IP" ] && WG_IP=$(docker inspect omnisync-wireguard --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' 2>/dev/null | awk '{print $NF}')
[ -z "$WG_IP" ] && exit 0
ip route replace 10.13.13.0/24 via "$WG_IP" 2>/dev/null
docker exec omnisync-api ip route replace 10.13.13.0/24 via "$WG_IP" 2>/dev/null
NETWORKS=$(docker exec omnisync-postgres psql -U omnisync -d omnisync -tAc \
  "SELECT DISTINCT remote_networks FROM vpn_peers WHERE is_active=true AND remote_networks IS NOT NULL" 2>/dev/null)
echo "$NETWORKS" | tr ', ' '\n\n' | while read -r net; do
  [ -z "$net" ] && continue
  ip route replace "$net" via "$WG_IP" 2>/dev/null
done
ROUTE_EOF
chmod +x "$REFRESH_SCRIPT"
( crontab -l 2>/dev/null | grep -v "refresh-vpn-routes.sh" ; echo "* * * * * $REFRESH_SCRIPT >/dev/null 2>&1" ) | crontab -
echo "  ✓ Cron de auto-curación activo"

echo ""
echo "Estado del túnel:"
docker exec omnisync-wireguard wg show 2>/dev/null | head -20 || echo "  (wg show no disponible)"
echo ""
echo "✓ Enrutamiento VPN restaurado."
