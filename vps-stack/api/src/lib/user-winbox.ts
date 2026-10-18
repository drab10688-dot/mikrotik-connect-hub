import crypto from 'crypto';
import { releaseBrowser } from './browser-fw';
import { docker } from './user-browser';

/**
 * WinBox remoto INDEPENDIENTE por usuario (WinBox 4 nativo, imagen
 * vps-stack/winbox). Mismo esquema que el navegador remoto (user-browser.ts):
 * un contenedor por usuario en la red de escritorios, firewall por ISP
 * (browser-fw.ts), acceso solo por Nginx (8082) con el token del panel, y se
 * destruye tras unos minutos sin uso: direcciones y claves guardadas en WinBox
 * no sobreviven a la sesión.
 *
 * Los contenedores se llaman omnisync-wb-*; la limpieza de reglas huérfanas de
 * user-browser.ts los cuenta como vivos (filtra por ambos prefijos).
 */

const IMAGE = process.env.WINBOX_IMAGE || 'omnisync/winbox:latest';
const NETWORK = process.env.BROWSER_NETWORK || 'omnisync_omnisync-browser-net';
const IDLE_MINUTES = Number(process.env.WINBOX_IDLE_MINUTES || process.env.BROWSER_IDLE_MINUTES || 15);
const MAX_SESSIONS = Number(process.env.WINBOX_MAX_SESSIONS || 15);
const TZ = process.env.TZ || 'America/Bogota';

export interface UserWinboxSession {
  userId: string;
  container: string;
  user: string;
  password: string;
  lastActivity: number;
  startedAt: number;
  readyAt?: number;
}

const sessions = new Map<string, UserWinboxSession>();

function containerName(userId: string): string {
  return `omnisync-wb-${crypto.createHash('sha1').update(userId).digest('hex').slice(0, 10)}`;
}

async function containerStatus(name: string): Promise<string> {
  const r = await docker(['inspect', '--format', '{{.State.Status}}', name], 8000);
  return r.ok ? r.out : 'missing';
}

/** ¿Está construida la imagen? (la construye update.sh desde vps-stack/winbox). */
export async function winboxImageReady(): Promise<boolean> {
  return (await docker(['image', 'inspect', IMAGE], 15000)).ok;
}

/** Crea (o reutiliza) el WinBox del usuario. `created` indica si es nuevo. */
export async function ensureUserWinbox(userId: string): Promise<{ session: UserWinboxSession; created: boolean }> {
  const name = containerName(userId);
  const existing = sessions.get(userId);
  if (existing && (await containerStatus(name)) === 'running') {
    existing.lastActivity = Date.now();
    return { session: existing, created: false };
  }
  sessions.delete(userId);

  // Contenedor huérfano (reinicio del API): se recrea limpio con clave nueva.
  if ((await containerStatus(name)) !== 'missing') await docker(['rm', '-f', name], 60000);

  if (sessions.size >= MAX_SESSIONS) {
    throw new Error('Hay demasiados WinBox abiertos en este momento, intenta en unos minutos');
  }
  if (!(await winboxImageReady())) {
    throw new Error('WinBox aún no está instalado en el servidor (ejecuta update.sh)');
  }

  const password = crypto.randomBytes(9).toString('base64url');
  const user = 'omnisync';
  const created = await docker(
    [
      'run', '-d',
      '--name', name,
      '--restart', 'no',
      '--shm-size=256m',
      '--security-opt', 'seccomp=unconfined',
      '--label', 'omnisync.userWinbox=true',
      '--label', `omnisync.userId=${userId}`,
      '-e', 'PUID=1000',
      '-e', 'PGID=1000',
      '-e', `TZ=${TZ}`,
      '-e', `CUSTOM_USER=${user}`,
      '-e', `PASSWORD=${password}`,
      '-e', 'TITLE=WinBox',
      // Sin DNS público: WinBox entra por IP a los routers del túnel.
      '--dns', '127.0.0.1',
      '--network', NETWORK,
      // Sin publicar puertos: solo se llega por Nginx (8082, HTTPS + token).
      IMAGE,
    ],
    120000,
  );
  if (!created.ok) {
    await docker(['rm', '-f', name], 30000);
    throw new Error(created.err || 'No se pudo crear tu WinBox remoto');
  }

  const session: UserWinboxSession = {
    userId,
    container: name,
    user,
    password,
    lastActivity: Date.now(),
    startedAt: Date.now(),
  };
  sessions.set(userId, session);
  return { session, created: true };
}

export function getWinboxSession(userId: string): UserWinboxSession | undefined {
  return sessions.get(userId);
}

export function touchWinbox(userId: string) {
  const s = sessions.get(userId);
  if (s) s.lastActivity = Date.now();
}

