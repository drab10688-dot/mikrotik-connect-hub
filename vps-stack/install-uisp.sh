#!/usr/bin/env bash
set -Eeuo pipefail

# ─── Ubiquiti UISP (ex-UNMS) installer wrapper for OmniSync VPS ───
# UISP se instala usando el instalador oficial de Ubiquiti.
# Este wrapper configura puertos alternativos para convivir con el stack principal.

UISP_HTTP_PORT="${UISP_HTTP_PORT:-9080}"
UISP_HTTPS_PORT="${UISP_HTTPS_PORT:-9443}"
UISP_WS_PORT="${UISP_WS_PORT:-9444}"
UISP_INSTALL_DIR="/home/unms"
ACTION="${1:-install}"

info()  { echo "→ $*"; }
ok()    { echo "✓ $*"; }
warn()  { echo "⚠ $*"; }
fail()  { echo "✗ $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Uso:
  bash /opt/omnisync/install-uisp.sh [install|uninstall|status]

Variables opcionales:
  UISP_HTTP_PORT=9080
  UISP_HTTPS_PORT=9443

Requisitos:
  - Docker y Docker Compose instalados
  - Al menos 2 GB de RAM disponible
  - Puertos 9080 y 9443 libres
EOF
}

require_commands() {
  for cmd in curl docker; do
    command -v "$cmd" >/dev/null 2>&1 || fail "Falta el comando requerido: $cmd"
  done
}

port_in_use() {
  ss -lntupH 2>/dev/null | awk '{print $5}' | grep -Eq "(^|:)${1}$"
}

assert_port_free() {
  if port_in_use "$1"; then
    fail "El puerto ${1} (${2}) ya está en uso"
  fi
}

show_status() {
  if [[ -d "$UISP_INSTALL_DIR" ]]; then
    info "Directorio UISP: $UISP_INSTALL_DIR"
    if command -v uisp-cli &>/dev/null; then
      uisp-cli status 2>/dev/null || true
    else
      docker ps --filter "name=uisp" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true
    fi
  else
    warn "No hay instalación UISP en ${UISP_INSTALL_DIR}"
  fi

  echo ""
  ss -lntupH 2>/dev/null | grep -E ":(${UISP_HTTP_PORT}|${UISP_HTTPS_PORT})" || true
}

run_install() {
  assert_port_free "$UISP_HTTP_PORT" "HTTP UISP"
  assert_port_free "$UISP_HTTPS_PORT" "HTTPS UISP"

  info "Descargando e instalando UISP (Ubiquiti)..."
  info "Puertos: HTTP=${UISP_HTTP_PORT}, HTTPS=${UISP_HTTPS_PORT}"

  curl -fsSL https://uisp.ui.com/v1/master | \
    bash -s -- \
      --http-port "$UISP_HTTP_PORT" \
      --https-port "$UISP_HTTPS_PORT" \
      --ws-port "$UISP_WS_PORT" \
      --unattended

  ok "UISP instalado correctamente"
  echo ""
  echo "  URL HTTPS: https://$(hostname -I | awk '{print $1}'):${UISP_HTTPS_PORT}"
  echo "  URL HTTP:  http://$(hostname -I | awk '{print $1}'):${UISP_HTTP_PORT}"
  echo ""
  echo "  Crea tu cuenta de administrador en el primer acceso."
}

run_uninstall() {
  info "Desinstalando UISP..."

  if [[ -f /usr/bin/uisp-cli ]]; then
    uisp-cli uninstall --yes 2>/dev/null || true
  elif [[ -f "$UISP_INSTALL_DIR/app/uninstall.sh" ]]; then
    bash "$UISP_INSTALL_DIR/app/uninstall.sh" --yes 2>/dev/null || true
  else
    docker ps -a --filter "name=uisp" -q | xargs -r docker rm -f 2>/dev/null || true
    docker network rm uisp_default 2>/dev/null || true
  fi

  rm -rf "$UISP_INSTALL_DIR"
  ok "UISP eliminado"
}

case "$ACTION" in
  install)
    require_commands
    if [[ -d "$UISP_INSTALL_DIR/app" ]]; then
      warn "UISP ya está instalado en ${UISP_INSTALL_DIR}"
      warn "Usa 'reinstall' o 'uninstall' primero"
      show_status
      exit 0
    fi
    run_install
    ;;
  reinstall)
    require_commands
    run_uninstall
    run_install
    ;;
  uninstall)
    require_commands
    run_uninstall
    ;;
  status)
    show_status
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    fail "Acción no válida: ${ACTION}"
    ;;
esac
