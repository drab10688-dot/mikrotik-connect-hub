#!/bin/bash
set -e

CMS_DIR="/opt/cms"
CMS_BIN="$CMS_DIR/cms"

# Download CMS binary if not present
if [ ! -f "$CMS_BIN" ]; then
  echo "Descargando CMS C-Data..."
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64|amd64) CMS_ARCH="amd64" ;;
    aarch64|arm64) CMS_ARCH="arm64" ;;
    *) echo "Arquitectura no soportada: $ARCH"; exit 1 ;;
  esac
  
  # Try to download from GitHub release
  wget -q "https://github.com/beryindo/cms/releases/latest/download/cms-linux-${CMS_ARCH}" -O "$CMS_BIN" 2>/dev/null || \
  wget -q "https://github.com/beryindo/cms/raw/main/cms-linux-${CMS_ARCH}" -O "$CMS_BIN" 2>/dev/null || \
  wget -q "https://cdatayun.com/download/cms-linux-${CMS_ARCH}" -O "$CMS_BIN" 2>/dev/null || true
  
  chmod +x "$CMS_BIN" 2>/dev/null || true
fi

if [ -f "$CMS_BIN" ] && [ -x "$CMS_BIN" ]; then
  echo "Iniciando CMS C-Data en puerto 18080..."
  exec "$CMS_BIN" --port 18080 --data-dir /opt/cms/data
else
  echo "CMS binary no disponible. Iniciando servidor placeholder..."
  # Simple HTTP server as placeholder
  while true; do
    echo -e "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body><h1>CMS C-Data</h1><p>El binario de CMS no se pudo descargar. Verifique la conectividad del servidor.</p></body></html>" | nc -l -p 18080 -q 1 2>/dev/null || sleep 5
  done
fi
