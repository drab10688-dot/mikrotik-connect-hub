#!/usr/bin/env bash
set -Eeuo pipefail

# ─── Ubiquiti UISP (ex-UNMS) installer wrapper for OmniSync VPS ───
# Usa el instalador oficial de Ubiquiti, pero con puertos alternativos
# para convivir con el stack principal de OmniSync (80/443/8080/3000).

UISP_HTTP_PORT="${UISP_HTTP_PORT:-9080}"
UISP_HTTPS_PORT="${UISP_HTTPS_PORT:-9443}"
UISP_WS_PORT="${UISP_WS_PORT:-9444}"
UISP_INSTALL_DIR="/home/unms"
UISP_LOG="/var/log/omnisync-uisp-install.log"
ACTION="${1:-install}"

info()  { echo "→ $*"; }
ok()    { echo "✓ $*"; }
warn()  { echo "⚠ $*"; }
fail()  { echo "✗ $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Uso:
  bash /opt/omnisync/install-uisp.sh [install|reinstall|uninstall|status|logs]

Variables opcionales:
  UISP_HTTP_PORT=9080
  UISP_HTTPS_PORT=9443
  UISP_WS_PORT=9444

Requisitos:
  - Docker + plugin docker compose
  - 2 GB de RAM libre (o swap) adicionales
  - Puertos 9080 / 9443 / 9444 libres
EOF
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || fail "Ejecuta este script como root (sudo)."
}

require_commands() {
  for cmd in curl docker; do
    command -v "$cmd" >/dev/null 2>&1 || fail "Falta el comando requerido: $cmd"
  done
  if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
    info "Instalando plugin docker compose..."
    (apt-get update -qq && apt-get install -y -qq docker-compose-plugin) \
      || fail "No se pudo instalar docker compose. Instálalo manualmente."
  fi
  # El instalador oficial invoca 'docker-compose' (v1) en algunas versiones.
  if ! command -v docker-compose >/dev/null 2>&1; then
    info "Creando alias docker-compose -> docker compose"
    cat >/usr/local/bin/docker-compose <<'SH'
#!/usr/bin/env bash
exec docker compose "$@"
SH
    chmod +x /usr/local/bin/docker-compose
  fi
}

check_resources() {
  local mem_free swap_total
  mem_free=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  swap_total=$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)
  info "RAM disponible: ${mem_free} MB | Swap: ${swap_total} MB"
  if (( mem_free + swap_total < 2000 )); then
    warn "Menos de 2 GB disponibles. UISP puede fallar al iniciar."
    if (( swap_total < 1024 )); then
      info "Creando swap de 2 GB en /swapfile-uisp..."
      if [[ ! -f /swapfile-uisp ]]; then
        fallocate -l 2G /swapfile-uisp 2>/dev/null || dd if=/dev/zero of=/swapfile-uisp bs=1M count=2048 status=none
        chmod 600 /swapfile-uisp
        mkswap /swapfile-uisp >/dev/null
      fi
      swapon /swapfile-uisp 2>/dev/null || true
      grep -q '/swapfile-uisp' /etc/fstab || echo '/swapfile-uisp none swap sw 0 0' >>/etc/fstab
      ok "Swap activo"
    fi
  fi
}

port_owner() {
  ss -lntupH 2>/dev/null | awk -v p=":$1\$" '$5 ~ p {print $0}'
}

free_port() {
  local port="$1" label="$2" owner
  owner="$(port_owner "$port")"
  [[ -z "$owner" ]] && return 0

  warn "Puerto ${port} (${label}) ocupado:"
  echo "    ${owner}"

  # Si lo ocupa un contenedor que no es de UISP, abortamos con detalle.
  local cid
  cid="$(docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' 2>/dev/null | awk -v p=":${port}->" '$0 ~ p {print $1" "$2}' | head -1)"
  if [[ -n "$cid" ]]; then
    if [[ "$cid" == *uisp* || "$cid" == *unms* ]]; then
      info "Liberando contenedor UISP previo: $cid"
      docker rm -f "${cid%% *}" >/dev/null 2>&1 || true
      return 0
    fi
    fail "El puerto ${port} lo usa el contenedor '${cid#* }'. Cambia UISP_${label}_PORT o libera ese puerto."
  fi
  fail "El puerto ${port} está ocupado por un proceso del host. Libéralo antes de instalar."
}

