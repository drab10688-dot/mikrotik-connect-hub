import { execFile } from 'child_process';

const CONTAINER = process.env.L2TP_CONTAINER || 'omnisync-l2tp';
const SECRETS = '/etc/ppp/chap-secrets';
const ROUTES_FILE = '/etc/ppp/omnisync-routes';

function sh(script: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'docker',
      ['exec', CONTAINER, 'sh', '-c', script],
      { timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) {
          console.warn(`[l2tp] ${err.message} ${stderr || ''}`);
          resolve('');
          return;
        }
        resolve(stdout);
      }
    );
  });
}

const esc = (v: string) => v.replace(/[^a-zA-Z0-9_.@-]/g, '');
const escNet = (v: string) => v.replace(/[^0-9a-fA-F:.,/ ]/g, '');

/**
 * Crea/actualiza la cuenta L2TP (chap-secrets) con IP fija de túnel.
 * Además registra las redes de ONUs del peer para que el hook ip-up
 * agregue las rutas en el VPS cada vez que conecta el túnel.
 */
export async function upsertL2tpUser(
  username: string,
  password: string,
  tunnelIp?: string,
  onuNetworks?: string
) {
  const u = esc(username);
  const p = esc(password);
  if (!u || !p) return;
  const ip = tunnelIp ? esc(tunnelIp) : '*';

  // Cuenta con IP fija -> el gateway de las rutas nunca cambia
  await sh(
    `touch ${SECRETS}; sed -i "/^\\"\\?${u}\\"\\?[[:space:]]/d" ${SECRETS}; ` +
      `printf '%s\\n' '"${u}" l2tpd "${p}" ${ip}' >> ${SECRETS}`
  );

  // Mapa tunnel_ip -> redes (lo lee el hook /etc/ppp/ip-up.local).
  // La ruta se instala directamente sobre la interfaz PPP. En enlaces punto
  // a punto esto es más fiable que declarar al peer como gateway.
  if (tunnelIp) {
    const nets = escNet(onuNetworks?.trim() || '10.82.0.0/21');
    await sh(
      `touch ${ROUTES_FILE}; sed -i "/^${esc(tunnelIp)}[[:space:]]/d" ${ROUTES_FILE}; ` +
        `printf '%s\\n' '${esc(tunnelIp)} ${nets}' >> ${ROUTES_FILE}; ` +
        // Hook ip-up: al conectar el peer, rutas + firewall/NAT hacia sus redes
        `cat > /etc/ppp/ip-up.local <<'EOF'
#!/bin/sh
# \$5 = IP del peer. Agrega las rutas de sus redes de ONUs en el VPS.
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1
sysctl -w net.ipv4.conf.all.rp_filter=0 >/dev/null 2>&1
[ -e "/proc/sys/net/ipv4/conf/$1/rp_filter" ] && printf '0' > "/proc/sys/net/ipv4/conf/$1/rp_filter" 2>/dev/null
while read -r ip nets; do
  [ "$ip" = "$5" ] || continue
  for n in $(echo "$nets" | tr ',' ' '); do
    ip route replace "$n" dev "$1" 2>/dev/null || true
    iptables -C FORWARD -s 172.16.0.0/12 -d "$n" -j ACCEPT 2>/dev/null || iptables -I FORWARD -s 172.16.0.0/12 -d "$n" -j ACCEPT 2>/dev/null
    iptables -C FORWARD -d 172.16.0.0/12 -s "$n" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || iptables -I FORWARD -d 172.16.0.0/12 -s "$n" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null
    iptables -t nat -C POSTROUTING -s 172.16.0.0/12 -d "$n" -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 172.16.0.0/12 -d "$n" -j MASQUERADE 2>/dev/null
  done
done < ${ROUTES_FILE}
EOF
chmod +x /etc/ppp/ip-up.local`
    );

    // Reglas de acceso a la red del ISP: no dependen de que el túnel esté
    // arriba, así el panel/escritorio puede entrar apenas conecte.
    for (const net of nets.split(',').map((s) => s.trim()).filter(Boolean)) {
      const n = escNet(net);
      await sh(
        `iptables -C FORWARD -s 172.16.0.0/12 -d '${n}' -j ACCEPT 2>/dev/null || iptables -I FORWARD -s 172.16.0.0/12 -d '${n}' -j ACCEPT; ` +
          `iptables -C FORWARD -d 172.16.0.0/12 -s '${n}' -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || iptables -I FORWARD -d 172.16.0.0/12 -s '${n}' -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT; ` +
          `iptables -t nat -C POSTROUTING -s 172.16.0.0/12 -d '${n}' -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 172.16.0.0/12 -d '${n}' -j MASQUERADE; true`
      );
    }

    // Si el túnel ya está activo, aplica las rutas ahora mismo.
    const pppIf = (await sh(
      `ip -o -4 addr show | awk '$0 ~ /peer ${esc(tunnelIp)}[/ ]/ {print $2; exit}'`
    )).trim();
    if (pppIf) {
      for (const net of nets.split(',').map((s) => s.trim()).filter(Boolean)) {
        await sh(`ip route replace '${escNet(net)}' dev '${esc(pppIf)}' 2>/dev/null || true`);
      }
    }
  }
}


/** Elimina la cuenta L2TP, sus rutas registradas y corta la sesión activa. */
export async function removeL2tpUser(username: string, tunnelIp?: string) {
  const u = esc(username);
  if (!u) return;
  await sh(
    `sed -i "/^\\"\\?${u}\\"\\?[[:space:]]/d" ${SECRETS} 2>/dev/null; ` +
      (tunnelIp ? `sed -i "/^${esc(tunnelIp)}[[:space:]]/d" ${ROUTES_FILE} 2>/dev/null; ` : '') +
      `pkill -f "pppd.*${u}" 2>/dev/null; true`
  );
}

/**
 * Abre una ruta puntual hacia un equipo descubierto detrás de la MikroTik.
 *
 * Los APs pueden vivir fuera de `onu_networks`: la API de RouterOS los ve en
 * ARP/neighbors, pero el navegador Docker no puede alcanzarlos hasta que el
 * host enruta esa IP por el PPP correcto. Se usa /32 para no apropiarse de
 * redes completas de otro ISP y se aplica NAT al tráfico de los navegadores.
 */
export async function ensureL2tpTargetRoute(tunnelIp: string, targetIp: string): Promise<boolean> {
  const peer = esc(tunnelIp);
  const target = esc(targetIp);
  if (!peer || !target || target !== targetIp) return false;

  const pppIf = (await sh(
    `ip -o -4 addr show | awk '$0 ~ /peer ${peer}[/ ]/ {print $2; exit}'`
  )).trim();
  if (!pppIf) return false;

  const result = await sh(
    `ip route replace '${target}/32' dev '${esc(pppIf)}' 2>/dev/null || exit 1; ` +
      `iptables -C FORWARD -s 172.16.0.0/12 -d '${target}/32' -j ACCEPT 2>/dev/null || iptables -I FORWARD -s 172.16.0.0/12 -d '${target}/32' -j ACCEPT; ` +
      `iptables -C FORWARD -d 172.16.0.0/12 -s '${target}/32' -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || iptables -I FORWARD -d 172.16.0.0/12 -s '${target}/32' -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT; ` +
      `iptables -t nat -C POSTROUTING -s 172.16.0.0/12 -d '${target}/32' -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 172.16.0.0/12 -d '${target}/32' -j MASQUERADE; ` +
      `printf routed`
  );
  return result.includes('routed');
}
