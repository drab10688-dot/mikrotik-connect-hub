#!/usr/bin/env bash
# OmniSync - Restore L2TP routes on the VPS host
set -uo pipefail

# Apply routes from the persistent peer -> networks map.
ROUTES_FILE="/opt/omnisync-l2tp/omnisync-routes"
if [ -f "$ROUTES_FILE" ]; then
    while read -r peer_ip nets; do
        [ -n "$peer_ip" ] || continue
        ip route get "$peer_ip" 2>/dev/null | grep -qE 'dev ppp[0-9]+' || continue
        for net in $(echo "$nets" | tr ',' ' '); do
            echo "Applying route $net via $peer_ip"
            ip route replace "$net" via "$peer_ip" 2>/dev/null || true
        done
    done < "$ROUTES_FILE"
fi

# 4. Ensure forwarding and NAT toward every remote network
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
if [ -f "$ROUTES_FILE" ]; then
    while read -r peer_ip nets; do
        [ -n "$peer_ip" ] || continue
        ip route get "$peer_ip" 2>/dev/null | grep -qE 'dev ppp[0-9]+' || continue
        for net in $nets; do
            iptables -C FORWARD -s 172.16.0.0/12 -d "$net" -j ACCEPT 2>/dev/null || \
              iptables -I FORWARD -s 172.16.0.0/12 -d "$net" -j ACCEPT 2>/dev/null || true
            iptables -C FORWARD -d 172.16.0.0/12 -s "$net" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
              iptables -I FORWARD -d 172.16.0.0/12 -s "$net" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
            iptables -t nat -C POSTROUTING -s 172.16.0.0/12 -d "$net" -j MASQUERADE 2>/dev/null || \
              iptables -t nat -A POSTROUTING -s 172.16.0.0/12 -d "$net" -j MASQUERADE 2>/dev/null || true
        done
    done < "$ROUTES_FILE"
fi
