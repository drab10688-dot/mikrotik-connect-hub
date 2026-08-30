#!/bin/bash
# ============================================================
# Aisla el escritorio remoto (Chromium/Winbox) del internet.
# Sólo puede alcanzar redes privadas (VPN L2TP/WireGuard, LANs
# de clientes, ONUs y MikroTik). Todo lo demás se descarta.
# Idempotente: se puede ejecutar en cada actualización.
# ============================================================
set -e

BROWSER_SUBNET="${BROWSER_SUBNET:-172.31.42.0/24}"
CHAIN="DOCKER-USER"

if ! command -v iptables >/dev/null 2>&1; then
  echo "iptables no disponible; se omite el aislamiento del navegador"
  exit 0
fi

# Limpia reglas previas de este script (marcadas con el comentario)
while iptables -S "$CHAIN" 2>/dev/null | grep -q "omnisync-browser-isolation"; do
  RULE=$(iptables -S "$CHAIN" | grep -m1 "omnisync-browser-isolation" | sed 's/^-A //')
  # shellcheck disable=SC2086
  iptables -D $CHAIN $RULE || break
done

add() { iptables -I "$CHAIN" 1 -m comment --comment omnisync-browser-isolation "$@"; }

# Las reglas se insertan al principio en orden inverso al de evaluación:
# 1) DROP por defecto para el resto de destinos (se inserta primero)
add -s "$BROWSER_SUBNET" -j DROP
# 2) Permite redes privadas (VPN, LANs, equipos de clientes)
for NET in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16; do
  add -s "$BROWSER_SUBNET" -d "$NET" -j RETURN
done
# 3) Permite DNS y respuestas ya establecidas
add -s "$BROWSER_SUBNET" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN

echo "✓ Navegador remoto aislado: sólo redes privadas desde $BROWSER_SUBNET"
