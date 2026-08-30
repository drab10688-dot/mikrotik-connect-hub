#!/usr/bin/env bash
# OmniSync - Restore L2TP routes on the VPS host
set -uo pipefail

# 1. Get tunnel interface
IFACE=$(ip -4 addr show | grep -o "ppp[0-9]*" | head -1 || true)
if [ -z "$IFACE" ]; then
    echo "No ppp interface found"
    exit 0
fi

# 2. Get peer IP
PEER_IP=$(ip -4 addr show "$IFACE" | grep -oP 'peer \K[\d.]+')
if [ -z "$PEER_IP" ]; then
    echo "No peer IP found for $IFACE"
    exit 0
fi

echo "Found L2TP tunnel $IFACE with peer $PEER_IP"

# 3. Apply routes from omnisync-routes map
ROUTES_FILE="/opt/omnisync-l2tp/omnisync-routes"
if [ -f "$ROUTES_FILE" ]; then
    while read -r ip nets; do
        if [ "$ip" = "$PEER_IP" ]; then
            for net in $(echo "$nets" | tr ',' ' '); do
                echo "Applying route $net via $PEER_IP"
                ip route replace "$net" via "$PEER_IP" 2>/dev/null || true
                # API/Firefox retain their Docker default gateway. The host
                # forwards that traffic through the active PPP interface.
            done
        fi
    done < "$ROUTES_FILE"
fi

# 4. Ensure forwarding and NAT toward every remote network
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
if [ -f "$ROUTES_FILE" ]; then
    while read -r ip nets; do
        [ "$ip" = "$PEER_IP" ] || continue
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
