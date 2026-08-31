import { execFile } from 'child_process';
import crypto from 'crypto';

/**
 * Escritorio remoto INDEPENDIENTE por usuario.
 *
 * Cada usuario que abre un equipo (ONU/antena/MikroTik) recibe su propio
 * contenedor Chromium + KasmVNC, en un puerto dedicado y con credenciales
 * temporales. Así nadie ve las pestañas de otro ISP ni de otro operador.
 *
 * Características:
 *  - Perfil en memoria (tmpfs) + modo incógnito: no guarda cookies ni historial.
 *  - Red aislada (sin internet, sólo redes privadas/VPN por el firewall del host).
 *  - Se destruye solo tras unos minutos sin actividad del visor.
 *  - Los puertos se asignan y liberan dinámicamente (no se publican en Compose,
 *    que fue lo que anteriormente tumbaba Nginx).
 */

const IMAGE = process.env.BROWSER_IMAGE || 'lscr.io/linuxserver/chromium:latest';
const NETWORK = process.env.BROWSER_NETWORK || 'omnisync_omnisync-browser-net';
const PORT_START = Number(process.env.BROWSER_USER_PORT_START || 8100);
const PORT_COUNT = Number(process.env.BROWSER_USER_PORT_COUNT || 30);
const IDLE_MINUTES = Number(process.env.BROWSER_IDLE_MINUTES || 10);
const TZ = process.env.TZ || 'America/Bogota';

export interface UserBrowserSession {
  userId: string;
  container: string;
  port: number;
  user: string;
  password: string;
  lastActivity: number;
  startedAt: number;
  readyAt?: number;
  /** Última URL con la que se lanzó Chromium (página de inicio del escritorio). */
  lastLaunchUrl?: string;
}

const sessions = new Map<string, UserBrowserSession>();

export function docker(args: string[], timeout = 20000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile('docker', args, { timeout }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: (stdout || '').trim(), err: (stderr || error?.message || '').trim() });
    });
  });
}

function shortId(userId: string): string {
  return crypto.createHash('sha1').update(userId).digest('hex').slice(0, 10);
}

function containerName(userId: string): string {
  return `omnisync-ub-${shortId(userId)}`;
}

async function containerStatus(name: string): Promise<string> {
  const r = await docker(['inspect', '--format', '{{.State.Status}}', name], 8000);
  return r.ok ? r.out : 'missing';
}

/** Puertos ya usados por sesiones vivas o por contenedores previos. */
async function usedPorts(): Promise<Set<number>> {
  const used = new Set<number>();
  for (const s of sessions.values()) used.add(s.port);
  const r = await docker(['ps', '-a', '--filter', 'name=omnisync-ub-', '--format', '{{.Ports}}'], 8000);
  if (r.ok) {
    for (const m of r.out.matchAll(/:(\d{4,5})->/g)) used.add(Number(m[1]));
  }
  return used;
}

async function allocatePort(): Promise<number | null> {
  const used = await usedPorts();
  for (let p = PORT_START; p < PORT_START + PORT_COUNT; p++) if (!used.has(p)) return p;
  return null;
}

