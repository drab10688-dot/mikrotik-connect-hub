#!/usr/bin/env bash
# Diagnóstico integral del navegador remoto hacia una IP privada.
# Uso: sudo bash /opt/omnisync/test-browser.sh 10.82.0.29 80

set -u

INSTALL_DIR="/opt/omnisync"
TARGET_IP="${1:-10.82.0.29}"
TARGET_PORT="${2:-80}"
TARGET_URL="http://${TARGET_IP}:${TARGET_PORT}/"
FAIL=0

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

ok() { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; FAIL=$((FAIL + 1)); }

if ! echo "$TARGET_IP" | grep -Eq '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.)[0-9.]+$'; then
  echo -e "${RED}Solo se permiten direcciones IPv4 privadas.${NC}"
  exit 2
fi
if ! echo "$TARGET_PORT" | grep -Eq '^[0-9]{1,5}$' || [ "$TARGET_PORT" -lt 1 ] || [ "$TARGET_PORT" -gt 65535 ]; then
  echo -e "${RED}Puerto inválido: ${TARGET_PORT}${NC}"
  exit 2
fi
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo -e "${RED}Ejecuta este diagnóstico con sudo/root.${NC}"
  exit 2
fi
if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
  echo -e "${RED}No existe $INSTALL_DIR/docker-compose.yml${NC}"
  exit 2
fi

echo -e "${CYAN}=== Diagnóstico navegador OmniSync → ${TARGET_URL} ===${NC}"

echo -e "\n${CYAN}[1/6] Túnel y ruta del host${NC}"
PPP_IF=$(ip -o link show 2>/dev/null | awk -F': ' '$2 ~ /^ppp[0-9]+$/ {print $2; exit}')
if [ -n "$PPP_IF" ]; then
  ok "Túnel L2TP activo: $PPP_IF"
else
  fail "No existe una interfaz ppp activa; primero conecta el L2TP."
fi
ROUTE=$(ip route get "$TARGET_IP" 2>&1 | head -1 || true)
echo "  $ROUTE"
if echo "$ROUTE" | grep -Eq 'dev ppp[0-9]+'; then
  ok "La IP usa el túnel L2TP"
else
  warn "La ruta no usa ppp; intentando restaurarla"
  ONU_NETS="${ONU_NETS:-10.82.0.0/21}" bash "$INSTALL_DIR/configure-browser-routing.sh" >/dev/null 2>&1 || true
  ROUTE=$(ip route get "$TARGET_IP" 2>&1 | head -1 || true)
  echo "  $ROUTE"
  echo "$ROUTE" | grep -Eq 'dev ppp[0-9]+' && ok "Ruta restaurada" || fail "No hay ruta L2TP hacia la ONU"
fi

echo -e "\n${CYAN}[2/6] Puerto desde el host VPS${NC}"
HOST_CODE=$(curl -sS -k -o /dev/null -w '%{http_code}' --connect-timeout 8 --max-time 12 "$TARGET_URL" 2>/dev/null || true)
if [ -n "$HOST_CODE" ] && [ "$HOST_CODE" != "000" ]; then
  ok "La ONU responde desde el VPS (HTTP $HOST_CODE)"
else
  fail "El VPS no alcanza ${TARGET_IP}:${TARGET_PORT}"
fi

echo -e "\n${CYAN}[3/6] Puerto desde el contenedor API${NC}"
API_CODE=$(docker exec omnisync-api curl -sS -k -o /dev/null -w '%{http_code}' --connect-timeout 8 --max-time 12 "$TARGET_URL" 2>/dev/null || true)
if [ -n "$API_CODE" ] && [ "$API_CODE" != "000" ]; then
  ok "La API alcanza la ONU (HTTP $API_CODE)"
else
  fail "La API no alcanza ${TARGET_IP}:${TARGET_PORT}"
fi

echo -e "\n${CYAN}[4/6] Estado del contenedor Firefox${NC}"
BROWSER_STATE=$(docker inspect --format '{{.State.Status}}' omnisync-browser 2>/dev/null || true)
if [ "$BROWSER_STATE" = "running" ]; then
  ok "omnisync-browser está activo"
else
  fail "omnisync-browser está ${BROWSER_STATE:-ausente}"
fi
SECCOMP=$(docker inspect --format '{{json .HostConfig.SecurityOpt}}' omnisync-browser 2>/dev/null || true)
if echo "$SECCOMP" | grep -q 'seccomp=unconfined'; then
  ok "Compatibilidad seccomp aplicada"
else
  fail "Falta seccomp=unconfined; recrea remote-browser con la versión actual"
fi

echo -e "\n${CYAN}[5/6] Red y escritorio remoto${NC}"
BROWSER_CODE=$(docker exec omnisync-browser curl -sS -k -o /dev/null -w '%{http_code}' --connect-timeout 8 --max-time 12 "$TARGET_URL" 2>/dev/null || true)
if [ -n "$BROWSER_CODE" ] && [ "$BROWSER_CODE" != "000" ]; then
  ok "Firefox alcanza la ONU (HTTP $BROWSER_CODE)"
else
  fail "El contenedor Firefox no alcanza ${TARGET_IP}:${TARGET_PORT}"
fi
GUI_CODE=$(docker exec omnisync-nginx wget -q -S -O /dev/null http://remote-browser:3000/ 2>&1 | awk '/HTTP\// {print $2; exit}' || true)
if [ -n "$GUI_CODE" ]; then
  ok "KasmVNC responde a Nginx (HTTP $GUI_CODE)"
else
  fail "KasmVNC no responde en remote-browser:3000"
fi

echo -e "\n${CYAN}[6/6] Apertura real como usuario abc${NC}"
OPEN_OUT=$(docker exec -u abc -e DISPLAY=:1 -e HOME=/config omnisync-browser \
  /usr/bin/firefox --new-tab "$TARGET_URL" 2>&1 || true)
if echo "$OPEN_OUT" | grep -qiE 'root|EPERM|not supported|error'; then
  fail "Firefox rechazó la apertura: $OPEN_OUT"
else
  ok "Orden enviada a Firefox para abrir $TARGET_URL"
fi

echo -e "\n${CYAN}Últimos mensajes relevantes de Firefox:${NC}"
docker logs --tail 80 omnisync-browser 2>&1 | grep -iE 'firefox|sandbox|namespace|error|fail|kasm|selkies' | tail -20 || true

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}RESULTADO: navegador, red y ONU funcionan correctamente.${NC}"
  echo "Abre el panel, entra a Equipos → Abrir y selecciona Navegador."
  exit 0
fi

echo -e "${RED}RESULTADO: se detectaron $FAIL fallo(s). Copia toda esta salida para identificar el punto exacto.${NC}"
exit 1