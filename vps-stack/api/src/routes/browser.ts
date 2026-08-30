import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import jwt from 'jsonwebtoken';
import { AuthRequest } from '../middleware/auth';

/**
 * Navegador remoto (Chromium real dentro del VPS, sin contraseña propia).
 * Es un único escritorio global en el puerto 8081 (los escritorios dedicados
 * por ISP se retiraron: publicaban decenas de puertos y tumbaban Nginx).
 *
 * Comportamiento:
 *  - Cada equipo que se abre se carga en una PESTAÑA NUEVA; las anteriores
 *    siguen abiertas para poder ir y volver entre ONUs/antenas.
 *  - Si nadie usa el visor durante un rato, se cierra todo (pestañas, cookies,
 *    historial y caché) reiniciando el contenedor con perfil en tmpfs.
 */
export const browserRouter = Router();

const CONTAINER = process.env.BROWSER_CONTAINER || 'omnisync-browser';
const BROWSER_PORT = Number(process.env.BROWSER_PORT || 8081);
/** Minutos sin actividad del visor antes de cerrar todas las pestañas. */
const IDLE_MINUTES = Number(process.env.BROWSER_IDLE_MINUTES || 10);

/**
 * Autoriza el acceso al escritorio remoto para Nginx auth_request.
 * Acepta el token JWT por query (?token=) o por la cookie omnisync_web_token.
 */
export async function authorizeBrowserAccess(req: Request, res: Response) {
  const original = String(req.headers['x-original-uri'] || req.originalUrl || '');
  let token: string | undefined;
  try {
    token = new URL(original, 'http://local').searchParams.get('token') || undefined;
  } catch {
    /* ignore */
  }
  if (!token) {
    const raw = req.headers.cookie || '';
    for (const part of raw.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === 'omnisync_web_token') token = decodeURIComponent(v.join('='));
    }
  }
  if (!token) return res.status(401).end();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'changeme') as { userId?: string };
    if (!decoded?.userId) return res.status(401).end();
  } catch {
    return res.status(401).end();
  }
  touchActivity();
  return res.status(200).end();
}

function docker(args: string[], timeout = 15000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile('docker', args, { timeout }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: (stdout || '').trim(), err: (stderr || error?.message || '').trim() });
    });
  });
}

// ─── Control de inactividad ───────────────────────────────────────────────
let lastActivity = Date.now();
let sessionOpen = false;

function touchActivity() {
  lastActivity = Date.now();
}

/** Cierra todas las pestañas y borra cookies/historial/caché del navegador. */
async function closeEverything() {
  sessionOpen = false;
  await docker(
    [
      'exec',
      CONTAINER,
      'sh',
      '-lc',
      'pkill -f chromium >/dev/null 2>&1; sleep 1; rm -rf /config/.config/chromium/* /config/.cache/* /config/Downloads/* >/dev/null 2>&1; exit 0',
    ],
    30000
  );
  // Reinicio limpio: el perfil vive en tmpfs, así no queda rastro de sesión.
  await docker(['restart', CONTAINER], 90000);
}

setInterval(() => {
  if (!sessionOpen) return;
  if (Date.now() - lastActivity < IDLE_MINUTES * 60_000) return;
  closeEverything().catch(() => undefined);
}, 60_000).unref?.();

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
async function detectDisplays(container = CONTAINER): Promise<string[]> {
  const found: string[] = [];
  const ls = await docker(['exec', container, 'sh', '-c', 'ls /tmp/.X11-unix 2>/dev/null'], 8000);
  if (ls.ok) {
    for (const line of ls.out.split(/\s+/)) {
      const m = /^X(\d+)$/.exec(line.trim());
      if (m) found.push(`:${m[1]}`);
    }
  }
  for (const fallback of [':1', ':0']) if (!found.includes(fallback)) found.push(fallback);
  return found;
}

/**
 * Abre el equipo en una PESTAÑA NUEVA de la ventana visible (Ctrl+T + URL).
 * Así las pestañas anteriores se conservan y se puede alternar entre equipos.
 */
