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
    const nets = escNet(onuNetworks?.trim() || '192.168.0.0/16');
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
      `ip -o -4 addr show | grep -F "peer ${esc(tunnelIp)}/" | head -1 | awk '{print $2}'`
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
export async function ensureL2tpTargetRoute(tunnelIp: string, targetIp: string, sourceIp?: string): Promise<boolean> {
  const peer = esc(tunnelIp);
  const target = esc(targetIp);
  const source = sourceIp ? esc(sourceIp) : '';
  if (!peer || !target || target !== targetIp || (sourceIp && source !== sourceIp)) return false;

  // 1) Interfaz PPP cuyo peer es exactamente la IP de túnel del ISP.
  let pppIf = (await sh(
    `ip -o -4 addr show | grep -F "peer ${peer}/" | head -1 | awk '{print $2}'`
  )).trim();

  // 2) Si el peer no coincide (RouterOS puede negociar otra IP de punta),
  //    se usa la interfaz PPP que ya tenga ruta hacia el destino.
  if (!pppIf) {
    pppIf = (await sh(
      `ip -o route get ${target} 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev" && $(i+1) ~ /^ppp/) {print $(i+1); exit}}'`
    )).trim();
  }

  // 3) Último recurso: si sólo hay un túnel PPP activo, se usa ese.
  if (!pppIf) {
    const ifs = (await sh(`ip -o link show | awk -F': ' '$2 ~ /^ppp/ {print $2}'`))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ifs.length === 1) pppIf = ifs[0];
  }

  if (!pppIf) return false;


  // Cada escritorio recibe su propia tabla de rutas. Así dos MikroTik pueden
  // exponer 192.168.1.1 (o cualquier LAN repetida) por túneles diferentes sin
  // que la última ruta global reemplace a la anterior.
  const sourceRouting = source
    ? `IFINDEX=$(cat /sys/class/net/'${esc(pppIf)}'/ifindex 2>/dev/null) || exit 1; TABLE=$((20000 + IFINDEX)); ` +
      `ip route replace '${target}/32' dev '${esc(pppIf)}' table "$TABLE" 2>/dev/null || exit 1; ` +
      `while ip rule del from '${source}/32' to '${target}/32' 2>/dev/null; do :; done; ` +
      `ip rule add pref "$TABLE" from '${source}/32' to '${target}/32' table "$TABLE" 2>/dev/null || exit 1; `
    : `ip route replace '${target}/32' dev '${esc(pppIf)}' 2>/dev/null || exit 1; `;

  const result = await sh(
    sourceRouting +
      `iptables -C FORWARD -s 172.16.0.0/12 -d '${target}/32' -j ACCEPT 2>/dev/null || iptables -I FORWARD -s 172.16.0.0/12 -d '${target}/32' -j ACCEPT; ` +
      `iptables -C FORWARD -d 172.16.0.0/12 -s '${target}/32' -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || iptables -I FORWARD -d 172.16.0.0/12 -s '${target}/32' -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT; ` +
      `iptables -t nat -C POSTROUTING -s 172.16.0.0/12 -d '${target}/32' -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 172.16.0.0/12 -d '${target}/32' -j MASQUERADE; ` +
      `printf routed`
  );
  return result.includes('routed');
}
