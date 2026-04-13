#!/usr/bin/env bash
set -Eeuo pipefail

CMS_VERSION="${CMS_VERSION:-4.0.3}"
CMS_DIR="${CMS_DIR:-/opt/cms-cdata}"
CMS_HTTP_PORT="${CMS_HTTP_PORT:-18080}"
CMS_HTTPS_PORT="${CMS_HTTPS_PORT:-18443}"
CMS_MQTTS_PORT="${CMS_MQTTS_PORT:-8883}"
CMS_MYSQL_PORT="${CMS_MYSQL_PORT:-3307}"
CMS_REDIS_PORT="${CMS_REDIS_PORT:-6380}"
CMS_EMQX_PORT="${CMS_EMQX_PORT:-1883}"
CMS_RMQ_NAMESRV_PORT="${CMS_RMQ_NAMESRV_PORT:-9876}"
CMS_ACS_PORT="${CMS_ACS_PORT:-9909}"
CMS_STUN_PORT="${CMS_STUN_PORT:-3478}"
CMS_FTP_PORT="${CMS_FTP_PORT:-21}"
CMS_BOOT_PORT="${CMS_BOOT_PORT:-9999}"
CMS_TENANT_TYPE_DEFAULT="${CMS_TENANT_TYPE_DEFAULT:-isp}"
CMS_HOST_DEFAULT="${CMS_HOST_DEFAULT:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
CMS_SKIP_TENANT_PROMPT="${CMS_SKIP_TENANT_PROMPT:-0}"
CMS_INSTALL_TIMEOUT="${CMS_INSTALL_TIMEOUT:-1200}"
ACTION="${1:-install}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

info() {
  echo "→ $*"
}

ok() {
  echo "✓ $*"
}

warn() {
  echo "⚠ $*"
}

fail() {
  echo "✗ $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Uso:
  bash /opt/omnisync/install-cms.sh [install|reinstall|uninstall|status]

Variables opcionales:
  CMS_TENANT_TYPE_DEFAULT=isp|multi
  CMS_HOST_DEFAULT=IP_O_HOST
  CMS_SKIP_TENANT_PROMPT=1
  CMS_VERSION=4.0.3
EOF
}

