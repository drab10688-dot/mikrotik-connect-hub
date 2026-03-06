#!/bin/bash
set -e

CMS_DIR="/opt/cms"
CMS_VERSION="${CMS_VERSION:-4.0.3}"

# Check if CMS is already installed
if [ ! -f "$CMS_DIR/cms_install.sh" ]; then
  echo "Descargando instalador CMS C-Data v${CMS_VERSION}..."
  curl -fsSL -o "$CMS_DIR/cms_install.sh" "https://cms.s.cdatayun.com/cms_linux/cms_install.sh"
  chmod +x "$CMS_DIR/cms_install.sh"
fi

# Run installer if CMS binary not found
if ! command -v cms &>/dev/null && [ ! -f /usr/local/bin/cms ] && [ ! -f "$CMS_DIR/cms" ]; then
  echo "Instalando CMS C-Data v${CMS_VERSION}..."
  cd "$CMS_DIR"
  ./cms_install.sh install --version "$CMS_VERSION" || {
    echo "Error al instalar CMS. Verificando archivos..."
    ls -la "$CMS_DIR/"
    # Try to find the binary
    find / -name "cms" -type f 2>/dev/null | head -5
    echo "Iniciando servidor placeholder..."
    while true; do
      echo -e "HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/html\r\n\r\n<html><body><h1>CMS C-Data</h1><p>Error de instalacion. Revise los logs del contenedor.</p></body></html>" | nc -l -p 18080 -q 1 2>/dev/null || sleep 5
    done
  }
fi

echo "Iniciando CMS C-Data v${CMS_VERSION}..."

# Try known locations for CMS binary
if command -v cms &>/dev/null; then
  exec cms
elif [ -f /usr/local/bin/cms ]; then
  exec /usr/local/bin/cms
elif [ -f "$CMS_DIR/cms" ]; then
  exec "$CMS_DIR/cms"
else
  # Search for installed binary
  CMS_BIN=$(find / -name "cms" -type f -executable 2>/dev/null | head -1)
  if [ -n "$CMS_BIN" ]; then
    echo "CMS encontrado en: $CMS_BIN"
    exec "$CMS_BIN"
  else
    echo "CMS binary no encontrado tras la instalacion."
    echo "Contenido de $CMS_DIR:"
    ls -laR "$CMS_DIR/" 2>/dev/null
    echo "Iniciando servidor placeholder en puerto 18080..."
    while true; do
      echo -e "HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/html\r\n\r\n<html><body><h1>CMS C-Data</h1><p>Binario no encontrado. Ejecute manualmente: docker exec -it omnisync-cms-cdata ./cms_install.sh install --version ${CMS_VERSION}</p></body></html>" | nc -l -p 18080 -q 1 2>/dev/null || sleep 5
    done
  fi
fi
