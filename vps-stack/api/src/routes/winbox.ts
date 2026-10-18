import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, VISIBLE_DEVICES_SQL } from '../middleware/auth';
import { pool } from '../lib/db';
import { isolateBrowser } from '../lib/browser-fw';
import { networkScopeFor } from '../lib/networks';
import { userCanSection } from './isp';
import { resolveTenant, prepareTenantRoute } from './browser';
import { tenantWebPorts } from './netaccess';
import {
  ensureUserWinbox,
  getWinboxSession,
  getWinboxIp,
  touchWinbox,
  waitWinboxReady,
  destroyUserWinbox,
  winboxImageReady,
  userWinboxConfig,
  UserWinboxSession,
} from '../lib/user-winbox';

/**
 * WinBox remoto por usuario (permiso "winbox", aparte del escritorio VNC).
 * Nginx sirve el visor en el puerto 8082 y pregunta aquí (auth_request) a qué
 * contenedor enrutar. Cada WinBox solo alcanza las redes VPN de su ISP y los
 * routers que el usuario tiene asignados (por su IP de túnel); desde ahí el
 * técnico usa RoMON hacia las antenas MikroTik.
 */
export const winboxRouter = Router();

/** Token del panel desde ?token= o la cookie del visor (igual que browser.ts). */
function panelUserId(req: Request): string | null {
  const original = String(req.headers['x-original-uri'] || req.originalUrl || '');
  let token: string | undefined;
  try {
    token = new URL(original, 'http://local').searchParams.get('token') || undefined;
  } catch {
    /* ignore */
  }
  if (!token) {
    for (const part of (req.headers.cookie || '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === 'omnisync_web_token') token = decodeURIComponent(v.join('='));
    }
  }
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'changeme') as { userId?: string };
    return decoded?.userId || null;
  } catch {
    return null;
  }
}

/** Rol e ISP del usuario (Nginx no trae la sesión de Express). */
async function userRoleTenant(userId: string): Promise<{ role: string; tenantId: string | null }> {
  const { rows } = await pool.query(
    `SELECT u.tenant_id,
            EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role::text = 'super_admin') AS is_super,
            EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role::text = 'admin') AS is_admin
       FROM users u WHERE u.id = $1 LIMIT 1`,
    [userId],
  );
  const u = rows[0];
  return {
    role: u?.is_super ? 'super_admin' : u?.is_admin ? 'admin' : 'user',
    tenantId: u?.tenant_id || null,
  };
}

const isIp = (v: unknown): v is string => typeof v === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(v);
const isPrivate = (ip: string) => {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
};

/**
 * Routers que el usuario puede abrir en WinBox, con la IP por la que el VPS
 * los alcanza (IP del túnel L2TP; si no tiene túnel, su host si es privado).
 */
async function routersFor(userId: string, role: string, tenantId: string | null) {
  const visible =
    role === 'super_admin'
      ? (tenantId ? `SELECT id FROM mikrotik_devices WHERE tenant_id = $1` : `SELECT id FROM mikrotik_devices`)
      : VISIBLE_DEVICES_SQL;
  const params = role === 'super_admin' ? (tenantId ? [tenantId] : []) : [userId];
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.host, p.tunnel_ip
       FROM mikrotik_devices d
       LEFT JOIN tenant_vpn_peers p ON p.id = d.l2tp_peer_id AND COALESCE(p.is_active, true) = true
      WHERE d.id IN (${visible}) AND COALESCE(d.status, 'active') = 'active'
      ORDER BY d.name`,
    params,
  );
  return rows
    .map((r: any) => {
      const address = isIp(r.tunnel_ip) ? r.tunnel_ip : isIp(r.host) && isPrivate(r.host) ? r.host : null;
      return { id: r.id as string, name: r.name as string, address };
    })
    .filter((r) => !!r.address) as { id: string; name: string; address: string }[];
}

/**
 * Antenas de clientes abiertas desde el panel en el WinBox de cada usuario:
 * cada una tiene su ruta por el túnel de su sede y se permite en el firewall.
 */
const winboxTargets = new Map<string, Set<string>>();

/** Firewall del WinBox: redes VPN del ISP + IP de túnel de sus routers + antenas abiertas. */
async function isolateWinbox(s: UserWinboxSession, role: string, tenantId: string | null): Promise<boolean> {
  const ip = await getWinboxIp(s);
  if (!ip) return false;
  const scope = await networkScopeFor(role === 'super_admin' ? 'super_admin' : role, tenantId);
  const routers = await routersFor(s.userId, role, tenantId);
  const targets = [...(winboxTargets.get(s.userId) || [])];
  return isolateBrowser(s.container, ip, scope.allow, scope.pins, [...routers.map((r) => r.address), ...targets]);
}

/** Crea el WinBox del usuario si falta y le aplica el aislamiento. */
async function prepare(userId: string): Promise<UserWinboxSession> {
  const { session, created } = await ensureUserWinbox(userId);
  // WinBox nuevo = otra IP de origen: las rutas por antena anteriores ya no sirven
  if (created) winboxTargets.delete(userId);
  if (created) {
    const { role, tenantId } = await userRoleTenant(userId);
    const ok = await isolateWinbox(session, role, tenantId).catch(() => false);
    if (!ok) {
      // Sin firewall no se entrega: podría alcanzar redes de otro ISP.
      await destroyUserWinbox(userId);
      throw new Error('No se pudo aislar tu WinBox remoto; intenta de nuevo');
    }
  }
  return session;
}

/** auth_request de Nginx (8082): valida el token y enruta al WinBox propio. */
export async function authorizeUserWinbox(req: Request, res: Response) {
  const userId = panelUserId(req);
  if (!userId) return res.status(401).end();
  if (!(await userCanSection(userId, 'winbox'))) return res.status(403).end();
  try {
    // Nginx consulta en cada recurso/websocket: solo se crea si no hay sesión.
    const s = getWinboxSession(userId) || (await prepare(userId));
    touchWinbox(userId);
    if (!s.readyAt) await waitWinboxReady(s, 25000);
    // Cookie del visor: los recursos de Selkies llegan sin ?token.
    const original = String(req.headers['x-original-uri'] || '');
    const token = new URL(original, 'http://local').searchParams.get('token');
    if (token) {
      res.set('Set-Cookie', `omnisync_web_token=${encodeURIComponent(token)}; Path=/; Max-Age=43200; SameSite=Lax; Secure`);
    }
    res.set('X-VNC-Target', `http://${s.container}:3000`);
    res.set('X-VNC-Auth', `Basic ${Buffer.from(`${s.user}:${s.password}`).toString('base64')}`);
    return res.status(200).end();
  } catch {
    return res.status(503).end();
  }
}

