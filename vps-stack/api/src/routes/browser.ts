import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { pool } from '../lib/db';
import { ensureL2tpTargetRoute } from '../lib/l2tp';
import { isolateBrowser } from '../lib/browser-fw';
import { NetworkScope, networkScopeFor, ipAllowed, ipInCidr, parseCidr, splitNetworks } from '../lib/networks';
import {
  ensureUserBrowser,
  getUserBrowserIp,
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

/** Extrae el token del panel desde ?token= o la cookie del proxy web. */
function extractToken(req: Request): string | undefined {
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
  return token;
}

function verifyPanelToken(token?: string): string | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'changeme') as { userId?: string };
    return decoded?.userId || null;
  } catch {
    return null;
  }
}

/**
 * Siembra la cookie `omnisync_web_token` cuando el token llegó por la URL.
 * KasmVNC pide sus recursos (/src/..., /icon.png, /websockify) SIN el query
 * token; sin cookie esos requests reciben 401 y el visor queda en blanco.
 * Nginx propaga este Set-Cookie al navegador vía auth_request_set.
 */
function seedAuthCookie(req: Request, res: Response, token: string) {
  const original = String(req.headers['x-original-uri'] || req.originalUrl || '');
  let fromQuery = false;
  try {
    fromQuery = new URL(original, 'http://local').searchParams.get('token') === token;
  } catch {
    /* ignore */
  }
  if (fromQuery) {
    res.set(
      'Set-Cookie',
      `omnisync_web_token=${encodeURIComponent(token)}; Path=/; Max-Age=43200; SameSite=Lax; Secure`,
    );
  }
}

/**
 * Autoriza el acceso a los escritorios servidos por Nginx (Winbox 8082 y el
 * navegador global heredado 8081) mediante auth_request.
 */
export async function authorizeBrowserAccess(req: Request, res: Response) {
  const token = extractToken(req);
  const userId = verifyPanelToken(token);
  if (!userId) return res.status(401).end();
  seedAuthCookie(req, res, token!);
  touchSession(userId);
  return res.status(200).end();
}

/**
 * Autorización del escritorio PRIVADO por usuario (Nginx 8081).
 * Valida el token del panel, garantiza que el contenedor del usuario exista y
 * devuelve a Nginx a qué contenedor enrutar y con qué credenciales internas —
 * así el navegador NUNCA muestra el cuadro de usuario/clave.
 */
export async function authorizeUserVnc(req: Request, res: Response) {
  const token = extractToken(req);
  const userId = verifyPanelToken(token);
  if (!userId) return res.status(401).end();
  seedAuthCookie(req, res, token!);
  try {
    let s = getSession(userId);
    if (!s) {
      s = await ensureUserBrowser(userId);
      await isolate(s, await userScope(userId)).catch(() => false);
    }
    touchSession(userId);
    if (!s.readyAt) await waitReady(s, 20000);
    res.set('X-VNC-Target', `http://${s.container}:3000`);
    res.set('X-VNC-Auth', `Basic ${Buffer.from(`${s.user}:${s.password}`).toString('base64')}`);
    return res.status(200).end();
  } catch {
    return res.status(503).end();
  }
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

/**
 * ISP efectivo de la apertura. El superadministrador no tiene tenant_id en su
 * sesión: en ese caso se resuelve desde el MikroTik que originó la apertura.
 * Devuelve `false` si el usuario no puede usar ese MikroTik.
 */
async function resolveTenant(req: AuthRequest, mikrotikId?: string): Promise<string | null | false> {
  let tenantId = req.tenantId || null;
  if (mikrotikId) {
    const allowed = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!allowed) return false;
    const device = await pool.query(`SELECT tenant_id FROM mikrotik_devices WHERE id = $1 LIMIT 1`, [mikrotikId]);
    const deviceTenantId = device.rows[0]?.tenant_id || null;
    if (tenantId && deviceTenantId && tenantId !== deviceTenantId) return false;
    tenantId = deviceTenantId || tenantId;
  }
  return tenantId;
}

async function prepareTenantRoute(tenantId: string | null, targetIp: string, sourceIp: string | null, mikrotikId?: string): Promise<boolean> {
  let tunnelIp: string | undefined;
  if (mikrotikId) {
    const { rows } = await pool.query(
      `SELECT p.tunnel_ip
         FROM mikrotik_devices d
         JOIN tenant_vpn_peers p ON p.id = d.l2tp_peer_id
        WHERE d.id = $1 AND COALESCE(p.is_active, true) = true AND p.tunnel_ip IS NOT NULL
        LIMIT 1`,
      [mikrotikId],
    );
    tunnelIp = rows[0]?.tunnel_ip;
  } else {
    // Sin MikroTik: el túnel es el del router que declaró la red de la IP.
    const { rows } = await pool.query(
      `SELECT tunnel_ip, onu_networks
         FROM tenant_vpn_peers
        WHERE ($1::uuid IS NULL OR tenant_id = $1)
          AND COALESCE(is_active, true) = true AND tunnel_ip IS NOT NULL
        ORDER BY updated_at DESC NULLS LAST, created_at DESC`,
      [tenantId],
    );
    const owner = rows.find((r: any) =>
      splitNetworks(r.onu_networks).some((n) => {
        const c = parseCidr(n);
        return !!c && ipInCidr(targetIp, c);
      }),
    );
    tunnelIp = (owner || rows[0])?.tunnel_ip;
  }
  if (!tunnelIp) return false;
  return ensureL2tpTargetRoute(String(tunnelIp), targetIp, sourceIp || undefined);
}

