#!/usr/bin/env bash
# Permite que el contenedor API llegue a las redes detrás del MikroTik.
set -u

# Todos los rangos privados por defecto (RFC1918): no requiere configuración.
ONU_NETS="${ONU_NETS:-10.0.0.0/8,172.16.0.0/12,192.168.0.0/16}"
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
  # 172.16.0.0/12 es el rango que usan las redes internas de Docker:
  # enmascarar hacia él rompería la comunicación entre contenedores.
  # Las ONUs en ese rango las cubre sync-onu-routes.sh con /24 exactas.
  [ "$net" = "172.16.0.0/12" ] && continue
  iptables -C FORWARD -s 172.16.0.0/12 -d "$net" -j ACCEPT 2>/dev/null || \
    iptables -I FORWARD -s 172.16.0.0/12 -d "$net" -j ACCEPT
  iptables -C FORWARD -d 172.16.0.0/12 -s "$net" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
    iptables -I FORWARD -d 172.16.0.0/12 -s "$net" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -t nat -C POSTROUTING -s 172.16.0.0/12 -d "$net" -j MASQUERADE 2>/dev/null || \
    iptables -t nat -A POSTROUTING -s 172.16.0.0/12 -d "$net" -j MASQUERADE
done

echo "Proxy API habilitado para acceder a: $ONU_NETS"