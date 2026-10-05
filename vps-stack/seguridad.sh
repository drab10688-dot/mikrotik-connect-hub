#!/usr/bin/env bash
# ============================================================================
#  OmniSync — Endurecimiento del servidor (lo llama install.sh; también manual)
#
#  Uso:
#    sudo bash /opt/omnisync/seguridad.sh            # todo lo de abajo
#    sudo bash /opt/omnisync/seguridad.sh firewall   # cierra puertos internos desde internet
#    sudo bash /opt/omnisync/seguridad.sh fail2ban   # bloquea IPs que fallan la clave SSH
#    sudo bash /opt/omnisync/seguridad.sh respaldos  # copia diaria 02:30 en /var/backups/omnisync
#
#  Variables opcionales:
#    ADMIN_IPS="1.2.3.4 5.6.7.0/24"  IPs que fail2ban nunca bloquea (además de la VPN)
#    SIN_FAIL2BAN=1                  omite fail2ban en el modo "todo"
#    FORZAR_FIREWALL=1               reemplaza un firewall-interno.sh ya instalado
# ============================================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
INSTALL_DIR="${INSTALL_DIR:-/opt/omnisync}"
VPN_NET="${L2TP_TUNNEL_NET:-192.168.42.0/24}"

[ "$(id -u)" -eq 0 ] || { echo -e "${RED}Ejecuta como root (sudo).${NC}"; exit 1; }

instalar_firewall() {
  local dst=/usr/local/sbin/firewall-interno.sh
  if [ -f "$dst" ] && [ "${FORZAR_FIREWALL:-0}" != "1" ]; then
    # Respeta la configuración propia del servidor (p. ej. 7547 solo por VPN).
    echo -e "${YELLOW}• Firewall interno ya instalado: se conserva ($dst). FORZAR_FIREWALL=1 para reemplazarlo.${NC}"
  else
    install -m 755 "$INSTALL_DIR/security/firewall-interno.sh" "$dst"
    install -m 644 "$INSTALL_DIR/security/firewall-interno.service" /etc/systemd/system/firewall-interno.service
  fi
  systemctl daemon-reload
  systemctl enable firewall-interno.service >/dev/null 2>&1
  systemctl restart firewall-interno.service
  echo -e "${GREEN}✓ Firewall interno activo (puertos internos cerrados desde internet)${NC}"
}

instalar_fail2ban() {
  if ! command -v fail2ban-client >/dev/null 2>&1; then
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban >/dev/null
  fi
  mkdir -p /etc/fail2ban/jail.d
  # Solo cuenta contraseñas fallidas: quien entra con llave SSH nunca suma
  # intentos. La VPN y ADMIN_IPS jamás se bloquean. Reincidentes: el
  # bloqueo crece (1 h, 2 h, 4 h… hasta 1 semana).
  cat > /etc/fail2ban/jail.d/omnisync-sshd.local <<EOF
# Generado por OmniSync seguridad.sh
[sshd]
enabled = true
backend = systemd
journalmatch = _SYSTEMD_UNIT=ssh.service + _SYSTEMD_UNIT=sshd.service + _COMM=sshd + _COMM=sshd-session
maxretry = 5
findtime = 10m
bantime = 1h
bantime.increment = true
bantime.maxtime = 1w
ignoreip = 127.0.0.1/8 ::1 ${VPN_NET} ${ADMIN_IPS:-}
EOF
  systemctl enable fail2ban >/dev/null 2>&1
  systemctl restart fail2ban
  sleep 2
  if fail2ban-client status sshd >/dev/null 2>&1; then
    echo -e "${GREEN}✓ fail2ban activo para SSH (5 fallos en 10 min → bloqueo 1 h)${NC}"
    echo    "  Ver bloqueados:  fail2ban-client status sshd"
    echo    "  Desbloquear IP:  fail2ban-client set sshd unbanip <IP>"
  else
    echo -e "${RED}✗ fail2ban no arrancó: journalctl -u fail2ban -n 30${NC}"
    return 1
  fi
}

instalar_respaldos() {
  chmod 700 "$INSTALL_DIR/backup-omnisync.sh"
  cat > /etc/cron.d/omnisync-backup <<EOF
# OmniSync: respaldo diario (PostgreSQL + GenieACS + configuración), 14 días
30 2 * * * root bash $INSTALL_DIR/backup-omnisync.sh >> /var/log/omnisync-backup.log 2>&1
EOF
  chmod 644 /etc/cron.d/omnisync-backup
  cat > /etc/logrotate.d/omnisync-backup <<'EOF'
/var/log/omnisync-backup.log {
  monthly
  rotate 6
  compress
  missingok
  notifempty
}
EOF
  echo -e "${GREEN}✓ Respaldo diario 02:30 en /var/backups/omnisync (14 días)${NC}"
}

case "${1:-todo}" in
  firewall)  instalar_firewall ;;
  fail2ban)  instalar_fail2ban ;;
  respaldos) instalar_respaldos ;;
  todo)
    instalar_firewall
    if [ "${SIN_FAIL2BAN:-0}" != "1" ]; then instalar_fail2ban || true; fi
    instalar_respaldos
    ;;
  *) echo "Uso: $0 [todo|firewall|fail2ban|respaldos]"; exit 1 ;;
esac
