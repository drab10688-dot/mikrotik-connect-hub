import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest } from '../middleware/auth';
import {
  docker,
  ensureUserBrowser,
  destroyUserBrowser,
  getSession,
  touchSession,
  waitReady,
  userBrowserConfig,
  UserBrowserSession,
} from '../lib/user-browser';

/**
 * Navegador remoto por USUARIO: cada operador tiene su propio Chromium+KasmVNC
 * en un puerto dedicado, con credenciales temporales. Nadie ve las pestañas de
 * los demás. El escritorio se destruye solo tras la inactividad configurada.
 */
export const browserRouter = Router();

const IDLE_MINUTES = userBrowserConfig.IDLE_MINUTES;

/**
 * Autoriza el acceso a los escritorios servidos por Nginx (Winbox 8082 y el
 * navegador global heredado 8081) mediante auth_request.
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
    touchSession(decoded.userId);
  } catch {
    return res.status(401).end();
  }
  return res.status(200).end();
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

/** Displays X disponibles dentro del contenedor del usuario. */
async function detectDisplays(container: string): Promise<string[]> {
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

/** Abre el equipo en una PESTAÑA NUEVA (las anteriores se conservan). */
async function openInNewTab(container: string, display: string, url: string) {
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

function publicSession(s: UserBrowserSession) {
  return {
    port: s.port,
    user: s.user,
    password: s.password,
    container: s.container,
    idleMinutes: IDLE_MINUTES,
  };
}

function requireUser(req: AuthRequest, res: Response): string | null {
  if (!req.userId) {
    res.status(401).json({ success: false, error: 'Sesión no válida' });
    return null;
  }
  return req.userId;
}

/** Estado del escritorio propio del usuario (sin crearlo). */
browserRouter.get('/status', async (req: AuthRequest, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const s = getSession(userId);
  res.json({
    success: true,
    data: s
      ? { running: true, ...publicSession(s) }
      : { running: false, idleMinutes: IDLE_MINUTES, hint: 'Se creará tu escritorio privado al abrir un equipo.' },
  });
});

/** Crea (o reutiliza) el escritorio privado del usuario. */
browserRouter.post('/session', async (req: AuthRequest, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const s = await ensureUserBrowser(userId);
    await waitReady(s);
    res.json({ success: true, data: { running: true, ...publicSession(s) } });
  } catch (e: any) {
    res.status(503).json({ success: false, error: e?.message || 'No se pudo iniciar tu escritorio remoto' });
  }
});

/** Latido del visor: evita que el escritorio se destruya mientras se usa. */
browserRouter.post('/ping', (req: AuthRequest, res) => {
  if (req.userId) touchSession(req.userId);
  res.json({ success: true, data: { idleMinutes: IDLE_MINUTES } });
});

/** Cierre manual: destruye el escritorio del usuario (pestañas, cookies, historial). */
browserRouter.post('/close', async (req: AuthRequest, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  await destroyUserBrowser(userId);
  res.json({ success: true });
});

/** Abre la URL del equipo en una pestaña nueva del escritorio privado. */
browserRouter.post('/open', async (req: AuthRequest, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const url = sanitizeUrl((req as any).body?.url);
  if (!url) return res.status(400).json({ success: false, error: 'URL no permitida (solo IPs privadas http/https)' });

  let session: UserBrowserSession;
  try {
    session = await ensureUserBrowser(userId);
  } catch (e: any) {
    return res.status(503).json({ success: false, error: e?.message || 'No se pudo iniciar tu escritorio remoto' });
  }

  const ready = await waitReady(session);
  if (!ready) {
    return res.status(503).json({
      success: false,
      error: 'Tu escritorio remoto se está iniciando, reintenta en unos segundos',
      data: publicSession(session),
    });
  }

  touchSession(userId);

  const displays = await detectDisplays(session.container);
  let lastError = '';
  for (const display of displays) {
    const navigated = await openInNewTab(session.container, display, url);
    if (navigated.ok) {
      return res.json({ success: true, data: { url, display, method: 'new-tab', ...publicSession(session) } });
    }
    lastError = navigated.err;

    const env = ['-e', `DISPLAY=${display}`, '-e', 'HOME=/config'];
    const attempts: string[][] = [
      ['exec', '-u', 'abc', ...env, session.container, '/usr/bin/chromium', '--new-tab', url],
      ['exec', '-u', '1000', ...env, session.container, '/usr/bin/chromium', '--new-tab', url],
      ['exec', ...env, session.container, 's6-setuidgid', 'abc', '/usr/bin/chromium', '--new-tab', url],
    ];
    for (const args of attempts) {
      const result = await docker(args, 20000);
      if (result.ok) {
        return res.json({ success: true, data: { url, display, method: 'chromium-cli', ...publicSession(session) } });
      }
      lastError = result.err;
    }
  }

  res.status(502).json({ success: false, error: lastError || 'No se pudo abrir la URL en tu escritorio remoto' });
});
