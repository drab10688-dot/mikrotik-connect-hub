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

  // Mapa tunnel_ip -> redes (lo lee el hook /etc/ppp/ip-up.local)
  if (tunnelIp && onuNetworks) {
    const nets = escNet(onuNetworks);
    await sh(
      `touch ${ROUTES_FILE}; sed -i "/^${esc(tunnelIp)}[[:space:]]/d" ${ROUTES_FILE}; ` +
        `printf '%s\\n' '${esc(tunnelIp)} ${nets}' >> ${ROUTES_FILE}; ` +
        // Hook ip-up: al conectar el peer, rutas hacia sus redes de ONUs
        `cat > /etc/ppp/ip-up.local <<'EOF'
#!/bin/sh
# \$5 = IP del peer. Agrega las rutas de sus redes de ONUs en el VPS.
while read -r ip nets; do
  [ "$ip" = "$5" ] || continue
  for n in $nets; do ip route replace "$n" via "$5" 2>/dev/null; docker exec omnisync-api ip route replace "$n" via "$5" 2>/dev/null || true; done
done < ${ROUTES_FILE}
EOF
chmod +x /etc/ppp/ip-up.local`
    );

    // Si el túnel ya está activo, aplica las rutas ahora mismo
    for (const net of onuNetworks.split(',').map((s) => s.trim()).filter(Boolean)) {
      await sh(`ip route replace '${escNet(net)}' via '${esc(tunnelIp)}' 2>/dev/null || true`);
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
