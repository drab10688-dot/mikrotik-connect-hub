#!/usr/bin/env bash
# ============================================================
# Certificado GRATIS (Let's Encrypt) para OmniSync
# ------------------------------------------------------------
# Elimina la advertencia "conexión no privada" del panel y del
# escritorio remoto (puerto 8081).
#
#   sudo bash setup-ssl.sh midominio.duckdns.org correo@dominio.com
#
# Dominios gratis recomendados:
#   - DuckDNS      (https://duckdns.org)  -> midominio.duckdns.org
#   - No-IP / FreeDNS
#   - sslip.io / nip.io -> 169-58-240-252.sslip.io  (sin registro)
# Apunte el dominio a la IP pública del VPS antes de ejecutar.
# ============================================================
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
INSTALL_DIR="${INSTALL_DIR:-/opt/omnisync}"

if [ -z "$DOMAIN" ]; then
  echo "Uso: sudo bash setup-ssl.sh <dominio> [correo]"
  exit 1
fi

WEBROOT="$INSTALL_DIR/frontend/dist"
CERTS="$INSTALL_DIR/nginx/certs"
mkdir -p "$WEBROOT/.well-known/acme-challenge" "$CERTS"

echo "== Instalando certbot =="
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -y >/dev/null
  apt-get install -y certbot >/dev/null
fi

echo "== Solicitando certificado para $DOMAIN =="
ARGS=(certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --agree-tos --non-interactive --keep-until-expiring)
if [ -n "$EMAIL" ]; then ARGS+=(-m "$EMAIL"); else ARGS+=(--register-unsafely-without-email); fi
certbot "${ARGS[@]}"

LIVE="/etc/letsencrypt/live/$DOMAIN"
cp -L "$LIVE/fullchain.pem" "$CERTS/remote.crt"
cp -L "$LIVE/privkey.pem"  "$CERTS/remote.key"
chmod 644 "$CERTS/remote.crt"; chmod 600 "$CERTS/remote.key"

echo "== Renovación automática =="
HOOK=/etc/letsencrypt/renewal-hooks/deploy/omnisync.sh
mkdir -p "$(dirname "$HOOK")"
cat > "$HOOK" <<EOF
#!/usr/bin/env bash
cp -L "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$CERTS/remote.crt"
cp -L "/etc/letsencrypt/live/$DOMAIN/privkey.pem"  "$CERTS/remote.key"
docker restart omnisync-nginx >/dev/null 2>&1 || true
EOF
chmod +x "$HOOK"

echo "== Reiniciando proxy =="
docker restart omnisync-nginx >/dev/null 2>&1 || true

echo
echo "Listo. Entre SIEMPRE por:  https://$DOMAIN"
echo "El escritorio remoto usará https://$DOMAIN:8081 sin advertencias."