show_status() {
  if [[ -d "$UISP_INSTALL_DIR" ]]; then
    info "Directorio UISP: $UISP_INSTALL_DIR"
    docker ps -a --filter "name=uisp" --filter "name=unms" \
      --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true
  else
    warn "No hay instalación UISP en ${UISP_INSTALL_DIR}"
  fi
  echo ""
  ss -lntupH 2>/dev/null | grep -E ":(${UISP_HTTP_PORT}|${UISP_HTTPS_PORT}|${UISP_WS_PORT})" || echo "(puertos UISP libres)"
}

run_install() {
  check_resources
  free_port "$UISP_HTTP_PORT" "HTTP"
  free_port "$UISP_HTTPS_PORT" "HTTPS"
  free_port "$UISP_WS_PORT" "WS"

  info "Descargando instalador oficial de UISP..."
  local tmp="/tmp/uisp-install.sh"
  curl -fsSL --retry 3 --retry-delay 3 -o "$tmp" https://uisp.ui.com/v1/master \
    || fail "No se pudo descargar el instalador (revisa la salida a internet / DNS)."
  [[ -s "$tmp" ]] || fail "El instalador descargado está vacío."

  info "Instalando UISP (HTTP=${UISP_HTTP_PORT} HTTPS=${UISP_HTTPS_PORT} WS=${UISP_WS_PORT})"
  info "Log completo: ${UISP_LOG}"

  set +e
  bash "$tmp" \
    --http-port "$UISP_HTTP_PORT" \
    --https-port "$UISP_HTTPS_PORT" \
    --ws-port "$UISP_WS_PORT" \
    --unattended 2>&1 | tee "$UISP_LOG"
  local rc=${PIPESTATUS[0]}
  set -e

  if [[ $rc -ne 0 ]]; then
    warn "El instalador con --unattended falló (código ${rc}). Reintentando sin ese flag..."
    set +e
    yes '' | bash "$tmp" \
      --http-port "$UISP_HTTP_PORT" \
      --https-port "$UISP_HTTPS_PORT" \
      --ws-port "$UISP_WS_PORT" 2>&1 | tee -a "$UISP_LOG"
    rc=${PIPESTATUS[1]}
    set -e
  fi

  if [[ $rc -ne 0 ]]; then
    echo ""
    warn "Últimas líneas del log:"
    tail -n 30 "$UISP_LOG" || true
    fail "La instalación de UISP falló. Revisa ${UISP_LOG}"
  fi

  info "Esperando a que los contenedores arranquen (hasta 3 min)..."
  local i
  for i in $(seq 1 36); do
    if curl -sk -o /dev/null -w '%{http_code}' "https://127.0.0.1:${UISP_HTTPS_PORT}/" | grep -qE '2|3'; then
      break
    fi
    sleep 5
  done

  ok "UISP instalado"
  local ip
  ip="$(hostname -I | awk '{print $1}')"
  echo ""
  echo "  URL HTTPS: https://${ip}:${UISP_HTTPS_PORT}"
  echo "  URL HTTP:  http://${ip}:${UISP_HTTP_PORT}"
  echo "  Crea tu cuenta de administrador en el primer acceso."
  echo ""
  show_status
}

run_uninstall() {
  info "Desinstalando UISP..."
  if command -v uisp-cli >/dev/null 2>&1; then
    uisp-cli uninstall --yes 2>/dev/null || true
  elif [[ -f "$UISP_INSTALL_DIR/app/uninstall.sh" ]]; then
    bash "$UISP_INSTALL_DIR/app/uninstall.sh" --yes 2>/dev/null || true
  fi
  docker ps -a --filter "name=uisp" -q | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker ps -a --filter "name=unms" -q | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker network rm uisp_default unms_default >/dev/null 2>&1 || true
  rm -rf "$UISP_INSTALL_DIR"
  ok "UISP eliminado"
}

case "$ACTION" in
  install)
    require_root; require_commands
    if [[ -d "$UISP_INSTALL_DIR/app" ]]; then
      warn "UISP ya está instalado en ${UISP_INSTALL_DIR}. Usa 'reinstall' o 'uninstall'."
      show_status
      exit 0
    fi
    run_install
    ;;
  reinstall)
    require_root; require_commands
    run_uninstall
    run_install
    ;;
  uninstall)
    require_root; require_commands
    run_uninstall
    ;;
  status) show_status ;;
  logs)   tail -n 100 "$UISP_LOG" 2>/dev/null || warn "No hay log en ${UISP_LOG}" ;;
  -h|--help|help) usage ;;
  *) usage; fail "Acción no válida: ${ACTION}" ;;
esac