/** Estado del WinBox propio y routers a los que puede conectarse. */
winboxRouter.get('/status', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const role = req.userRole || 'user';
    const routers = await routersFor(userId, role, req.tenantId || null);
    res.json({
      success: true,
      data: {
        running: !!getWinboxSession(userId),
        installed: await winboxImageReady(),
        idleMinutes: userWinboxConfig.IDLE_MINUTES,
        routers,
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || 'No se pudo consultar WinBox' });
  }
});

/** Prepara el WinBox antes de abrir el visor (así no espera dentro de Nginx). */
winboxRouter.post('/session', async (req: AuthRequest, res) => {
  try {
    const s = await prepare(req.userId!);
    waitWinboxReady(s).catch(() => undefined);
    res.json({ success: true, data: { running: true, idleMinutes: userWinboxConfig.IDLE_MINUTES } });
  } catch (e: any) {
    res.status(503).json({ success: false, error: e?.message || 'No se pudo iniciar tu WinBox remoto' });
  }
});

/**
 * Abre una antena de cliente en el WinBox propio. body: { mikrotikId, ip }.
 * Fija la ruta de esa IP por el túnel de su sede (desde la IP del WinBox, así
 * no la desvía una red repetida en otro túnel), la permite en el firewall y
 * devuelve "IP:puerto" con el puerto WinBox del ISP (Puertos web).
 */
winboxRouter.post('/target', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const ip = String((req as any).body?.ip || '').trim();
    const mikrotikId = typeof (req as any).body?.mikrotikId === 'string' ? (req as any).body.mikrotikId : '';
    if (!isIp(ip) || !isPrivate(ip)) return res.status(400).json({ success: false, error: 'IP no válida (solo IPs privadas)' });
    if (!mikrotikId) return res.status(400).json({ success: false, error: 'Falta el MikroTik de la sede' });
    const tenant = await resolveTenant(req, mikrotikId);
    if (tenant === false) return res.status(403).json({ success: false, error: 'No tienes acceso a ese MikroTik' });

    const session = await prepare(userId);
    const sourceIp = await getWinboxIp(session);
    const routed = await prepareTenantRoute(tenant, ip, sourceIp, mikrotikId);
    if (!routed) {
      return res.status(502).json({ success: false, error: 'No se pudo preparar la ruta por el túnel de la sede; revisa que su VPN esté conectada' });
    }
    if (!winboxTargets.has(userId)) winboxTargets.set(userId, new Set());
    winboxTargets.get(userId)!.add(ip);
    const ok = await isolateWinbox(session, req.userRole || 'user', req.tenantId || null);
    if (!ok) return res.status(502).json({ success: false, error: 'No se pudo aplicar el firewall de tu WinBox' });

    waitWinboxReady(session).catch(() => undefined);
    const port = Number((await tenantWebPorts(tenant || null)).winbox?.port) || 8291;
    res.json({ success: true, data: { address: port === 8291 ? ip : `${ip}:${port}`, idleMinutes: userWinboxConfig.IDLE_MINUTES } });
  } catch (e: any) {
    res.status(503).json({ success: false, error: e?.message || 'No se pudo abrir la antena en WinBox' });
  }
});

winboxRouter.post('/ping', (req: AuthRequest, res) => {
  touchWinbox(req.userId!);
  res.json({ success: true });
});

/** Cierra el WinBox: se borran las direcciones y claves que se hayan guardado. */
winboxRouter.post('/close', async (req: AuthRequest, res) => {
  winboxTargets.delete(req.userId!);
  await destroyUserWinbox(req.userId!);
  res.json({ success: true });
});
