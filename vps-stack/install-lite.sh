#!/bin/bash
# Compatibilidad: el modo Lite ahora instala únicamente WireGuard y su panel.
# CMS C-Data se instala aparte para que sus fallos no afecten la VPN.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/install-wireguard-panel.sh"

if [ ! -s "$INSTALLER" ]; then
  INSTALLER="/tmp/install-wireguard-panel.sh"
  curl -fsSL --retry 3 --connect-timeout 15 --max-time 120 \
    -o "$INSTALLER" \
    "https://raw.githubusercontent.com/drab10688-dot/mikrotik-connect-hub/main/vps-stack/install-wireguard-panel.sh"
fi

echo "OmniSync Lite ahora instala WireGuard + Panel MikroTik solamente."
echo "CMS C-Data queda separado y no será modificado."
exec bash "$INSTALLER"