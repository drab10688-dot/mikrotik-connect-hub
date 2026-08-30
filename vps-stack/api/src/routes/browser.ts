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

/** Detecta los displays X disponibles dentro del contenedor del navegador. */
async function detectDisplays(): Promise<string[]> {
  const found: string[] = [];
  const ls = await docker(['exec', CONTAINER, 'sh', '-c', 'ls /tmp/.X11-unix 2>/dev/null'], 8000);
  if (ls.ok) {
    for (const line of ls.out.split(/\s+/)) {
      const m = /^X(\d+)$/.exec(line.trim());
      if (m) found.push(`:${m[1]}`);
    }
  }
  for (const fallback of [':1', ':0']) if (!found.includes(fallback)) found.push(fallback);
  return found;
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

  // El display depende de la imagen (selkies usa :0, kasm usa :1): lo detectamos.
  const displays = await detectDisplays();

  let lastError = '';
  for (const display of displays) {
    const env = ['-e', `DISPLAY=${display}`, '-e', 'HOME=/config'];
    const attempts: string[][] = [
      ['exec', '-u', 'abc', ...env, CONTAINER, '/usr/bin/firefox', '--new-tab', url],
      ['exec', '-u', '1000', ...env, CONTAINER, '/usr/bin/firefox', '--new-tab', url],
      ['exec', ...env, CONTAINER, 's6-setuidgid', 'abc', '/usr/bin/firefox', '--new-tab', url],
      [
        'exec',
        ...env,
        CONTAINER,
        'su',
        '-s',
        '/bin/sh',
        'abc',
        '-c',
        `DISPLAY=${display} HOME=/config /usr/bin/firefox --new-tab '${url}'`,
      ],
    ];
    for (const args of attempts) {
      const result = await docker(args, 20000);
      if (result.ok) return res.json({ success: true, data: { url, display, viewer: '/browser/' } });
      lastError = result.err;
      // Si el error no es de display, no tiene sentido probar otros displays.
      if (!/cannot open display/i.test(lastError)) continue;
    }
  }

  res.status(502).json({ success: false, error: lastError || 'No se pudo abrir la URL en el navegador remoto' });
});
