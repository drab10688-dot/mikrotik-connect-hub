import { Router, Response } from 'express';
import { execFile } from 'child_process';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../lib/db';

export const sslRouter = Router();

/** Directorio de instalación EN EL HOST (los volúmenes de docker run usan rutas del host). */
const HOST_DIR = process.env.HOST_INSTALL_DIR || '/opt/omnisync';
/** Mismo directorio visto desde el contenedor de la API (montado en compose). */
const CERTS_LOCAL = '/opt/omnisync/nginx/certs';

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/i;

function run(cmd: string, args: string[], timeout = 180000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`;
      if (err) reject(new Error(out.trim() || err.message));
      else resolve(out);
    });
  });
}

async function getSettings() {
  const { rows } = await pool.query(
    `SELECT domain, email, status, last_message, last_issued_at, expires_at
       FROM ssl_settings WHERE id = 1`
  );
  return rows[0] || null;
}

async function saveSettings(patch: Record<string, any>) {
  const fields = Object.keys(patch);
  const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
  await pool.query(
    `INSERT INTO ssl_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`
  );
  if (fields.length) {
    await pool.query(
      `UPDATE ssl_settings SET ${sets}, updated_at = now() WHERE id = 1`,
      fields.map((f) => patch[f])
    );
  }
}

/** Emite/renueva el certificado con certbot en un contenedor efímero. */
async function issueCertificate(domain: string, email: string) {
  const webroot = `${HOST_DIR}/frontend/dist`;
  const args = [
    'run', '--rm',
    '-v', '/etc/letsencrypt:/etc/letsencrypt',
    '-v', '/var/lib/letsencrypt:/var/lib/letsencrypt',
    '-v', `${webroot}:/webroot`,
    'certbot/certbot',
    'certonly', '--webroot', '-w', '/webroot',
    '-d', domain,
    '--agree-tos', '--non-interactive', '--keep-until-expiring',
  ];
  if (email) args.push('-m', email);
  else args.push('--register-unsafely-without-email');

  const log = await run('docker', args, 300000);

  // Copia los certificados al directorio que lee Nginx
  await run('docker', [
    'run', '--rm',
    '-v', '/etc/letsencrypt:/le:ro',
    '-v', `${HOST_DIR}/nginx/certs:/certs`,
    'alpine:3.19', 'sh', '-c',
    `cp -L /le/live/${domain}/fullchain.pem /certs/remote.crt && ` +
    `cp -L /le/live/${domain}/privkey.pem /certs/remote.key && ` +
    `chmod 644 /certs/remote.crt && chmod 600 /certs/remote.key`,
  ], 60000);

  await run('docker', ['restart', 'omnisync-nginx'], 60000).catch(() => '');
  return log;
}

/** Fecha de expiración del certificado instalado. */
async function certExpiry(): Promise<string | null> {
  try {
    const out = await run('openssl', ['x509', '-enddate', '-noout', '-in', `${CERTS_LOCAL}/remote.crt`], 10000);
    const m = /notAfter=(.+)/.exec(out);
    const d = m ? new Date(m[1].trim()) : null;
    return d && !isNaN(d.getTime()) ? d.toISOString() : null;
  } catch {
    return null;
  }
}

/** Comprueba que el dominio resuelva a la IP pública del VPS. */
async function checkDns(domain: string) {
  try {
    const out = await run('getent', ['hosts', domain], 8000);
    const ips = out.trim().split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
    const expected = process.env.VPS_PUBLIC_IP || '';
    return { resolved: ips, expected, ok: !expected || ips.includes(expected) };
  } catch {
    return { resolved: [], expected: process.env.VPS_PUBLIC_IP || '', ok: false };
  }
}

// ─── Estado actual ────────────────────────────
sslRouter.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const settings = await getSettings();
    const expires = await certExpiry();
    const dns = settings?.domain ? await checkDns(settings.domain) : null;
    res.json({
      success: true,
      data: {
        domain: settings?.domain || '',
        email: settings?.email || '',
        status: settings?.status || (expires ? 'active' : 'none'),
        last_message: settings?.last_message || '',
        last_issued_at: settings?.last_issued_at || null,
        certificate_expires_at: expires,
        has_certificate: !!expires,
        public_ip: process.env.VPS_PUBLIC_IP || '',
        dns,
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Verificar DNS antes de emitir ────────────
sslRouter.post('/check', async (req: AuthRequest, res: Response) => {
  const domain = String(req.body?.domain || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) return res.status(400).json({ success: false, error: 'Dominio no válido' });
  res.json({ success: true, data: await checkDns(domain) });
});

// ─── Emitir / renovar certificado ─────────────
sslRouter.post('/issue', async (req: AuthRequest, res: Response) => {
  const domain = String(req.body?.domain || '').trim().toLowerCase();
  const email = String(req.body?.email || '').trim();
  if (!DOMAIN_RE.test(domain)) {
    return res.status(400).json({ success: false, error: 'Dominio no válido (ejemplo: panel.midominio.com)' });
  }
  try {
    await saveSettings({ domain, email, status: 'issuing', last_message: 'Solicitando certificado…' });
    const dns = await checkDns(domain);
    if (!dns.ok && dns.resolved.length === 0) {
      await saveSettings({ status: 'error', last_message: 'El dominio no resuelve todavía. Apúntelo a la IP del VPS y espere unos minutos.' });
      return res.status(400).json({ success: false, error: 'El dominio no resuelve a ninguna IP. Cree el registro A hacia ' + (process.env.VPS_PUBLIC_IP || 'la IP del VPS') });
    }
    const log = await issueCertificate(domain, email);
    const expires = await certExpiry();
    await saveSettings({
      status: 'active',
      last_message: 'Certificado emitido correctamente',
      last_issued_at: new Date().toISOString(),
      expires_at: expires,
    });
    res.json({ success: true, data: { domain, log: log.slice(-4000), certificate_expires_at: expires } });
  } catch (e: any) {
    const msg = String(e.message || 'Error al emitir el certificado');
    await saveSettings({ status: 'error', last_message: msg.slice(0, 2000) });
    res.status(500).json({ success: false, error: msg.slice(0, 2000) });
  }
});

/** Renovación automática: se ejecuta a diario desde el cron del servidor. */
export async function renewSslIfNeeded() {
  const settings = await getSettings().catch(() => null);
  if (!settings?.domain) return;
  const expires = await certExpiry();
  if (expires) {
    const days = (new Date(expires).getTime() - Date.now()) / 86400000;
    if (days > 25) return;
  }
  try {
    await issueCertificate(settings.domain, settings.email || '');
    await saveSettings({
      status: 'active',
      last_message: 'Certificado renovado automáticamente',
      last_issued_at: new Date().toISOString(),
      expires_at: await certExpiry(),
    });
    console.log('[SSL] certificado renovado para', settings.domain);
  } catch (e: any) {
    console.error('[SSL] error al renovar:', e.message);
  }
}
