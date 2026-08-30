import { Router } from 'express';
import { execFile } from 'child_process';

/**
 * Navegador remoto (Firefox real dentro del VPS).
 * El contenedor navega directamente a la IP del equipo por la ruta L2TP del host,
 * por lo que no depende del proxy HTTP ni de la reescritura de HTML antiguo.
 */
export const browserRouter = Router();

const CONTAINER = process.env.BROWSER_CONTAINER || 'omnisync-browser';

function docker(args: string[], timeout = 15000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile('docker', args, { timeout }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: (stdout || '').trim(), err: (stderr || error?.message || '').trim() });
    });
  });
}

/** Solo permitimos http/https hacia IPs privadas alcanzables por la VPN. */
function sanitizeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let value = raw.trim();
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol)) return null;
  const host = parsed.hostname;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (!isIp) return null;
  const [a, b] = host.split('.').map(Number);
  const isPrivate =
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 100 || a === 127;
  if (!isPrivate) return null;
  if (parsed.port && !/^\d{1,5}$/.test(parsed.port)) return null;
  return parsed.toString();
}

/** Estado del contenedor del navegador. */
browserRouter.get('/status', async (_req, res) => {
  const inspect = await docker(['inspect', '--format', '{{.State.Status}}', CONTAINER], 8000);
  const status = inspect.ok ? inspect.out : 'missing';
  res.json({
    success: true,
    data: {
      container: CONTAINER,
      status,
      running: status === 'running',
      url: '/browser/',
      hint:
        status === 'running'
          ? null
          : 'El navegador remoto no está activo. Ejecuta: docker compose -f /opt/omnisync/docker-compose.yml up -d remote-browser',
    },
  });
});

/** Abre (o reutiliza) una pestaña del Firefox remoto en la URL del equipo. */
browserRouter.post('/open', async (req, res) => {
  const url = sanitizeUrl(req.body?.url);
  if (!url) return res.status(400).json({ success: false, error: 'URL no permitida (solo IPs privadas http/https)' });

  const state = await docker(['inspect', '--format', '{{.State.Status}}', CONTAINER], 8000);
  if (!state.ok || state.out !== 'running') {
    return res.status(503).json({
      success: false,
      error: 'El navegador remoto no está en ejecución',
      data: { container: CONTAINER, status: state.ok ? state.out : 'missing' },
    });
  }

  // Firefox debe ejecutarse SIEMPRE como el usuario "abc" (dueño de /config).
  // Como root falla con: "Running Firefox as root ... is not supported".
  const env = ['-e', 'DISPLAY=:1', '-e', 'HOME=/config'];
  const attempts: string[][] = [
    ['exec', '-u', 'abc', ...env, CONTAINER, '/usr/bin/firefox', '--new-tab', url],
    ['exec', '-u', '1000', ...env, CONTAINER, '/usr/bin/firefox', '--new-tab', url],
    ['exec', ...env, CONTAINER, 's6-setuidgid', 'abc', '/usr/bin/firefox', '--new-tab', url],
    ['exec', ...env, CONTAINER, 'su', '-s', '/bin/sh', 'abc', '-c', `DISPLAY=:1 HOME=/config /usr/bin/firefox --new-tab '${url}'`],
  ];


  let lastError = '';
  for (const args of attempts) {
    const result = await docker(args, 20000);
    if (result.ok) return res.json({ success: true, data: { url, viewer: '/browser/' } });
    lastError = result.err;
  }

  res.status(502).json({ success: false, error: lastError || 'No se pudo abrir la URL en el navegador remoto' });
});
