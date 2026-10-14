#!/bin/bash
# Construye la imagen del WinBox remoto (omnisync/winbox:latest) desde
# vps-stack/winbox. La usan install.sh y update.sh.
# Reintenta una vez (la descarga de WinBox o de paquetes puede fallar puntual)
# y, si falla, muestra el final del registro en vez de callarlo.
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG=/var/log/omnisync-winbox-build.log
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

for intento in 1 2; do
  if docker build -t omnisync/winbox:latest "$DIR/winbox" >"$LOG" 2>&1; then
    echo -e "${GREEN}✓ Imagen de WinBox remoto lista${NC}"
    exit 0
  fi
  [ "$intento" = 1 ] && echo -e "${YELLOW}⚠ Falló la construcción de WinBox remoto, reintentando...${NC}" && sleep 5
done

echo -e "${YELLOW}⚠ No se pudo construir WinBox remoto; el resto sigue funcionando. Últimas líneas ($LOG):${NC}"
tail -n 15 "$LOG"
exit 1
