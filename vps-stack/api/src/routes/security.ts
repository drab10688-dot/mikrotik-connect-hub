import { Router, Response } from 'express';
import { execFile } from 'child_process';
import { AuthRequest } from '../middleware/auth';

/**
 * Seguridad del servidor (solo super_admin): fail2ban para SSH.
 * La API ya controla Docker (docker.sock); para actuar sobre el HOST lanza un
 * contenedor efímero que entra en los espacios de nombres del PID 1 (nsenter)
 * y ejecuta comandos fijos. Ningún dato del usuario va al shell sin validar.
 */
export const securityRouter = Router();

const HOST_DIR = process.env.HOST_INSTALL_DIR || '/opt/omnisync';
const VPN_NET = process.env.L2TP_TUNNEL_NET || '192.168.42.0/24';
const JAIL = '/etc/fail2ban/jail.d/omnisync-sshd.local';

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/([0-9]|[12]\d|3[0-2]))?$/;
const IPV6 = /^[0-9a-f:]{2,39}(\/(\d|[1-9]\d|1[01]\d|12[0-8]))?$/i;
const isIp = (v: string) => IPV4.test(v) || (v.includes(':') && IPV6.test(v));

function hostSh(script: string, env: Record<string, string> = {}, timeout = 60000): Promise<string> {
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const args = [
    'run', '--rm', '--privileged', '--pid=host', ...envArgs,
    'alpine:3.19', 'nsenter', '-t', '1', '-m', '-u', '-i', '-n', '-p', '--',
    '/bin/bash', '-c', script,
  ];
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`;
      if (err) reject(new Error(out.trim().split('\n').slice(-5).join('\n') || err.message));
      else resolve(String(stdout || ''));
    });
  });
}

/** Activar/desactivar tarda (apt-get): corre en segundo plano y el panel consulta el estado. */
let job: { running: boolean; action?: string; error?: string | null; finishedAt?: string } = { running: false };

async function readStatus() {
  const out = await hostSh(`
    if command -v fail2ban-client >/dev/null 2>&1; then echo "installed=1"; else echo "installed=0"; fi
    echo "active=$(systemctl is-active fail2ban 2>/dev/null || true)"
    echo "enabled=$(systemctl is-enabled fail2ban 2>/dev/null || true)"
    [ -f ${JAIL} ] && echo "ignoreip=$(sed -n 's/^ignoreip *= *//p' ${JAIL})"
    if systemctl is-active --quiet fail2ban; then
      fail2ban-client status sshd 2>/dev/null | sed -n 's/.*Currently banned:\\s*/banned_now=/p; s/.*Total banned:\\s*/banned_total=/p; s/.*Total failed:\\s*/failed_total=/p; s/.*Banned IP list:\\s*/banned_list=/p'
    fi
  `, {}, 30000);
  const kv: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const fixed = new Set(['127.0.0.1/8', '::1', VPN_NET]);
  return {
    installed: kv.installed === '1',
    active: kv.active === 'active',
    admin_ips: (kv.ignoreip || '').split(/\s+/).filter((ip) => ip && !fixed.has(ip)),
    vpn_net: VPN_NET,
    banned_now: Number(kv.banned_now || 0),
    banned_total: Number(kv.banned_total || 0),
    failed_total: Number(kv.failed_total || 0),
    banned_list: (kv.banned_list || '').split(/\s+/).filter(Boolean),
  };
}

securityRouter.get('/fail2ban', async (req: AuthRequest, res: Response) => {
  try {
    const status = await readStatus();
    const clientIp = String(req.headers['x-real-ip'] || req.ip || '').replace(/^::ffff:/, '');
    res.json({ data: { ...status, job, client_ip: isIp(clientIp) ? clientIp : null } });
  } catch (e: any) {
    res.status(500).json({ error: e.message, data: { job } });
  }
});

securityRouter.post('/fail2ban', async (req: AuthRequest, res: Response) => {
  if (job.running) return res.status(409).json({ error: 'Ya hay un cambio en curso' });
  const enabled = Boolean(req.body?.enabled);
  const adminIps = String(req.body?.admin_ips || '').split(/[\s,;]+/).filter(Boolean);
  const bad = adminIps.filter((ip) => !isIp(ip));
  if (bad.length) return res.status(400).json({ error: `IP no válida: ${bad.join(', ')}` });
  if (adminIps.length > 20) return res.status(400).json({ error: 'Máximo 20 IPs' });

  job = { running: true, action: enabled ? 'activar' : 'desactivar', error: null };
  const task = enabled
    ? hostSh(`bash ${HOST_DIR}/seguridad.sh fail2ban`, { ADMIN_IPS: adminIps.join(' '), L2TP_TUNNEL_NET: VPN_NET }, 300000)
    : hostSh('systemctl disable --now fail2ban', {}, 60000);
  task
    .then(() => { job = { running: false, action: job.action, error: null, finishedAt: new Date().toISOString() }; })
    .catch((e) => { job = { running: false, action: job.action, error: e.message, finishedAt: new Date().toISOString() }; });
  res.status(202).json({ data: { job } });
});

securityRouter.post('/fail2ban/unban', async (req: AuthRequest, res: Response) => {
  const ip = String(req.body?.ip || '').trim();
  if (!isIp(ip) || ip.includes('/')) return res.status(400).json({ error: 'IP no válida' });
  try {
    await hostSh(`fail2ban-client set sshd unbanip ${ip}`, {}, 30000);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