/** IP del contenedor en la red de escritorios (para el firewall por ISP). */
export async function getWinboxIp(session: UserWinboxSession): Promise<string | null> {
  const r = await docker(
    ['inspect', '--format', `{{with index .NetworkSettings.Networks "${NETWORK}"}}{{.IPAddress}}{{end}}`, session.container],
    8000,
  );
  const ip = r.out.trim();
  return r.ok && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null;
}

/** Espera a que el servidor gráfico (Selkies/Wayland) esté listo. */
/**
 * Pone `text` (IP:puerto) en el portapapeles DEL WinBox remoto: X11 :0 (lo usa
 * WinBox/Qt) y Wayland (visor), así basta Ctrl+V en "Connect to". El portapapeles
 * del PC del técnico no llega al WinBox. El texto viaja por variable de entorno,
 * nunca dentro del comando.
 */
export async function setWinboxClipboard(session: UserWinboxSession, text: string): Promise<boolean> {
  if (!/^[0-9.:]{7,21}$/.test(text)) return false;
  const r = await docker(
    [
      'exec', '-u', 'abc', '-e', `WBTEXT=${text}`, session.container, 'sh', '-c',
      'printf %s "$WBTEXT" | DISPLAY=:0 xclip -selection clipboard -i >/dev/null 2>&1; ' +
        '(printf %s "$WBTEXT" | XDG_RUNTIME_DIR=/config/.XDG WAYLAND_DISPLAY=wayland-1 wl-copy >/dev/null 2>&1 &); ' +
        'sleep 0.5; [ "$(DISPLAY=:0 timeout 3 xclip -selection clipboard -o 2>/dev/null)" = "$WBTEXT" ]',
    ],
    15000,
  );
  return r.ok;
}

export async function waitWinboxReady(session: UserWinboxSession, timeoutMs = 30000): Promise<boolean> {
  if (session.readyAt) return true;
  const status = await containerStatus(session.container);
  if (status === 'exited' || status === 'missing') return false;
  const loops = Math.max(1, Math.round(timeoutMs / 250));
  const probe = await docker(
    [
      'exec', session.container, 'sh', '-lc',
      `i=0; while [ $i -lt ${loops} ]; do ls /config/.XDG/wayland-* /tmp/.X11-unix/X* >/dev/null 2>&1 && exit 0; i=$((i+1)); sleep 0.25; done; exit 1`,
    ],
    timeoutMs + 5000,
  );
  if (probe.ok) session.readyAt = Date.now();
  return probe.ok;
}

/** Cierra el WinBox del usuario y borra sus reglas de firewall. */
export async function destroyUserWinbox(userId: string) {
  const s = sessions.get(userId);
  const name = s?.container || containerName(userId);
  sessions.delete(userId);
  await docker(['rm', '-f', name], 90000);
  await releaseBrowser(name).catch(() => undefined);
}

/**
 * Al arrancar el API no hay sesiones en memoria: los WinBox que hayan quedado
 * vivos de antes ya no tienen dueño ni clave conocida, así que se cierran.
 */
setTimeout(async () => {
  const r = await docker(['ps', '-a', '--filter', 'name=omnisync-wb-', '--format', '{{.Names}}'], 15000);
  if (!r.ok) return;
  for (const name of r.out.split('\n').map((n) => n.trim()).filter(Boolean)) {
    if ([...sessions.values()].some((s) => s.container === name)) continue;
    await docker(['rm', '-f', name], 60000);
    await releaseBrowser(name).catch(() => undefined);
  }
}, 15_000).unref?.();

/**
 * ¿Hay un visor conectado? El visor usa un websocket que queda abierto (Nginx
 * no vuelve a autorizar mientras se trabaja), así que se miran las conexiones
 * TCP establecidas al puerto 3000 (0x0BB8) del contenedor.
 */
async function viewerConnected(s: UserWinboxSession): Promise<boolean> {
  const r = await docker(
    ['exec', s.container, 'sh', '-c', `cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk '$2 ~ /:0BB8$/ && $4 == "01"' | wc -l`],
    10000,
  );
  return r.ok && Number(r.out) > 0;
}

/** Cierra los WinBox inactivos (sin visor conectado durante IDLE_MINUTES). */
setInterval(async () => {
  const limit = IDLE_MINUTES * 60_000;
  for (const [userId, s] of sessions) {
    if (Date.now() - s.lastActivity <= limit) continue;
    if (await viewerConnected(s)) {
      s.lastActivity = Date.now();
      continue;
    }
    await destroyUserWinbox(userId).catch(() => undefined);
  }
}, 60_000).unref?.();

export const userWinboxConfig = { IDLE_MINUTES };
