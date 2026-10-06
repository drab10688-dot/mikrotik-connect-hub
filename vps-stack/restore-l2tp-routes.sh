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
        # Quita las redes que este túnel tiene pero su router NO declara
        # (scripts viejos o redes cambiadas): una /24 ajena por aquí le roba
        # el tráfico a otro router u otro ISP. Las /32 puntuales (APs,
        # antenas) y la ruta del peer no llevan "/" y se conservan.
        wanted=" $(echo "$nets" | tr ',' ' ') "
        for r in $(ip route show dev "$PPP_IF" 2>/dev/null | awk '$1 ~ /\// {print $1}'); do
            case "$wanted" in
                *" $r "*) ;;
                *) echo "Removing stray route $r dev $PPP_IF"; ip route del "$r" dev "$PPP_IF" 2>/dev/null || true ;;
            esac
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

# 5. Cada túnel responde por su propio túnel (redes repetidas entre routers).
# Varias MikroTik del mismo ISP pueden usar la misma red (pool RADIUS
# compartido), pero la ruta global solo apunta a UNA. Las conexiones que
# ENTRAN por un ppp (Inform TR-069 de la ONU, etc.) se marcan con el número
# del túnel (último octeto de su IP: 192.168.42.11 -> 0xb0000) y sus
# respuestas salen por la tabla 31000+N, que solo tiene "default dev pppX".
# Lo que inicia el VPS hacia las ONUs sigue la ruta global; el Connection
# Request se envía además por cada túnel desde la API (connectionRequestViaTunnels).
PBR=OMNISYNC-PBR
PBR_MASK=0xff0000
PBR_STATE=/run/omnisync-pbr.state
iptables -t mangle -N "$PBR" 2>/dev/null || true
iptables -t mangle -C PREROUTING -j "$PBR" 2>/dev/null || iptables -t mangle -I PREROUTING 1 -j "$PBR"
iptables -t mangle -C OUTPUT -m connmark ! --mark 0/$PBR_MASK -j CONNMARK --restore-mark --nfmask $PBR_MASK --ctmask $PBR_MASK 2>/dev/null || \
  iptables -t mangle -I OUTPUT 1 -m connmark ! --mark 0/$PBR_MASK -j CONNMARK --restore-mark --nfmask $PBR_MASK --ctmask $PBR_MASK
PBR_WANT=""
if [ -f "$ROUTES_FILE" ]; then
    while read -r peer_ip nets; do
        [ -n "$peer_ip" ] || continue
        N="${peer_ip##*.}"
        case "$N" in ''|*[!0-9]*) continue ;; esac
        [ "$N" -ge 1 ] && [ "$N" -le 254 ] || continue
        PPP_IF=$(ip -o -4 addr show 2>/dev/null | awk -v peer="$peer_ip" '$0 ~ /peer / && $0 ~ ("peer " peer "[/ ]") {print $2; exit}')
        [ -n "$PPP_IF" ] || continue
        MARK=$(printf '0x%x' $((N << 16)))
        TABLE=$((31000 + N))
        ip route replace default dev "$PPP_IF" table "$TABLE" 2>/dev/null || true
        if ! ip rule show pref "$TABLE" 2>/dev/null | grep -q "fwmark $MARK/$PBR_MASK lookup $TABLE"; then
            while ip rule del pref "$TABLE" 2>/dev/null; do :; done
            ip rule add pref "$TABLE" fwmark "$MARK/$PBR_MASK" lookup "$TABLE" 2>/dev/null || true
        fi
        PBR_WANT="$PBR_WANT $PPP_IF=$MARK"
    done < "$ROUTES_FILE"
fi
# La cadena solo se reconstruye cuando cambian los túneles (reconexiones).
if [ "$(cat "$PBR_STATE" 2>/dev/null)" != "$PBR_WANT" ] || ! iptables -t mangle -S "$PBR" 2>/dev/null | grep -q -- '--restore-mark'; then
    iptables -t mangle -F "$PBR"
    for pair in $PBR_WANT; do
        iptables -t mangle -A "$PBR" -i "${pair%%=*}" -m conntrack --ctstate NEW -j CONNMARK --set-xmark "${pair#*=}/$PBR_MASK"
    done
    iptables -t mangle -A "$PBR" ! -i ppp+ -m connmark ! --mark 0/$PBR_MASK -j CONNMARK --restore-mark --nfmask $PBR_MASK --ctmask $PBR_MASK
    printf '%s' "$PBR_WANT" > "$PBR_STATE"
fi