/** Crea (o reutiliza) el escritorio del usuario y devuelve sus datos de acceso. */
export async function ensureUserBrowser(userId: string, launchUrl?: string): Promise<UserBrowserSession> {
  const name = containerName(userId);
  const existing = sessions.get(userId);

  if (existing && (await containerStatus(name)) === 'running') {
    existing.lastActivity = Date.now();
    // Si piden otro equipo, se recrea el contenedor para que Chromium arranque
    // DIRECTO en esa IP/puerto (como página de inicio). Es la forma más
    // confiable de "pasar la IP": nada de teclear la URL en un navegador ya
    // abierto, que era lo que fallaba.
    if (launchUrl && launchUrl !== existing.lastLaunchUrl) {
      await docker(['rm', '-f', name], 30000);
      sessions.delete(userId);
    } else {
      return existing;
    }
  }

  // Contenedor huérfano de un despliegue anterior: se elimina y se recrea limpio.
  if ((await containerStatus(name)) !== 'missing') {
    await docker(['rm', '-f', name], 60000);
  }

  const port = await allocatePort();
  if (!port) throw new Error('No hay escritorios remotos disponibles en este momento, intenta en unos minutos');

  const password = crypto.randomBytes(9).toString('base64url');
  const user = 'omnisync';

  // La URL del equipo se pasa como PÁGINA DE INICIO de Chromium: al abrir el
  // escritorio remoto, el equipo ya está cargando (igual que antes).
  const homePage = launchUrl && !/\s/.test(launchUrl) ? launchUrl : 'about:blank';
  const chromeCli = [
    '--incognito',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic',
    '--disable-features=Translate,AutofillServerCommunication',
    homePage,
  ].join(' ');

  const args = [
    'run',
    '-d',
    '--name',
    name,
    '--restart',
    'no',
    '--shm-size=512m',
    '--security-opt',
    'seccomp=unconfined',
    '--label',
    'omnisync.userBrowser=true',
    '--label',
    `omnisync.userId=${userId}`,
    '-e',
    'PUID=1000',
    '-e',
    'PGID=1000',
    '-e',
    `TZ=${TZ}`,
    '-e',
    `CUSTOM_USER=${user}`,
    '-e',
    `PASSWORD=${password}`,
    '-e',
    `TITLE=OmniSync`,
    '-e',
    `CHROME_CLI=${chromeCli}`,
    // Sin DNS público: sólo IPs privadas alcanzables por la VPN.
    '--dns',
    '127.0.0.1',
    '--network',
    NETWORK,
    '--tmpfs',
    '/config/.config/chromium:mode=1777,size=384m',
    '--tmpfs',
    '/config/.cache:mode=1777,size=192m',
    // Sin publicación de puertos: el acceso es ÚNICAMENTE a través de Nginx
    // (8081, HTTPS + token del panel). Así el navegador nunca pide clave y
    // nadie puede conectarse directo al escritorio de otro usuario.
    IMAGE,
  ];

  const created = await docker(args, 120000);
  if (!created.ok) {
    await docker(['rm', '-f', name], 30000);
    throw new Error(created.err || 'No se pudo crear el escritorio remoto del usuario');
  }

  const session: UserBrowserSession = {
    userId,
    container: name,
    port,
    user,
    password,
    lastActivity: Date.now(),
    startedAt: Date.now(),
  };
  sessions.set(userId, session);
  return session;
}

export function getSession(userId: string): UserBrowserSession | undefined {
  return sessions.get(userId);
}

export function touchSession(userId: string) {
  const s = sessions.get(userId);
  if (s) s.lastActivity = Date.now();
}

/** Destruye el escritorio del usuario (cierra pestañas y borra todo rastro). */
export async function destroyUserBrowser(userId: string) {
  const s = sessions.get(userId);
  const name = s?.container || containerName(userId);
  sessions.delete(userId);
  await docker(['rm', '-f', name], 90000);
}

/**
 * Espera a que KasmVNC esté listo. El sondeo se hace DENTRO del contenedor con
 * un solo `docker exec` (evita el coste de decenas de exec desde el host), así
 * el escritorio queda disponible en cuanto arranca el servidor X.
 */
export async function waitReady(session: UserBrowserSession, timeoutMs = 30000): Promise<boolean> {
  if (session.readyAt) return true;
  const status = await containerStatus(session.container);
  if (status === 'exited' || status === 'missing') return false;

  const loops = Math.max(1, Math.round(timeoutMs / 250));
  const probe = await docker(
    [
      'exec',
      session.container,
      'sh',
      '-lc',
      `i=0; while [ $i -lt ${loops} ]; do ls /tmp/.X11-unix/X* >/dev/null 2>&1 && exit 0; i=$((i+1)); sleep 0.25; done; exit 1`,
    ],
    timeoutMs + 5000
  );
  if (probe.ok) {
    session.readyAt = Date.now();
    return true;
  }
  return false;
}

/** Descarga la imagen del navegador al arrancar el API: el primer usuario ya no espera el pull. */
export async function prefetchBrowserImage() {
  const has = await docker(['image', 'inspect', IMAGE], 15000);
  if (has.ok) return;
  await docker(['pull', IMAGE], 600000);
}

/** Limpia sesiones inactivas: cierra el escritorio y libera el puerto. */
setInterval(() => {
  const limit = IDLE_MINUTES * 60_000;
  for (const [userId, s] of sessions) {
    if (Date.now() - s.lastActivity > limit) destroyUserBrowser(userId).catch(() => undefined);
  }
}, 60_000).unref?.();

export const userBrowserConfig = { IDLE_MINUTES, PORT_START, PORT_COUNT };