async function openInNewTab(display: string, url: string, container = CONTAINER) {
  const script = [
    'command -v xdotool >/dev/null 2>&1 || exit 127',
    'WID="$(xdotool search --onlyvisible --class "chromium|firefox|Navigator" 2>/dev/null | tail -1)"',
    '[ -n "$WID" ] || WID="$(xdotool search --onlyvisible --name "." 2>/dev/null | tail -1)"',
    '[ -n "$WID" ] || exit 3',
    'xdotool windowactivate --sync "$WID"',
    'xdotool key --window "$WID" ctrl+t',
    'sleep 1',
    'xdotool key --window "$WID" ctrl+l',
    'xdotool type --window "$WID" --delay 1 --clearmodifiers "$TARGET_URL"',
    'xdotool key --window "$WID" Return',
  ].join(' && ');
  return docker(
    ['exec', '-u', 'abc', '-e', `DISPLAY=${display}`, '-e', `TARGET_URL=${url}`, container, 'sh', '-lc', script],
    25000
  );
}

async function containerStatus(name = CONTAINER): Promise<string> {
  const r = await docker(['inspect', '--format', '{{.State.Status}}', name], 8000);
  return r.ok ? r.out : 'missing';
}

/** Estado del escritorio remoto global. */
browserRouter.get('/status', async (_req: AuthRequest, res) => {
  const status = await containerStatus();
  const running = status === 'running';
  res.json({
    success: true,
    data: {
      container: CONTAINER,
      status,
      running,
      port: BROWSER_PORT,
      idleMinutes: IDLE_MINUTES,
      hint: running ? null : 'El escritorio remoto se está iniciando, reintenta en unos segundos.',
    },
  });
});

/** Latido del visor: mientras haya visor abierto, no se cierran las pestañas. */
browserRouter.post('/ping', (_req: AuthRequest, res) => {
  touchActivity();
  res.json({ success: true, data: { idleMinutes: IDLE_MINUTES } });
});

/** Cierre manual: cierra todas las pestañas y borra cookies/historial. */
browserRouter.post('/close', async (_req: AuthRequest, res) => {
  await closeEverything();
  res.json({ success: true });
});

/** Abre la URL del equipo en una pestaña nueva del Chromium remoto. */
browserRouter.post('/open', async (req: AuthRequest, res) => {
  const url = sanitizeUrl((req as any).body?.url);
  if (!url) return res.status(400).json({ success: false, error: 'URL no permitida (solo IPs privadas http/https)' });

  if ((await containerStatus()) !== 'running') {
    return res.status(503).json({
      success: false,
      error: 'El escritorio remoto se está iniciando, reintenta en unos segundos',
      data: { container: CONTAINER, port: BROWSER_PORT },
    });
  }

  touchActivity();
  sessionOpen = true;

  const displays = await detectDisplays();
  let lastError = '';
  for (const display of displays) {
    const navigated = await openInNewTab(display, url);
    if (navigated.ok) {
      return res.json({ success: true, data: { url, display, port: BROWSER_PORT, method: 'new-tab' } });
    }
    lastError = navigated.err;

    const env = ['-e', `DISPLAY=${display}`, '-e', 'HOME=/config'];
    const attempts: string[][] = [
      ['exec', '-u', 'abc', ...env, CONTAINER, '/usr/bin/chromium', '--new-tab', url],
      ['exec', '-u', '1000', ...env, CONTAINER, '/usr/bin/chromium', '--new-tab', url],
      ['exec', ...env, CONTAINER, 's6-setuidgid', 'abc', '/usr/bin/chromium', '--new-tab', url],
    ];
    for (const args of attempts) {
      const result = await docker(args, 20000);
      if (result.ok) {
        return res.json({ success: true, data: { url, display, port: BROWSER_PORT, method: 'chromium-cli' } });
      }
      lastError = result.err;
      if (/profile appears to be in use|SingletonLock/i.test(lastError)) {
        await docker(
          ['exec', CONTAINER, 'sh', '-c', 'rm -f /config/.config/chromium/Singleton* /config/chromium/Singleton*'],
          8000
        );
        const retry = await docker(args, 20000);
        if (retry.ok) {
          return res.json({ success: true, data: { url, display, port: BROWSER_PORT, method: 'chromium-cli' } });
        }
        lastError = retry.err;
      }
      if (!/cannot open display/i.test(lastError)) continue;
    }
  }

  res.status(502).json({ success: false, error: lastError || 'No se pudo abrir la URL en el navegador remoto' });
});
