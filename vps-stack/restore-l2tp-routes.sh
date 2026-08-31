#!/usr/bin/env bash
# OmniSync - Restore L2TP routes on the VPS host
set -uo pipefail

# Apply routes from the persistent peer -> networks map.
ROUTES_FILE="/opt/omnisync-l2tp/omnisync-routes"

# La imagen bloquea L2TP sin IPsec por defecto. Reaplicar esto aquí hace que
# la corrección sobreviva reinicios/recreaciones y no dependa de una sola
# ejecución del instalador.
iptables -D INPUT -p udp --dport 1701 -m policy --dir in --pol none -j DROP 2>/dev/null || true
iptables -C INPUT -p udp --dport 1701 -j ACCEPT 2>/dev/null || \
  iptables -I INPUT -p udp --dport 1701 -j ACCEPT 2>/dev/null || true

sysctl -w net.ipv4.conf.all.rp_filter=0 >/dev/null 2>&1 || true
sysctl -w net.ipv4.conf.default.rp_filter=0 >/dev/null 2>&1 || true
for f in /proc/sys/net/ipv4/conf/ppp*/rp_filter; do
    [ -e "$f" ] && printf '0' > "$f" 2>/dev/null || true
done
if [ -f "$ROUTES_FILE" ]; then
    while read -r peer_ip nets; do
        [ -n "$peer_ip" ] || continue
        PPP_IF=$(ip -o -4 addr show 2>/dev/null | awk -v peer="$peer_ip" '$0 ~ /peer / && $0 ~ ("peer " peer "[/ ]") {print $2; exit}')
        [ -n "$PPP_IF" ] || continue
        for net in $(echo "$nets" | tr ',' ' '); do
            echo "Applying route $net dev $PPP_IF (peer $peer_ip)"
            ip route replace "$net" dev "$PPP_IF" 2>/dev/null || true
        done
    done < "$ROUTES_FILE"
fi

# 4. Ensure forwarding and NAT toward every remote network. Docker usa redes
# 172.x por defecto; se detectan también las subredes reales del stack para que
# GenieACS pueda abrir el Connection Request hacia la ONU por el túnel.
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
DOCKER_NETS=$(docker network inspect $(docker network ls -q) \
  --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | sort -u || true)
[ -n "$DOCKER_NETS" ] || DOCKER_NETS="172.16.0.0/12"
if [ -f "$ROUTES_FILE" ]; then
    while read -r peer_ip nets; do
        [ -n "$peer_ip" ] || continue
        PPP_IF=$(ip -o -4 addr show 2>/dev/null | awk -v peer="$peer_ip" '$0 ~ /peer / && $0 ~ ("peer " peer "[/ ]") {print $2; exit}')
        [ -n "$PPP_IF" ] || continue
        for net in $(echo "$nets" | tr ',' ' '); do
            for docker_net in $DOCKER_NETS; do
                iptables -C FORWARD -s "$docker_net" -d "$net" -j ACCEPT 2>/dev/null || \
                  iptables -I FORWARD -s "$docker_net" -d "$net" -j ACCEPT 2>/dev/null || true
                iptables -C FORWARD -d "$docker_net" -s "$net" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
                  iptables -I FORWARD -d "$docker_net" -s "$net" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
                iptables -t nat -C POSTROUTING -s "$docker_net" -d "$net" -j MASQUERADE 2>/dev/null || \
                  iptables -t nat -A POSTROUTING -s "$docker_net" -d "$net" -j MASQUERADE 2>/dev/null || true
            done
        done
    done < "$ROUTES_FILE"
fi
