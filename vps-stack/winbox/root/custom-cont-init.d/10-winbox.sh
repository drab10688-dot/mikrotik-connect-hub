#!/bin/bash
# Descarga Winbox (si falta), prepara el prefijo Wine y crea accesos directos.
set -u

WB_DIR=/config/winbox
WB_EXE="$WB_DIR/winbox64.exe"

mkdir -p "$WB_DIR" /config/Desktop /config/.config/autostart

if [ ! -s "$WB_EXE" ]; then
  echo "[winbox] descargando Winbox…"
  for url in \
    "https://mt.lv/winbox64" \
    "https://download.mikrotik.com/routeros/winbox/3.41/winbox64.exe" \
    "https://download.mikrotik.com/routeros/winbox/3.40/winbox64.exe"; do
    if curl -fsSL --connect-timeout 15 "$url" -o "$WB_EXE.tmp" && [ -s "$WB_EXE.tmp" ]; then
      mv "$WB_EXE.tmp" "$WB_EXE"
      echo "[winbox] descargado desde $url"
      break
    fi
    rm -f "$WB_EXE.tmp"
  done
fi

if [ ! -s "$WB_EXE" ]; then
  echo "[winbox] ⚠ no se pudo descargar Winbox; copia winbox64.exe manualmente en el volumen /config/winbox"
fi

# Prefijo Wine (silencioso, sin mono/gecko)
if [ ! -d /config/.wine ]; then
  echo "[winbox] inicializando Wine…"
  WINEDEBUG=-all WINEPREFIX=/config/.wine WINEARCH=win64 WINEDLLOVERRIDES="mscoree,mshtml=" \
    wineboot -u >/dev/null 2>&1 || true
fi

cat > /config/Desktop/winbox.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Winbox
Comment=MikroTik Winbox (Wine)
Exec=/usr/local/bin/winbox
Icon=network-workgroup
Terminal=false
Categories=Network;
EOF

cp /config/Desktop/winbox.desktop /config/.config/autostart/winbox.desktop

chmod +x /config/Desktop/winbox.desktop
chown -R "${PUID:-1000}:${PGID:-1000}" /config/winbox /config/Desktop /config/.config /config/.wine 2>/dev/null || true

echo "[winbox] listo"
