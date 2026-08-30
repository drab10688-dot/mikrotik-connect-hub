#!/bin/bash
# ============================================================
# Aisla el escritorio remoto (Chromium/Winbox) del internet.
# Sólo puede alcanzar redes privadas (VPN L2TP/WireGuard, LANs
# de clientes, ONUs y MikroTik). Todo lo demás se descarta.
# Idempotente: se puede ejecutar en cada actualización.
# ============================================================
set -e

BROWSER_SUBNET="${BROWSER_SUBNET:-172.31.42.0/24}"
PRIVATE_NETS="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16"
TAG="omnisync-browser-isolation"

if ! command -v iptables >/dev/null 2>&1; then
  echo "iptables no disponible; se omite el aislamiento del navegador"
  exit 0
fi

clean_chain() {
  local CHAIN="$1" LINE GUARD=0
  # Borra por número de línea (más fiable que reconstruir la regla).
  while :; do
    LINE=$(iptables -L "$CHAIN" --line-numbers -n 2>/dev/null | grep -- "$TAG" | head -1 | awk '{print $1}')
    [ -n "$LINE" ] || break
    iptables -D "$CHAIN" "$LINE" 2>/dev/null || break
    GUARD=$((GUARD + 1))
    [ "$GUARD" -gt 500 ] && break
  done
}

apply_chain() {
  local CHAIN="$1"
  iptables -N "$CHAIN" 2>/dev/null || true
  clean_chain "$CHAIN"
  add() { iptables -I "$CHAIN" 1 -m comment --comment "$TAG" "$@"; }

  # Se insertan al principio en orden inverso al de evaluación:
  # 1) DROP por defecto (queda al final)
  add -s "$BROWSER_SUBNET" -j DROP
  # 2) Permite redes privadas (VPN, LANs, ONUs, MikroTik)
  for NET in $PRIVATE_NETS; do
    add -s "$BROWSER_SUBNET" -d "$NET" -j RETURN
  done
  # 3) Bloquea DNS hacia internet (evita fugas/resolución pública)
  add -s "$BROWSER_SUBNET" -p udp --dport 53 ! -d 172.31.42.0/24 -j DROP 2>/dev/null || true
  # 4) Permite respuestas de conexiones ya establecidas
  add -s "$BROWSER_SUBNET" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  unset -f add
}

# --flush: sólo limpia las reglas y sale (útil para diagnóstico)
if [ "${1:-}" = "--flush" ]; then
  clean_chain DOCKER-USER
  clean_chain FORWARD
  echo "✓ Reglas de aislamiento eliminadas"
  exit 0
fi

# DOCKER-USER cubre el tráfico reenviado por Docker; FORWARD como respaldo
# en hosts donde DOCKER-USER no se evalúa.
apply_chain DOCKER-USER
apply_chain FORWARD

echo "✓ Navegador remoto aislado: sólo redes privadas desde $BROWSER_SUBNET"
echo "  Reglas activas:"
iptables -S DOCKER-USER 2>/dev/null | grep -- "$TAG" | sed 's/^/    /' || true
