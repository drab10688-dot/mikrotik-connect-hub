#!/usr/bin/env bash
# Permite que el contenedor API llegue a las redes detrás del MikroTik.
set -u

ONU_NETS="${ONU_NETS:-10.82.0.0/21}"
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
# El retorno de las ONUs entra por PPP y sale por un bridge Docker. El filtro
# inverso estricto interpreta esa ruta asimétrica como suplantación y la tira.
sysctl -w net.ipv4.conf.all.rp_filter=0 >/dev/null 2>&1 || true
sysctl -w net.ipv4.conf.default.rp_filter=0 >/dev/null 2>&1 || true
for f in /proc/sys/net/ipv4/conf/ppp*/rp_filter; do
  [ -e "$f" ] && printf '0' > "$f" 2>/dev/null || true
done
grep -q '^net.ipv4.conf.all.rp_filter=0' /etc/sysctl.conf 2>/dev/null || echo 'net.ipv4.conf.all.rp_filter=0' >> /etc/sysctl.conf
grep -q '^net.ipv4.conf.default.rp_filter=0' /etc/sysctl.conf 2>/dev/null || echo 'net.ipv4.conf.default.rp_filter=0' >> /etc/sysctl.conf

for net in $(echo "$ONU_NETS" | tr ',' ' '); do
  [ -n "$net" ] || continue
  iptables -C FORWARD -s 172.16.0.0/12 -d "$net" -j ACCEPT 2>/dev/null || \
    iptables -I FORWARD -s 172.16.0.0/12 -d "$net" -j ACCEPT
  iptables -C FORWARD -d 172.16.0.0/12 -s "$net" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
    iptables -I FORWARD -d 172.16.0.0/12 -s "$net" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -t nat -C POSTROUTING -s 172.16.0.0/12 -d "$net" -j MASQUERADE 2>/dev/null || \
    iptables -t nat -A POSTROUTING -s 172.16.0.0/12 -d "$net" -j MASQUERADE
done

echo "Proxy API habilitado para acceder a: $ONU_NETS"