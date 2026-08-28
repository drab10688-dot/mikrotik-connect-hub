import { execFile } from 'child_process';

const CONTAINER = process.env.L2TP_CONTAINER || 'omnisync-l2tp';
const SECRETS = '/etc/ppp/chap-secrets';

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

/** Crea/actualiza la cuenta L2TP en el servidor VPN (chap-secrets). */
export async function upsertL2tpUser(username: string, password: string) {
  const u = esc(username);
  const p = esc(password);
  if (!u || !p) return;
  await sh(
    `touch ${SECRETS}; sed -i "/^\\"\\?${u}\\"\\?[[:space:]]/d" ${SECRETS}; ` +
      `printf '%s\\n' '"${u}" l2tpd "${p}" *' >> ${SECRETS}`
  );
}

/** Elimina la cuenta L2TP del servidor VPN y corta la sesión activa. */
export async function removeL2tpUser(username: string) {
  const u = esc(username);
  if (!u) return;
  await sh(
    `sed -i "/^\\"\\?${u}\\"\\?[[:space:]]/d" ${SECRETS} 2>/dev/null; ` +
      `pkill -f "pppd.*${u}" 2>/dev/null; true`
  );
}