require_commands() {
  local cmd
  for cmd in curl tar docker awk sed grep ss; do
    command -v "$cmd" >/dev/null 2>&1 || fail "Falta el comando requerido: $cmd"
  done

  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin no está disponible"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local file="$3"

  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

port_in_use() {
  local port="$1"
  ss -lntupH 2>/dev/null | awk '{print $5}' | grep -Eq "(^|:)${port}$"
}

assert_port_free() {
  local port="$1"
  local label="$2"

  if port_in_use "$port"; then
    fail "El puerto ${port} (${label}) ya está en uso"
  fi
}

prompt_defaults() {
  local answer=""

  TENANT_TYPE="$CMS_TENANT_TYPE_DEFAULT"
  TENANT_HOST="$CMS_HOST_DEFAULT"

  if [[ "$TENANT_TYPE" != "isp" && "$TENANT_TYPE" != "multi" ]]; then
    fail "CMS_TENANT_TYPE_DEFAULT debe ser 'isp' o 'multi'"
  fi

  if [[ "$CMS_SKIP_TENANT_PROMPT" = "1" ]]; then
    [[ -n "$TENANT_HOST" ]] || fail "No pude detectar la IP del VPS. Usa CMS_HOST_DEFAULT=TU_IP"
    return 0
  fi

  if [[ -t 0 ]]; then
    read -r -p "Tipo de tenant CMS [isp/multi] (${TENANT_TYPE}): " answer || true
    answer="${answer:-$TENANT_TYPE}"
    if [[ "$answer" != "isp" && "$answer" != "multi" ]]; then
      fail "Tipo de tenant inválido: $answer"
    fi
    TENANT_TYPE="$answer"

    read -r -p "Host o IP pública del CMS (${TENANT_HOST}): " answer || true
    TENANT_HOST="${answer:-$TENANT_HOST}"
  fi

  [[ -n "$TENANT_HOST" ]] || fail "No pude detectar la IP del VPS. Usa CMS_HOST_DEFAULT=TU_IP"
}

download_vendor_package() {
  info "Descargando CMS C-Data ${CMS_VERSION}..."
  curl -fsSL -o "$TMP_DIR/cms.tar" "https://cms.s.cdatayun.com/cms_linux/stable/cms_v${CMS_VERSION}_linux.tar"
  mkdir -p "$TMP_DIR/pkg"
  tar -xf "$TMP_DIR/cms.tar" -C "$TMP_DIR/pkg"
}

prepare_install_dir() {
  rm -rf "$CMS_DIR"
  mkdir -p "$CMS_DIR"
  cp -a "$TMP_DIR/pkg/." "$CMS_DIR/"
}

patch_vendor_files() {
  local env_file="$CMS_DIR/.env"
  local init_file="$CMS_DIR/cms_init.sh"

  [[ -f "$env_file" ]] || fail "No se encontró $env_file"
  [[ -f "$init_file" ]] || fail "No se encontró $init_file"

  set_env_value MYSQL_PORT "$CMS_MYSQL_PORT" "$env_file"
  set_env_value REDIS_PORT "$CMS_REDIS_PORT" "$env_file"
  set_env_value EMQX_PORT "$CMS_EMQX_PORT" "$env_file"
  set_env_value ROCKET_MQ_NAMESRV_PORT "$CMS_RMQ_NAMESRV_PORT" "$env_file"
  set_env_value CMS_ACS_PORT "$CMS_ACS_PORT" "$env_file"
  set_env_value CMS_STUN_PORT "$CMS_STUN_PORT" "$env_file"
  set_env_value CMS_FTP_PORT "$CMS_FTP_PORT" "$env_file"
  set_env_value CMS_BOOT_PORT "$CMS_BOOT_PORT" "$env_file"
  set_env_value NGINX_PORT "$CMS_HTTP_PORT" "$env_file"
  set_env_value NGINX_PORT_HTTPS "$CMS_HTTPS_PORT" "$env_file"
  set_env_value NGINX_PORT_MQTTS "$CMS_MQTTS_PORT" "$env_file"
  set_env_value VOLUME_PATH ./ "$env_file"

  sed -i 's/docker exec -it /docker exec -i /g' "$init_file"
  chmod +x "$CMS_DIR/cms_init.sh" "$CMS_DIR/cms.sh"
  chmod +x "$CMS_DIR"/script/*.sh
}

wait_for_http() {
  local url="http://127.0.0.1:${CMS_HTTP_PORT}/health/hello"
  local attempts=$(( CMS_INSTALL_TIMEOUT / 5 ))
  local i

  if (( attempts < 1 )); then
    attempts=1
  fi

  for i in $(seq 1 "$attempts"); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      ok "CMS respondió en ${url}"
      return 0
    fi
    sleep 5
  done

  warn "El CMS quedó instalado pero aún no responde por HTTP"
  warn "Revisa: cd ${CMS_DIR} && docker compose logs --tail 80"
  return 1
}

show_status() {
  if [[ -f "$CMS_DIR/docker-compose.yml" ]]; then
    (cd "$CMS_DIR" && docker compose ps) || true
  else
    warn "No hay instalación CMS en ${CMS_DIR}"
  fi

  echo ""
  ss -lntupH 2>/dev/null | grep -E ":(${CMS_HTTP_PORT}|${CMS_HTTPS_PORT}|${CMS_MYSQL_PORT}|${CMS_REDIS_PORT}|${CMS_EMQX_PORT}|${CMS_RMQ_NAMESRV_PORT}|${CMS_ACS_PORT}|${CMS_BOOT_PORT})$" || true
}

uninstall_cms() {
  info "Desinstalando CMS C-Data..."

  if [[ -f "$CMS_DIR/docker-compose.yml" ]]; then
    (cd "$CMS_DIR" && docker compose down -v --remove-orphans) || true
  fi

  docker rm -f cms-nginx cms-boot cms-acs cms-ftp cms-stun cms-rmqbroker cms-rmqnamesrv cms-emqx cms-redis cms-mysql >/dev/null 2>&1 || true
  docker network rm cms-network >/dev/null 2>&1 || true
  rm -rf "$CMS_DIR"

  ok "CMS C-Data eliminado"
}

run_install() {
  local answers

  prompt_defaults

  if [[ "$CMS_HTTP_PORT" != "18080" ]]; then
    warn "OmniSync integra /cms-cdata/ por el puerto 18080; si cambiaste CMS_HTTP_PORT, ajusta también el proxy de Nginx"
  fi

  assert_port_free "$CMS_MYSQL_PORT" "MySQL CMS"
  assert_port_free "$CMS_REDIS_PORT" "Redis CMS"
  assert_port_free "$CMS_EMQX_PORT" "EMQX CMS"
  assert_port_free "$CMS_RMQ_NAMESRV_PORT" "RocketMQ NameServer CMS"
  assert_port_free "$CMS_ACS_PORT" "ACS CMS"
  assert_port_free "$CMS_STUN_PORT" "STUN CMS"
  assert_port_free "$CMS_BOOT_PORT" "Boot CMS"
  assert_port_free "$CMS_HTTP_PORT" "HTTP CMS"
  assert_port_free "$CMS_HTTPS_PORT" "HTTPS CMS"
  assert_port_free "$CMS_MQTTS_PORT" "MQTTS CMS"

  download_vendor_package
  prepare_install_dir
  patch_vendor_files

  info "Instalando CMS en ${CMS_DIR}..."
  answers=$(printf 'n\nn\nn\nn\nn\nn\nn\nn\n%s\n%s\n' "$TENANT_TYPE" "$TENANT_HOST")
  (
    cd "$CMS_DIR"
    printf '%s' "$answers" | bash ./cms_init.sh install --version "$CMS_VERSION"
  )

  ok "CMS instalado"
  echo "  URL HTTP:  http://${TENANT_HOST}:${CMS_HTTP_PORT}"
  echo "  URL HTTPS: https://${TENANT_HOST}:${CMS_HTTPS_PORT}"
  echo "  Usuario: root"
  echo "  Clave:   adminisp"

  wait_for_http || true
}

case "$ACTION" in
  install)
    require_commands
    if [[ -f "$CMS_DIR/docker-compose.yml" ]]; then
      warn "Ya existe una instalación CMS en ${CMS_DIR}; se reinstalará limpia"
      uninstall_cms
    fi
    run_install
    ;;
  reinstall)
    require_commands
    uninstall_cms
    run_install
    ;;
  uninstall)
    require_commands
    uninstall_cms
    ;;
  status)
    require_commands
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