/** Rol e ISP de un usuario (para escritorios creados desde Nginx, sin req.tenantId). */
async function userScope(userId: string) {
  let role: string | undefined;
  let tenantId: string | null = null;
  try {
    const { rows } = await pool.query(
      `SELECT u.tenant_id,
              EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role::text = 'super_admin') AS is_super
         FROM users u WHERE u.id = $1 LIMIT 1`,
      [userId],
    );
    tenantId = rows[0]?.tenant_id || null;
    if (rows[0]?.is_super) role = 'super_admin';
  } catch {
    /* sin ISP ni rol: sólo su subred */
  }
  return networkScopeFor(role, tenantId);
}

/** Aplica el firewall del escritorio: sólo las redes del ISP (+ IP puntual). */
async function isolate(session: UserBrowserSession, scope: NetworkScope, extra: string[] = []): Promise<boolean> {
  const ip = await getUserBrowserIp(session);
  if (!ip) return false;
  return isolateBrowser(session.container, ip, scope.allow, scope.deny, extra);
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
    await isolate(s, await networkScopeFor(req.userRole, req.tenantId || null)).catch(() => false);
    // No bloqueamos la respuesta: el visor abre de inmediato y KasmVNC termina
    // de levantar mientras carga la pestaña.
    waitReady(s).catch(() => undefined);
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

  // La IP/puerto se pasa como PÁGINA DE INICIO: si el equipo cambió, el
  // contenedor se recrea y Chromium arranca ya cargando esa URL (como antes).
  // Desde celular se arranca el escritorio en resolución de teléfono (vertical):
  // así la pantalla cabe completa y se puede leer, hacer zoom y escribir.
  const mobile = (req as any).body?.mobile === true;
  const resolution = mobile ? '412x780' : undefined;
  const mikrotikId = typeof (req as any).body?.mikrotikId === 'string' ? (req as any).body.mikrotikId : undefined;
  const targetIp = new URL(url).hostname;

  // Aislamiento multi-ISP: sólo IPs de las redes VPN del propio ISP. Los
  // equipos descubiertos por un MikroTik del ISP (APs fuera de sus redes) se
  // permiten porque viajan por la tabla de rutas propia de ese túnel.
  const tenantId = await resolveTenant(req, mikrotikId);
  if (tenantId === false) {
    return res.status(403).json({ success: false, error: 'No tienes acceso a ese MikroTik' });
  }
  const scope = await networkScopeFor(req.userRole, tenantId);
  if (!mikrotikId && !ipAllowed(targetIp, scope)) {
    return res.status(403).json({
      success: false,
      error: `La IP ${targetIp} no pertenece a las redes VPN de tu ISP. Agrégala en ISP → VPN (redes de ONUs/LAN).`,
    });
  }

  let session: UserBrowserSession;
  try {
    session = await ensureUserBrowser(userId, url, { resolution, routeKey: mikrotikId });
  } catch (e: any) {
    return res.status(503).json({ success: false, error: e?.message || 'No se pudo iniciar tu escritorio remoto' });
  }

  // La ruta y el firewall se instalan DESPUÉS de crear el contenedor para
  // aislarlos por su IP origen. Así dos sesiones con el mismo destino LAN no
  // se pisan y ningún escritorio ve redes de otro ISP.
  let routeWarning: string | undefined;
  let routeReady = false;
  try {
    const sourceIp = await getUserBrowserIp(session);
    routeReady = await prepareTenantRoute(tenantId, targetIp, sourceIp, mikrotikId);
    if (!routeReady) routeWarning = 'No se pudo confirmar la ruta VPN seleccionada; revisa que el túnel L2TP esté conectado.';
  } catch (e: any) {
    routeWarning = e?.message || 'No se pudo preparar la ruta VPN hacia el equipo';
  }
  try {
    // La IP puntual sólo se abre si quedó fijada al túnel del MikroTik elegido.
    const extra = mikrotikId && routeReady ? [targetIp] : [];
    const isolated = await isolate(session, scope, extra);
    if (!isolated) routeWarning = routeWarning || 'No se pudo aplicar el firewall del escritorio remoto.';
  } catch (e: any) {
    routeWarning = routeWarning || e?.message || 'No se pudo aplicar el firewall del escritorio remoto';
  }

  touchSession(userId);
  // El visor abre enseguida; KasmVNC muestra el escritorio en cuanto el
  // contenedor termina de arrancar. No bloqueamos la respuesta.
  waitReady(session, 30000).catch(() => undefined);

  return res.json({ success: true, data: { url, method: 'launch-url', warning: routeWarning, ...publicSession(session) } });
});
