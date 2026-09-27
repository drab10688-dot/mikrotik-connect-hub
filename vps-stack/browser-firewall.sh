#!/bin/bash
# ============================================================
# Aisla los escritorios remotos (Chromium/KasmVNC) — multi-ISP.
#
# Por defecto un escritorio NO puede salir a ninguna parte (ni internet ni
# redes privadas). El API abre, por cada escritorio, SOLO las redes VPN del
# ISP de ese usuario (lib/browser-fw.ts) y las borra al cerrarlo. Así un ISP
# nunca alcanza las ONUs/MikroTik de otro, tampoco escribiendo la IP a mano.
#
# Las reglas van en la tabla mangle (cadena OMNISYNC-UB al inicio de FORWARD):
# la tabla filter recibe cientos de ACCEPT insertados al inicio por el hook
# L2TP, que se evaluaban antes que DOCKER-USER y anulaban el aislamiento.
#
# Idempotente: se puede ejecutar en cada actualización. Conserva las reglas
# por escritorio que ya haya creado el API.
# ============================================================
set -e

BROWSER_SUBNET="${BROWSER_SUBNET:-172.31.42.0/24}"
CHAIN="OMNISYNC-UB"
BASE_TAG="omnisync-ub-base"
OLD_TAG="omnisync-browser-isolation"

if ! command -v iptables >/dev/null 2>&1; then
  echo "iptables no disponible; se omite el aislamiento del navegador"
  exit 0
fi

# Borra reglas por comentario (por número de línea: más fiable).
clean_tag() {
  local TABLE="$1" CH="$2" TAG="$3" LINE GUARD=0
  while :; do
    LINE=$(iptables -t "$TABLE" -L "$CH" --line-numbers -n 2>/dev/null | grep -- "$TAG" | head -1 | awk '{print $1}')
    [ -n "$LINE" ] || break
    iptables -t "$TABLE" -D "$CH" "$LINE" 2>/dev/null || break
    GUARD=$((GUARD + 1))
    [ "$GUARD" -gt 500 ] && break
  done
}

# Esquema anterior (DOCKER-USER/FORWARD con todas las redes privadas abiertas).
clean_tag filter DOCKER-USER "$OLD_TAG"
clean_tag filter FORWARD "$OLD_TAG"

if [ "${1:-}" = "--flush" ]; then
  iptables -t mangle -D FORWARD -s "$BROWSER_SUBNET" -j "$CHAIN" 2>/dev/null || true
  iptables -t mangle -F "$CHAIN" 2>/dev/null || true
  iptables -t mangle -X "$CHAIN" 2>/dev/null || true
  echo "✓ Aislamiento de escritorios eliminado (diagnóstico)"
  exit 0
fi

iptables -t mangle -N "$CHAIN" 2>/dev/null || true
iptables -t mangle -C FORWARD -s "$BROWSER_SUBNET" -j "$CHAIN" 2>/dev/null || \
  iptables -t mangle -I FORWARD 1 -s "$BROWSER_SUBNET" -j "$CHAIN"

# Cola fija (al final): tráfico dentro de la propia subred (Nginx <-> escritorio)
# permitido; todo lo demás descartado. Las reglas por escritorio del API se
# insertan al inicio y quedan por encima.
clean_tag mangle "$CHAIN" "$BASE_TAG"
iptables -t mangle -A "$CHAIN" -d "$BROWSER_SUBNET" -m comment --comment "$BASE_TAG" -j RETURN
iptables -t mangle -A "$CHAIN" -m comment --comment "$BASE_TAG" -j DROP

echo "✓ Escritorios remotos aislados por ISP ($BROWSER_SUBNET)"
iptables -t mangle -S "$CHAIN" | sed 's/^/    /'
