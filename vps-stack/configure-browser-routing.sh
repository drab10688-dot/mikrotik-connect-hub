#!/usr/bin/env bash
# Permite que los contenedores API/Firefox lleguen a las redes detrás del MikroTik.
set -u

ONU_NETS="${ONU_NETS:-10.82.0.0/21}"
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true

for net in $(echo "$ONU_NETS" | tr ',' ' '); do
  [ -n "$net" ] || continue
  iptables -C FORWARD -s 172.16.0.0/12 -d "$net" -j ACCEPT 2>/dev/null || \
    iptables -I FORWARD -s 172.16.0.0/12 -d "$net" -j ACCEPT
  iptables -C FORWARD -d 172.16.0.0/12 -s "$net" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
    iptables -I FORWARD -d 172.16.0.0/12 -s "$net" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -t nat -C POSTROUTING -s 172.16.0.0/12 -d "$net" -j MASQUERADE 2>/dev/null || \
    iptables -t nat -A POSTROUTING -s 172.16.0.0/12 -d "$net" -j MASQUERADE
done

echo "Firefox/API habilitados para acceder a: $ONU_NETS"