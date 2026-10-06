import { Router, Response, NextFunction } from 'express';
import { connect as netConnect } from 'net';
import { pool } from '../lib/db';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, mikrotikNativeRequest, getDeviceConfig, isAuthenticationError } from '../lib/mikrotik';
import { requireSection } from './isp';
import { ensureApRoute, mtCached, apsWithPppoe, formatMac, detectBrand, tenantWebPorts } from './netaccess';
import {
  CpeBrand, CpeLogin, SshAuthError, sshRun, findLogin, passwordHash, IDENTIFY, parseIdentify, BACKUP,
  setPppoeUserCmd, setPasswordCmd, SAFE_PPPOE_USER, SAFE_PASSWORD, SAFE_USERNAME,
} from '../lib/cpe-ssh';
import { withRobot, runInWebfig, WebfigAuthError, WebfigMethod } from '../lib/webfig-robot';
import { mikrotikRowToClient, parseMikrotikTerse, parseUbiquitiSsh, signalQuality, type ApClient } from '../lib/ap-signal';

/**
 * Enlace visto DESDE la antena del cliente: su señal hacia el AP y a qué AP
 * está conectada (en modo estación la tabla de registro tiene una sola fila: el AP).
 */
async function readCpeLink(brand: CpeBrand, viaApi: boolean, ip: string, login: CpeLogin): Promise<ApClient | null> {
  if (brand === 'mikrotik' && viaApi) {
    for (const path of ['/rest/interface/wireless/registration-table', '/rest/interface/wifi/registration-table']) {
      const rows = await apiCall(ip, login, path).catch(() => null);
      if (Array.isArray(rows) && rows.length) return mikrotikRowToClient(rows[0]);
    }
    return null;
  }
  const out = await sshRun(ip, login, brand === 'mikrotik'
    ? '/interface wireless registration-table print terse without-paging'
    : 'wstalist').catch(() => '');
  const rows = brand === 'mikrotik' ? parseMikrotikTerse(out) : parseUbiquitiSsh(out);
  return rows[0] || null;
}

async function saveLink(mikrotikId: string, mac: string, link: ApClient | null): Promise<void> {
  if (!link) return;
  await pool.query(
    `UPDATE cpe_devices SET signal = $3, snr = $4, ccq = $5, tx_rate = $6, rx_rate = $7, ap_mac = $8, ap_name = $9,
            signal_at = now(), updated_at = now()
      WHERE mikrotik_id = $1 AND mac = $2`,
    [mikrotikId, mac, link.signal != null ? Math.round(link.signal) : null, link.snr != null ? Math.round(link.snr) : null,
     link.ccq != null ? Math.round(link.ccq) : null, link.tx_rate, link.rx_rate, formatMac(link.mac), link.name]
  ).catch(() => undefined);
}

const linkText = (l: ApClient | null) =>
  l ? [l.signal != null ? `${l.signal} dBm` : null, l.snr != null ? `SNR ${l.snr}` : null, l.name ? `AP ${l.name}` : null].filter(Boolean).join(' · ') : '';

// ─── MikroTik por API de RouterOS (8728) ────────────────────────
// Preferida sobre SSH: respuestas estructuradas, sin interpretar texto.
const DEFAULT_API_PORT = 8728;
const VPN_NET = process.env.L2TP_TUNNEL_NET || '192.168.42.0/24';
const CIDR = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

const apiCall = (ip: string, login: CpeLogin, path: string, method = 'GET', body?: Record<string, unknown>) =>
  mikrotikNativeRequest({ host: ip, port: login.apiPort || DEFAULT_API_PORT, username: login.username, password: login.password }, path, method, body);

/** Prueba las claves por API. 'unreachable' = la API no responde (apagada o filtrada). */
async function mikrotikApiLogin(ip: string, cands: CpeLogin[]): Promise<{ login: CpeLogin; resource: any } | 'auth' | 'unreachable'> {
  let auth = false;
  for (const login of cands) {
    try {
      const res = await apiCall(ip, login, '/rest/system/resource');
      return { login, resource: Array.isArray(res) ? res[0] : res };
    } catch (e: any) {
      if (isAuthenticationError(e) || /cooldown|rechazadas/i.test(e?.message || '')) { auth = true; continue; }
      return 'unreachable';
    }
  }
  return auth ? 'auth' : 'unreachable';
}

/**
 * Antenas de los clientes (CPE en modo router haciendo PPPoE) de una sede:
 * credenciales por sede, lista con señal y cambios en lote por SSH
 * (usuario PPPoE y clave de acceso), con copia previa y verificación.
 */
export const cpeRouter = Router();

const editRed = requireSection('red', 'edit');
const BRANDS: CpeBrand[] = ['mikrotik', 'ubiquiti'];
const asArray = (d: unknown): any[] => (Array.isArray(d) ? d : []);

cpeRouter.param('mikrotikId', async (req: AuthRequest, res: Response, next: NextFunction, id: string) => {
  try {
    if (await verifyDeviceAccess(req.userId!, req.userRole!, id)) return next();
    res.status(403).json({ success: false, error: 'Sin acceso al router' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

const isAdmin = (req: AuthRequest) => req.userRole === 'super_admin' || req.userRole === 'admin';

// ─── Credenciales de las antenas cliente por sede ───────────────
cpeRouter.get('/:mikrotikId/credentials', async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT brand, username, ssh_port, api_port, web_port, cardinality(passwords) AS password_count, updated_at
         FROM cpe_credentials WHERE mikrotik_id = $1 ORDER BY brand`,
      [req.params.mikrotikId]
    );
    const ispPorts = await tenantWebPorts(req.tenantId);
    // Las claves nunca salen de la API: solo cuántas hay. web_port vacío = el de "Puertos web" del ISP
    res.json({
      success: true,
      data: BRANDS.map((b) => ({
        ...(rows.find((r) => r.brand === b) || { brand: b, username: b === 'ubiquiti' ? 'ubnt' : 'admin', ssh_port: 22, api_port: DEFAULT_API_PORT, web_port: null, password_count: 0 }),
        isp_web_port: ispPorts[b]?.port || 80,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * body: { brand, username, ssh_port, api_port?, add_password?, clear_passwords? }.
 * add_password va al inicio de la lista (se prueba primero).
 */
cpeRouter.put('/:mikrotikId/credentials', async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Solo administradores' });
  const { brand, username, ssh_port, api_port, web_port, add_password, clear_passwords } = req.body || {};
  const webPort = Number(web_port) > 0 && Number(web_port) < 65536 ? Number(web_port) : null;
  if (!BRANDS.includes(brand)) return res.status(400).json({ success: false, error: 'Marca no válida' });
  if (!SAFE_USERNAME.test(String(username || ''))) return res.status(400).json({ success: false, error: 'Usuario no válido' });
  if (add_password !== undefined && (typeof add_password !== 'string' || !add_password || add_password.length > 128 || /[\r\n]/.test(add_password))) {
    return res.status(400).json({ success: false, error: 'Clave no válida' });
  }
  const port = Number(ssh_port) > 0 && Number(ssh_port) < 65536 ? Number(ssh_port) : 22;
  const apiPort = Number(api_port) > 0 && Number(api_port) < 65536 ? Number(api_port) : DEFAULT_API_PORT;
  try {
    await pool.query(
      `INSERT INTO cpe_credentials (tenant_id, mikrotik_id, brand, username, ssh_port, api_port, web_port, passwords)
       VALUES ($1, $2, $3, $4, $5, $8, $9, CASE WHEN $6::text IS NULL THEN '{}'::text[] ELSE ARRAY[$6::text] END)
       ON CONFLICT (mikrotik_id, brand) DO UPDATE SET
         username = EXCLUDED.username,
         ssh_port = EXCLUDED.ssh_port,
         api_port = EXCLUDED.api_port,
         web_port = EXCLUDED.web_port,
         passwords = CASE
           WHEN $7 THEN COALESCE(EXCLUDED.passwords, '{}')
           WHEN $6::text IS NULL THEN cpe_credentials.passwords
           ELSE ARRAY[$6::text] || array_remove(cpe_credentials.passwords, $6::text) END,
         updated_at = now()`,
      [req.tenantId ?? null, req.params.mikrotikId, brand, username, port, add_password ?? null, Boolean(clear_passwords), apiPort, webPort]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

type SedeCreds = { username: string; port: number; apiPort: number; webPort: number | null; passwords: string[] };

async function loadCredentials(mikrotikId: string): Promise<Map<CpeBrand, SedeCreds>> {
  const { rows } = await pool.query(`SELECT brand, username, ssh_port, api_port, web_port, passwords FROM cpe_credentials WHERE mikrotik_id = $1`, [mikrotikId]);
  return new Map(rows.map((r: any) => [r.brand, {
    username: r.username, port: r.ssh_port || 22, apiPort: r.api_port || DEFAULT_API_PORT,
    webPort: r.web_port || null, passwords: r.passwords || [],
  }]));
}

/** ¿El puerto TCP acepta conexión? (sin iniciar sesión) */
function tcpOpen(ip: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = netConnect({ host: ip, port, timeout: timeoutMs });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
  });
}

/**
 * Equipo de prueba: con la IP de una antena que se sabe que funciona, prueba
 * cada forma de entrar (API, SSH y web, cada una en su puerto) con las claves
 * de la sede y dice cuál funciona. Lo que entra queda aprendido para el lote.
 */
cpeRouter.post('/:mikrotikId/probe', editRed, async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.params.mikrotikId;
    const ip = String(req.body?.ip || '').trim();
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return res.status(400).json({ success: false, error: 'IP no válida' });
    const creds = await loadCredentials(mikrotikId);
    const ispPorts = await tenantWebPorts(req.tenantId);
    await ensureApRoute(mikrotikId, req.tenantId ?? null, ip);

    // Cliente PPPoE dueño de esa IP (para poder lanzar acciones sobre él)
    const session = (await activeSessions(mikrotikId)).find((a: any) => String(a.address) === ip);
    const mk = creds.get('mikrotik');
    const ub = creds.get('ubiquiti');
    const ports = {
      mikrotik_api: mk?.apiPort || DEFAULT_API_PORT,
      mikrotik_ssh: mk?.port || 22,
      mikrotik_web: mk?.webPort || ispPorts.mikrotik?.port || 80,
      ubiquiti_ssh: ub?.port || 22,
      ubiquiti_web: ub?.webPort || ispPorts.ubiquiti?.port || 443,
    };
    const uniq = [...new Set(Object.values(ports))];
    const open = new Map<number, boolean>(await Promise.all(uniq.map(async (p) => [p, await tcpOpen(ip, p)] as [number, boolean])));

    const checks: Array<{ method: string; port: number; open: boolean; result: 'ok' | 'clave' | 'cerrado' | 'sin-claves' | 'no-probado'; message: string }> = [];
    const cands = (c?: SedeCreds) => (c?.passwords || []).map((password) => ({ username: c!.username, password, port: c!.port, apiPort: c!.apiPort }));
    let identified: { brand: CpeBrand; model: string | null; version: string | null; via: string; login: CpeLogin } | null = null;

    // MikroTik por API
    if (!open.get(ports.mikrotik_api)) checks.push({ method: 'MikroTik API', port: ports.mikrotik_api, open: false, result: 'cerrado', message: 'Puerto cerrado o API apagada' });
    else if (!mk?.passwords.length) checks.push({ method: 'MikroTik API', port: ports.mikrotik_api, open: true, result: 'sin-claves', message: 'Puerto abierto; falta cargar la clave MikroTik' });
    else {
      const r = await mikrotikApiLogin(ip, cands(mk));
      if (typeof r === 'object') {
        identified = { brand: 'mikrotik', model: r.resource?.['board-name'] || null, version: r.resource?.version || null, via: 'API', login: r.login };
        checks.push({ method: 'MikroTik API', port: ports.mikrotik_api, open: true, result: 'ok', message: `Entra · ${[identified.model, identified.version].filter(Boolean).join(' · ')}` });
      } else checks.push({ method: 'MikroTik API', port: ports.mikrotik_api, open: true, result: r === 'auth' ? 'clave' : 'cerrado', message: r === 'auth' ? 'Ninguna clave MikroTik entra' : 'No responde como API' });
    }

    // SSH (MikroTik y Ubiquiti)
    for (const [brand, c, port] of [['mikrotik', mk, ports.mikrotik_ssh], ['ubiquiti', ub, ports.ubiquiti_ssh]] as Array<[CpeBrand, SedeCreds | undefined, number]>) {
      const label = `${brand === 'mikrotik' ? 'MikroTik' : 'Ubiquiti'} SSH`;
      if (!open.get(port)) { checks.push({ method: label, port, open: false, result: 'cerrado', message: 'Puerto cerrado o SSH apagado' }); continue; }
      if (!c?.passwords.length) { checks.push({ method: label, port, open: true, result: 'sin-claves', message: `Puerto abierto; falta cargar la clave ${brand === 'mikrotik' ? 'MikroTik' : 'Ubiquiti'}` }); continue; }
      try {
        const found = await findLogin(ip, cands(c), IDENTIFY[brand]);
        const ident = parseIdentify(found.output);
        if (ident && !identified) identified = { brand: ident.brand, model: ident.model, version: ident.version, via: 'SSH', login: found.login };
        checks.push({ method: label, port, open: true, result: 'ok', message: ident ? `Entra · ${[ident.model, ident.version].filter(Boolean).join(' · ')}` : 'Entra (no es de esta marca)' });
      } catch (e: any) {
        checks.push({ method: label, port, open: true, result: e instanceof SshAuthError ? 'clave' : 'cerrado', message: e instanceof SshAuthError ? 'La clave no entra' : e.message });
      }
    }

    // Web (WebFig / airOS): solo si responde; el robot la usa para activar la API
    checks.push({ method: 'MikroTik WebFig', port: ports.mikrotik_web, open: !!open.get(ports.mikrotik_web), result: open.get(ports.mikrotik_web) ? 'no-probado' : 'cerrado', message: open.get(ports.mikrotik_web) ? 'Responde: el robot puede activar la API por aquí' : 'Puerto cerrado' });
    if (ports.ubiquiti_web !== ports.mikrotik_web) {
      checks.push({ method: 'Ubiquiti web', port: ports.ubiquiti_web, open: !!open.get(ports.ubiquiti_web), result: open.get(ports.ubiquiti_web) ? 'no-probado' : 'cerrado', message: open.get(ports.ubiquiti_web) ? 'Responde' : 'Puerto cerrado' });
    }

    // Aprendizaje: lo que entró queda guardado para esta antena
    const mac = formatMac(session?.['caller-id']);
    if (identified && mac) {
      await pool.query(
        `INSERT INTO cpe_devices (mikrotik_id, mac, ip, pppoe_user, brand, model, version, login_hash, last_ok_at, last_error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),NULL)
         ON CONFLICT (mikrotik_id, mac) DO UPDATE SET ip = EXCLUDED.ip, pppoe_user = COALESCE(EXCLUDED.pppoe_user, cpe_devices.pppoe_user),
           brand = EXCLUDED.brand, model = COALESCE(EXCLUDED.model, cpe_devices.model), version = COALESCE(EXCLUDED.version, cpe_devices.version),
           login_hash = EXCLUDED.login_hash, last_ok_at = now(), last_error = NULL, updated_at = now()`,
        [mikrotikId, mac, ip, session?.name || null, identified.brand, identified.model, identified.version, passwordHash(identified.login.password)]
      ).catch(() => undefined);
    }

    res.json({
      success: true,
      data: {
        ip,
        target: session ? { mac, ip, pppoe_user: String(session.name) } : null,
        identified: identified ? { brand: identified.brand, model: identified.model, version: identified.version, via: identified.via } : null,
        checks,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Lista de antenas cliente con señal ─────────────────────────
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

cpeRouter.get('/:mikrotikId/cpes', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.params.mikrotikId;
    const [activeRaw, devRes, aps] = await Promise.all([
      // Sesiones PPPoE: caché; si aún no hay nada, lectura directa
      mtCached(mikrotikId, '/rest/ppp/active', 10000).then((r: any) => (asArray(r).length ? r : activeSessions(mikrotikId))),
      pool.query(`SELECT * FROM cpe_devices WHERE mikrotik_id = $1`, [mikrotikId]),
      // La señal sale de los APs (caché 60 s). Si aún no está leída, la lista sale
      // ya y la lectura sigue en segundo plano (el panel vuelve a pedir en segundos)
      withTimeout(apsWithPppoe(req.tenantId, mikrotikId).catch(() => null), 3000),
    ]);
    const devByMac = new Map<string, any>(devRes.rows.map((d: any) => [d.mac, d]));
    const signalByUser = new Map<string, any>();
    for (const ap of aps?.aps || []) {
      for (const cl of ap.clients || []) {
        const user = cl.pppoe?.user;
        if (!user || cl.pppoe?.match === 'sugerido') continue;
        signalByUser.set(String(user), {
          signal: cl.signal ?? null, snr: cl.snr ?? null, ccq: cl.ccq ?? null, quality: cl.quality || 'desconocida',
          tx_rate: cl.tx_rate ?? null, rx_rate: cl.rx_rate ?? null, ap: ap.name || ap.ip, ap_ip: ap.ip,
        });
      }
    }
    const list = asArray(activeRaw).map((a: any) => {
      const mac = formatMac(a['caller-id']);
      const dev = mac ? devByMac.get(mac) : null;
      const guess = detectBrand({ 'mac-address': mac || '' });
      return {
        pppoe_user: String(a.name),
        ip: a.address || null,
        mac,
        uptime: a.uptime || null,
        brand: dev?.brand || (guess === 'mikrotik' || guess === 'ubiquiti' ? guess : null),
        model: dev?.model || null,
        version: dev?.version || null,
        last_ok_at: dev?.last_ok_at || null,
        last_error: dev?.last_error || null,
        ...(signalByUser.get(String(a.name)) || { signal: null, snr: null, quality: 'desconocida', ap: null }),
        // Medida por la propia antena (< 30 min): tiene prioridad sobre la del AP
        ...(dev?.signal_at && Date.now() - new Date(dev.signal_at).getTime() < 30 * 60_000
          ? {
              signal: dev.signal, snr: dev.snr, ccq: dev.ccq, tx_rate: dev.tx_rate, rx_rate: dev.rx_rate,
              quality: signalQuality(dev.signal, dev.snr),
              ap: dev.ap_name || signalByUser.get(String(a.name))?.ap || dev.ap_mac,
              signal_source: 'antena', signal_at: dev.signal_at,
            }
          : { signal_source: signalByUser.has(String(a.name)) ? 'ap' : null }),
      };
    }).sort((x, y) => x.pppoe_user.localeCompare(y.pppoe_user, undefined, { numeric: true }));
    res.json({ success: true, data: { cpes: list, signal_pending: !aps } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Trabajos en lote ──────────────────────────────────────────
type Action = 'identify' | 'pppoe-user' | 'password' | 'enable-api' | 'users';
interface Target { mac: string; ip: string; pppoe_user: string; new_user?: string }
interface Result {
  mac: string; ip: string; pppoe_user: string; new_user?: string;
  status: 'pendiente' | 'ok' | 'error'; message: string;
  /** Captura (JPEG base64) de lo que vio el robot de WebFig */
  shot?: string;
}

const jobs = new Map<string, { status: 'running' | 'done'; results: Result[] }>();
const CONCURRENCY = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function activeSessions(mikrotikId: string): Promise<any[]> {
  const config = await getDeviceConfig(pool, mikrotikId);
  return asArray(await mikrotikRequest(config, '/rest/ppp/active').catch(() => []));
}

/** IP actual de la antena por su MAC (si reconectó, el PPPoE pudo darle otra). */
async function currentIp(mikrotikId: string, mac: string, fallback: string): Promise<string> {
  const s = (await activeSessions(mikrotikId)).find((a: any) => formatMac(a['caller-id']) === mac);
  return s?.address || fallback;
}

type UserSpec = { name: string; password: string };
type Ctx = {
  mikrotikId: string; tenantId: string | null; action: Action; newPassword?: string;
  users?: { admin?: UserSpec; tech?: UserSpec; demote: boolean; antireset?: boolean };
  creds: Map<CpeBrand, SedeCreds>;
  promoted: Set<CpeBrand>;
  webPort: number; allowFrom: string;
  shotTaken: { value: boolean };
};

async function processTarget(ctx: Ctx, t: Target, r: Result): Promise<void> {
  const { mikrotikId, action } = ctx;
  const mac = formatMac(t.mac);
  if (!mac || !t.ip) { r.status = 'error'; r.message = 'Sin MAC o IP (cliente desconectado)'; return; }

  const { rows: devRows } = await pool.query(`SELECT * FROM cpe_devices WHERE mikrotik_id = $1 AND mac = $2`, [mikrotikId, mac]);
  const dev = devRows[0];
  const guess = detectBrand({ 'mac-address': mac });
  const order: CpeBrand[] = dev?.brand === 'ubiquiti' || (!dev?.brand && guess === 'ubiquiti') ? ['ubiquiti', 'mikrotik'] : ['mikrotik', 'ubiquiti'];
  // Claves de una marca: primero la que ya entró en esta antena
  const candidates = (b: CpeBrand): CpeLogin[] => {
    const c = ctx.creds.get(b);
    if (!c?.passwords.length) return [];
    return [...c.passwords]
      .sort((x, y) => Number(passwordHash(y) === dev?.login_hash) - Number(passwordHash(x) === dev?.login_hash))
      .map((password) => ({ username: c.username, password, port: c.port, apiPort: c.apiPort }));
  };

  const saveDevice = (patch: Record<string, any>) => pool.query(
    `INSERT INTO cpe_devices (mikrotik_id, mac, ip, pppoe_user, brand, model, version, login_hash, last_ok_at, last_error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (mikrotik_id, mac) DO UPDATE SET
       ip = COALESCE(EXCLUDED.ip, cpe_devices.ip), pppoe_user = COALESCE(EXCLUDED.pppoe_user, cpe_devices.pppoe_user),
       brand = COALESCE(EXCLUDED.brand, cpe_devices.brand), model = COALESCE(EXCLUDED.model, cpe_devices.model),
       version = COALESCE(EXCLUDED.version, cpe_devices.version), login_hash = COALESCE(EXCLUDED.login_hash, cpe_devices.login_hash),
       last_ok_at = COALESCE(EXCLUDED.last_ok_at, cpe_devices.last_ok_at), last_error = EXCLUDED.last_error, updated_at = now()`,
    [mikrotikId, mac, patch.ip ?? null, patch.pppoe_user ?? null, patch.brand ?? null, patch.model ?? null,
     patch.version ?? null, patch.login_hash ?? null, patch.last_ok_at ?? null, patch.last_error ?? null]
  ).catch(() => undefined);

  try {
    await ensureApRoute(mikrotikId, ctx.tenantId, t.ip);

    // ── Activar la API por WebFig (MikroTik con solo WebFig/Winbox) ──
    if (action === 'enable-api') {
      const cands = candidates('mikrotik');
      if (!cands.length) throw new Error('Configura la clave de las antenas MikroTik de esta sede');
      const before = await mikrotikApiLogin(t.ip, cands);
      if (typeof before === 'object') {
        r.status = 'ok';
        r.message = 'La API ya estaba activa';
        await saveDevice({ ip: t.ip, pppoe_user: t.pppoe_user, brand: 'mikrotik', login_hash: passwordHash(before.login.password), last_ok_at: new Date(), last_error: null });
        return;
      }
      const apiPort = ctx.creds.get('mikrotik')?.apiPort || DEFAULT_API_PORT;
      const command = `/ip service set api disabled=no port=${apiPort} address=${ctx.allowFrom}`;
      // Método de escritura que ya funcionó en esta antena (se prueba primero)
      await pool.query(`ALTER TABLE cpe_devices ADD COLUMN IF NOT EXISTS webfig_method text`).catch(() => undefined);
      const saved = dev?.webfig_method;
      const preferred: WebfigMethod | undefined = saved === 'insert' ? 'insert' : (Number(saved) > 0 ? Number(saved) : undefined);
      let used: CpeLogin | null = null;
      let shot: string | undefined;
      let usedMethod: WebfigMethod | undefined;
      await withRobot(async (browser) => {
        for (const login of cands) {
          try {
            const out = await runInWebfig(browser, { ip: t.ip, port: ctx.webPort, username: login.username, password: login.password, command, preferred });
            used = login;
            shot = out.shot;
            usedMethod = out.method;
            return;
          } catch (e: any) {
            // Captura de lo que vio el robot (también cuando la clave no entra)
            r.shot = e?.shot;
            if (e instanceof WebfigAuthError) continue;
            throw new Error(`WebFig: ${e.message}`);
          }
        }
        throw new Error('Ninguna clave de la sede entra en WebFig (revisa la captura)');
      });
      // Verificación: la API debe responder con esa misma clave
      let ok = false;
      // RouterOS 6.x tarda más en levantar el servicio API: hasta ~18 s
      for (let i = 0; i < 6 && !ok; i++) {
        await sleep(3000);
        ok = typeof (await mikrotikApiLogin(t.ip, [used!])) === 'object';
      }
      // Una captura de muestra por trabajo (y siempre que falle) para revisar qué vio el robot
      if (!ctx.shotTaken.value) { r.shot = shot; ctx.shotTaken.value = true; }
      if (!ok) {
        r.shot = shot;
        throw new Error(`Se escribió el comando en WebFig pero la API no responde. Revisa la captura o el firewall de la antena (puerto ${apiPort})`);
      }
      r.status = 'ok';
      r.message = `API activada en el puerto ${apiPort} (solo desde ${ctx.allowFrom})`;
      await saveDevice({ ip: t.ip, pppoe_user: t.pppoe_user, brand: 'mikrotik', login_hash: passwordHash(used!.password), last_ok_at: new Date(), last_error: null });
      // Recuerda el método de escritura que funcionó para ir directo la próxima vez
      if (usedMethod !== undefined)
        await pool.query(`UPDATE cpe_devices SET webfig_method = $3 WHERE mikrotik_id = $1 AND mac = $2`, [mikrotikId, mac, String(usedMethod)]).catch(() => undefined);
      return;
    }

    // ── 1) Acceso: MikroTik por API; si no responde, SSH (MikroTik o Ubiquiti) ──
    let login: CpeLogin | null = null;
    let brand: CpeBrand | null = null;
    let viaApi = false;
    let model: string | null = null;
    let version: string | null = null;
    let authFailed = false;

    if (candidates('mikrotik').length && order[0] === 'mikrotik') {
      const api = await mikrotikApiLogin(t.ip, candidates('mikrotik'));
      if (typeof api === 'object') {
        login = api.login; brand = 'mikrotik'; viaApi = true;
        model = api.resource?.['board-name'] || null; version = api.resource?.version || null;
      } else if (api === 'auth') authFailed = true;
    }
    if (!login) {
      for (const b of order) {
        const cands = candidates(b);
        if (!cands.length) continue;
        try {
          const found = await findLogin(t.ip, cands, IDENTIFY[b]);
          login = found.login;
          let ident = parseIdentify(found.output);
          // Entró con las credenciales de una marca pero es la otra: se identifica con ese mismo login
          if (!ident) ident = parseIdentify(await sshRun(t.ip, login, IDENTIFY[b === 'mikrotik' ? 'ubiquiti' : 'mikrotik']).catch(() => ''));
          brand = ident?.brand || b;
          model = ident?.model || null; version = ident?.version || null;
          break;
        } catch (e: any) {
          if (e instanceof SshAuthError) { authFailed = true; continue; }
          // SSH no responde: si es MikroTik sin API, el camino es "Activar API"
          throw new Error(order[0] === 'mikrotik'
            ? 'No responde por API ni por SSH. Usa "Activar API" (WebFig) o revisa la ruta/firewall'
            : `No responde por SSH (${e.message}). Revisa la ruta de la sede o el firewall de la antena`);
        }
      }
    }
    if (!login || !brand) {
      throw new Error(authFailed ? 'Ninguna clave de la sede entra en esta antena' : 'Configura las credenciales de antenas de esta sede');
    }
    const via = viaApi ? 'API' : 'SSH';
    await saveDevice({ ip: t.ip, pppoe_user: t.pppoe_user, brand, model, version, login_hash: passwordHash(login.password), last_ok_at: new Date(), last_error: null });
    if (action === 'identify') {
      // Identificar también lee la señal desde la antena (hacia su AP)
      const link = await readCpeLink(brand, viaApi, t.ip, login).catch(() => null);
      await saveLink(mikrotikId, mac, link);
      r.status = 'ok';
      r.message = [brand === 'mikrotik' ? 'MikroTik' : 'Ubiquiti', model, version, `por ${via}`, linkText(link)].filter(Boolean).join(' · ');
      return;
    }

    // ── 2) Copia de la configuración: sin copia no se cambia nada ──
    let backup = '';
    if (viaApi) {
      const [pppoe, users] = await Promise.all([
        apiCall(t.ip, login, '/rest/interface/pppoe-client'),
        apiCall(t.ip, login, '/rest/user'),
      ]);
      backup = JSON.stringify({ via: 'api', 'interface/pppoe-client': pppoe, user: users }, null, 2);
    } else {
      backup = await sshRun(t.ip, login, BACKUP[brand], 30_000);
    }
    if (!backup.trim()) throw new Error('No se pudo respaldar la configuración: no se cambió nada');
    await pool.query(
      `INSERT INTO cpe_backups (mikrotik_id, mac, ip, pppoe_user, brand, content) VALUES ($1,$2,$3,$4,$5,$6)`,
      [mikrotikId, mac, t.ip, t.pppoe_user, brand, backup]
    );
    await pool.query(
      `DELETE FROM cpe_backups WHERE id IN (
         SELECT id FROM cpe_backups WHERE mikrotik_id = $1 AND mac = $2 ORDER BY created_at DESC OFFSET 3)`,
      [mikrotikId, mac]
    ).catch(() => undefined);

    // ── Usuarios de la antena: admin aparte, técnico y bajar al actual ──
    if (action === 'users') {
      const u = ctx.users!;
      if (brand !== 'mikrotik' || !viaApi) throw new Error('Solo MikroTik con la API activa (usa "Activar API" primero)');
      const ensureGroup = async (lg: CpeLogin, name: string, policy: string) => {
        const groups = asArray(await apiCall(t.ip, lg, '/rest/user/group'));
        const g = groups.find((x: any) => String(x.name) === name);
        if (g) await apiCall(t.ip, lg, `/rest/user/group/${encodeURIComponent(g['.id'])}`, 'PATCH', { policy });
        else await apiCall(t.ip, lg, '/rest/user/group', 'POST', { name, policy });
      };
      const upsertUser = async (lg: CpeLogin, name: string, password: string, group: string) => {
        const list = asArray(await apiCall(t.ip, lg, '/rest/user'));
        const ex = list.find((x: any) => String(x.name) === name);
        if (ex) await apiCall(t.ip, lg, `/rest/user/${encodeURIComponent(ex['.id'])}`, 'PATCH', { password, group });
        else await apiCall(t.ip, lg, '/rest/user', 'POST', { name, password, group });
      };
      const done: string[] = [];
      let lg: CpeLogin = login;
      if (u.admin) {
        await upsertUser(lg, u.admin.name, u.admin.password, 'full');
        // Verificar que el admin nuevo entra ANTES de tocar al actual
        const fresh = { ...login, username: u.admin.name, password: u.admin.password };
        const ok = await mikrotikApiLogin(t.ip, [fresh]);
        if (typeof ok !== 'object') throw new Error(`Se creó ${u.admin.name} pero no se pudo entrar con él: no se tocó el usuario actual`);
        lg = fresh;
        done.push(`admin ${u.admin.name}`);
      }
      if (u.tech) {
        // Técnico: ver señal, ping/escaneo (test) y reiniciar; sin escribir config ni ver claves
        await ensureGroup(lg, 'tecnico', 'local,ssh,read,test,reboot,winbox,web,api');
        await upsertUser(lg, u.tech.name, u.tech.password, 'tecnico');
        done.push(`técnico ${u.tech.name}`);
      }
      if (u.demote) {
        if (!u.admin) throw new Error('Para bajar al usuario actual primero crea el admin nuevo');
        // Operador: lee y escribe toda la config, pero SIN 'sensitive' las claves le salen ocultas
        await ensureGroup(lg, 'operador', 'local,ssh,read,write,test,reboot,winbox,web,api,!sensitive');
        const list = asArray(await apiCall(t.ip, lg, '/rest/user'));
        const cur = list.find((x: any) => String(x.name) === login.username);
        if (cur && login.username !== u.admin.name) {
          await apiCall(t.ip, lg, `/rest/user/${encodeURIComponent(cur['.id'])}`, 'PATCH', { group: 'operador' });
          done.push(`${login.username} → operador (sin ver claves)`);
        }
      }
      if (u.antireset) {
        // Anti-reset con rescate: el botón sigue vivo pero hay que sostenerlo 5-10 min para resetear.
        // Un técnico no lo hará, pero tú sí puedes recuperar una antena dañada (rayos) con Netinstall.
        try {
          await apiCall(t.ip, lg, '/rest/system/routerboard/settings', 'PATCH', {
            'reformat-hold-button': '5m',
            'reformat-hold-button-max': '10m',
          });
          // Verificar que quedó aplicado
          const rb = await apiCall(t.ip, lg, '/rest/system/routerboard/settings');
          if (String(rb?.['reformat-hold-button']) === '5m') done.push('anti-reset 5 min activado');
          else done.push('anti-reset: el bootloader de esta antena no lo soporta (actualiza el firmware)');
        } catch (e: any) {
          done.push(`anti-reset falló: ${e.message} (bootloader viejo — actualiza el firmware)`);
        }
      }
      if (u.admin) {
        await saveDevice({ login_hash: passwordHash(u.admin.password), last_ok_at: new Date(), last_error: null });
        // El sistema pasa a entrar con el admin nuevo (la clave vieja queda de respaldo)
        if (!ctx.promoted.has('mikrotik')) {
          ctx.promoted.add('mikrotik');
          await pool.query(
            `UPDATE cpe_credentials SET username = $3, passwords = ARRAY[$4::text] || array_remove(passwords, $4::text), updated_at = now()
              WHERE mikrotik_id = $1 AND brand = 'mikrotik'`,
            [mikrotikId, u.admin.name, u.admin.password]
          );
        }
      }
      r.status = 'ok';
      r.message = `${done.join(' · ')} · por API`;
      return;
    }

    if (action === 'pppoe-user') {
      const newUser = String(t.new_user || '').trim();
      if (viaApi) {
        const clients = asArray(JSON.parse(backup)['interface/pppoe-client']);
        if (!clients.length) throw new Error('La antena no tiene cliente PPPoE configurado');
        // Al cambiar, el PPPoE reconecta y la sesión API puede cortarse (normal)
        for (const c of clients) {
          await apiCall(t.ip, login, `/rest/interface/pppoe-client/${encodeURIComponent(c['.id'])}`, 'PATCH', { user: newUser })
            .catch(() => undefined);
        }
      } else {
        const out = await sshRun(t.ip, login, setPppoeUserCmd(brand, newUser)).catch((e) => `CORTE:${e.message}`);
        if (out.includes('SIN-PPPOE')) throw new Error('La antena no tiene cliente PPPoE configurado');
        if (out.includes('FALLO')) throw new Error('La antena no pudo guardar el cambio');
      }
      // 3) Verificación en el servidor PPPoE: debe reconectar con el usuario nuevo
      for (let i = 0; i < 18; i++) {
        await sleep(5000);
        // Debe ser ESTA antena (misma MAC): el usuario podría estar en uso en otra
        const s = (await activeSessions(mikrotikId)).find((a: any) =>
          String(a.name) === newUser && (!a['caller-id'] || formatMac(a['caller-id']) === mac));
        if (s) {
          r.status = 'ok';
          r.message = `Conectado como ${newUser}${s.address ? ` (${s.address})` : ''} · por ${via}`;
          await saveDevice({ ip: s.address || t.ip, pppoe_user: newUser, last_error: null });
          return;
        }
      }
      throw new Error(`Se cambió en la antena pero no reconectó como ${newUser} en 90 s: revisa que el usuario exista y tenga la misma clave PPPoE`);
    }

    // action === 'password'
    const newPassword = ctx.newPassword!;
    if (viaApi) {
      const u = asArray(JSON.parse(backup).user).find((x: any) => String(x.name) === login!.username);
      if (!u) throw new Error(`La antena no tiene el usuario ${login.username}`);
      await apiCall(t.ip, login, `/rest/user/${encodeURIComponent(u['.id'])}`, 'PATCH', { password: newPassword });
    } else {
      const out = await sshRun(t.ip, login, setPasswordCmd(brand, login.username, newPassword, brand === 'ubiquiti' ? backup : undefined));
      if (out.includes('SIN-USUARIO')) throw new Error(`La antena no tiene el usuario ${login.username}`);
      if (!out.includes('OK')) throw new Error('La antena no confirmó el cambio');
    }
    // 3) Verificación: entrar con la clave nueva (airOS reaplica la config ~20 s)
    await sleep(brand === 'ubiquiti' ? 25_000 : 2_000);
    let verified = false;
    for (let i = 0; i < 4 && !verified; i++) {
      const ip = await currentIp(mikrotikId, mac, t.ip);
      await ensureApRoute(mikrotikId, ctx.tenantId, ip);
      const fresh = { ...login, password: newPassword };
      verified = viaApi
        ? typeof (await mikrotikApiLogin(ip, [fresh])) === 'object'
        : await sshRun(ip, fresh, IDENTIFY[brand]).then(() => true).catch(() => false);
      if (!verified) await sleep(10_000);
    }
    if (!verified) {
      throw new Error('Se envió el cambio pero no se pudo entrar con la clave nueva. La anterior sigue en la lista de la sede como respaldo');
    }
    await saveDevice({ login_hash: passwordHash(newPassword), last_ok_at: new Date(), last_error: null });
    // La clave nueva pasa a ser la primera de la sede (la vieja queda de respaldo)
    if (!ctx.promoted.has(brand)) {
      ctx.promoted.add(brand);
      await pool.query(
        `UPDATE cpe_credentials SET passwords = ARRAY[$3::text] || array_remove(passwords, $3::text), updated_at = now()
          WHERE mikrotik_id = $1 AND brand = $2`,
        [mikrotikId, brand, newPassword]
      );
    }
    r.status = 'ok';
    r.message = `Clave cambiada y verificada · por ${via}`;
  } catch (e: any) {
    r.status = 'error';
    r.message = e?.message || String(e);
    await saveDevice({ last_error: r.message });
  }
}

/**
 * body: { action: 'identify' | 'pppoe-user' | 'password', targets: [{mac, ip, pppoe_user, new_user?}], new_password? }
 * Corre en segundo plano; el panel consulta GET /jobs/:id.
 */
cpeRouter.post('/:mikrotikId/jobs', editRed, async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.params.mikrotikId;
    const action = req.body?.action as Action;
    if (!['identify', 'pppoe-user', 'password', 'enable-api', 'users'].includes(action)) return res.status(400).json({ success: false, error: 'Acción no válida' });
    if ((action === 'password' || action === 'enable-api' || action === 'users') && !isAdmin(req)) {
      return res.status(403).json({ success: false, error: 'Solo administradores pueden cambiar claves o activar servicios' });
    }
    // Activar API: solo desde la VPN (y redes de gestión extra que indique el admin)
    const extra = String(req.body?.allow_from || '').split(/[\s,;]+/).filter(Boolean);
    if (extra.some((n) => !CIDR.test(n))) return res.status(400).json({ success: false, error: 'Red de gestión no válida (ej: 10.10.10.0/24)' });
    const allowFrom = [VPN_NET, ...extra].join(',');
    const webPortReq = Number(req.body?.webfig_port);
    // Puerto de WebFig: el pedido, el de la sede o el de "Puertos web" del ISP
    const sedeCreds = await loadCredentials(mikrotikId);
    const webPort = webPortReq > 0 && webPortReq < 65536 ? webPortReq
      : sedeCreds.get('mikrotik')?.webPort || (await tenantWebPorts(req.tenantId)).mikrotik?.port || 80;
    const targets: Target[] = asArray(req.body?.targets).slice(0, 300).map((t: any) => ({
      mac: String(t?.mac || ''), ip: String(t?.ip || ''), pppoe_user: String(t?.pppoe_user || ''),
      new_user: t?.new_user ? String(t.new_user).trim() : undefined,
    }));
    if (!targets.length) return res.status(400).json({ success: false, error: 'Selecciona al menos una antena' });
    if (targets.some((t) => !/^(\d{1,3}\.){3}\d{1,3}$/.test(t.ip))) return res.status(400).json({ success: false, error: 'Hay antenas sin IP válida' });
    if (action === 'pppoe-user') {
      const bad = targets.filter((t) => !t.new_user || !SAFE_PPPOE_USER.test(t.new_user));
      if (bad.length) return res.status(400).json({ success: false, error: `Usuario nuevo vacío o no válido para: ${bad.map((b) => b.pppoe_user).join(', ')}` });
    }
    let users: Ctx['users'];
    if (action === 'users') {
      const SAFE_NAME = /^[A-Za-z0-9._-]{3,32}$/;
      const parse = (o: any): UserSpec | undefined => (o?.name ? { name: String(o.name).trim(), password: String(o.password || '') } : undefined);
      const admin = parse(req.body?.admin), tech = parse(req.body?.tech);
      for (const s of [admin, tech]) {
        if (s && (!SAFE_NAME.test(s.name) || !SAFE_PASSWORD.test(s.password))) {
          return res.status(400).json({ success: false, error: 'Usuario (3-32: letras, números . _ -) o clave (8-64) no válidos' });
        }
      }
      const demote = !!req.body?.demote_current;
      const antireset = !!req.body?.anti_reset;
      if (demote && !admin) return res.status(400).json({ success: false, error: 'Para bajar al usuario actual crea también el admin nuevo' });
      if (!admin && !tech && !antireset) return res.status(400).json({ success: false, error: 'Indica el admin nuevo, el técnico o el anti-reset' });
      users = { admin, tech, demote, antireset };
    }
    const newPassword = action === 'password' ? String(req.body?.new_password || '') : undefined;
    if (action === 'password' && !SAFE_PASSWORD.test(newPassword!)) {
      return res.status(400).json({ success: false, error: 'La clave nueva debe tener 8 a 64 caracteres: letras, números y !@#%^*()_+=.,:~-' });
    }

    const creds = sedeCreds;
    const results: Result[] = targets.map((t) => ({ mac: t.mac, ip: t.ip, pppoe_user: t.pppoe_user, new_user: t.new_user, status: 'pendiente', message: 'En cola' }));
    const { rows } = await pool.query(
      `INSERT INTO cpe_jobs (tenant_id, mikrotik_id, user_id, action, results) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.tenantId ?? null, mikrotikId, req.userId ?? null, action, JSON.stringify(results)]
    );
    const jobId = rows[0].id as string;
    jobs.set(jobId, { status: 'running', results });
    res.status(202).json({ success: true, data: { job_id: jobId } });

    // Segundo plano, de a CONCURRENCY antenas
    const ctx: Ctx = {
      mikrotikId, tenantId: req.tenantId ?? null, action, newPassword, users, creds, promoted: new Set<CpeBrand>(),
      webPort, allowFrom, shotTaken: { value: false },
    };
    let next = 0;
    const worker = async () => {
      while (next < targets.length) {
        const i = next++;
        results[i].message = 'Procesando…';
        await processTarget(ctx, targets[i], results[i]);
      }
    };
    // Activar API va de UNA en UNA: el robot de WebFig se satura con varias a la vez
    // enable-api va de a 3: la escritura ya es verificada y cada antena es independiente
    const lanes = action === 'enable-api' ? 3 : CONCURRENCY;
    Promise.all(Array.from({ length: Math.min(lanes, targets.length) }, worker))
      .catch((e) => console.error('[CPE] job:', e?.message))
      .finally(async () => {
        jobs.get(jobId)!.status = 'done';
        await pool.query(`UPDATE cpe_jobs SET status = 'done', results = $2, finished_at = now() WHERE id = $1`, [jobId, JSON.stringify(results)])
          .catch(() => undefined);
        setTimeout(() => jobs.delete(jobId), 30 * 60_000);
      });
  } catch (error: any) {
    if (!res.headersSent) res.status(500).json({ success: false, error: error.message });
  }
});

cpeRouter.get('/:mikrotikId/jobs/:jobId', async (req: AuthRequest, res: Response) => {
  const live = jobs.get(req.params.jobId);
  if (live) return res.json({ success: true, data: { status: live.status, results: live.results } });
  const { rows } = await pool.query(
    `SELECT status, results FROM cpe_jobs WHERE id = $1 AND mikrotik_id = $2`,
    [req.params.jobId, req.params.mikrotikId]
  ).catch(() => ({ rows: [] as any[] }));
  if (!rows[0]) return res.status(404).json({ success: false, error: 'Trabajo no encontrado' });
  res.json({ success: true, data: rows[0] });
});

/** Historial: quién cambió qué y cuándo (sin claves). */
cpeRouter.get('/:mikrotikId/jobs', async (req: AuthRequest, res: Response) => {
  const { rows } = await pool.query(
    `SELECT j.id, j.action, j.status, j.created_at, j.finished_at, u.email AS user_email,
            jsonb_array_length(j.results) AS total,
            (SELECT count(*) FROM jsonb_array_elements(j.results) x WHERE x->>'status' = 'ok') AS ok
       FROM cpe_jobs j LEFT JOIN users u ON u.id = j.user_id
      WHERE j.mikrotik_id = $1 ORDER BY j.created_at DESC LIMIT 20`,
    [req.params.mikrotikId]
  ).catch(() => ({ rows: [] as any[] }));
  res.json({ success: true, data: rows });
});

// ─── Señal desde las antenas, cada 15 min (server.ts) ───────────
let refreshing = false;

/**
 * Relee la señal de cada antena ya identificada y conectada, entrando con la
 * clave que se sabe que funciona (login_hash). MikroTik por API y si no por
 * SSH; Ubiquiti por SSH. No cambia nada en las antenas.
 */
export async function refreshCpeSignals(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const { rows: sedes } = await pool.query(
      `SELECT DISTINCT c.mikrotik_id, d.tenant_id
         FROM cpe_credentials c JOIN mikrotik_devices d ON d.id = c.mikrotik_id
        WHERE cardinality(c.passwords) > 0`
    );
    for (const sede of sedes) {
      const creds = await loadCredentials(sede.mikrotik_id);
      const ipByMac = new Map<string, string>();
      for (const a of await activeSessions(sede.mikrotik_id)) {
        const m = formatMac(a['caller-id']);
        if (m && a.address) ipByMac.set(m, String(a.address));
      }
      const { rows: devs } = await pool.query(
        `SELECT mac, brand, login_hash FROM cpe_devices
          WHERE mikrotik_id = $1 AND brand IS NOT NULL AND login_hash IS NOT NULL`,
        [sede.mikrotik_id]
      );
      const work = devs.filter((d: any) => ipByMac.has(d.mac));
      let next = 0;
      const worker = async () => {
        while (next < work.length) {
          const d = work[next++];
          const c = creds.get(d.brand);
          const password = c?.passwords.find((p) => passwordHash(p) === d.login_hash);
          if (!c || !password) continue;
          const ip = ipByMac.get(d.mac)!;
          const login: CpeLogin = { username: c.username, password, port: c.port, apiPort: c.apiPort };
          try {
            await ensureApRoute(sede.mikrotik_id, sede.tenant_id, ip);
            let link = d.brand === 'mikrotik' ? await readCpeLink('mikrotik', true, ip, login) : null;
            if (!link) link = await readCpeLink(d.brand, false, ip, login);
            await saveLink(sede.mikrotik_id, d.mac, link);
          } catch { /* antena sin respuesta: se reintenta en la próxima vuelta */ }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, work.length) }, worker));
    }
  } finally {
    refreshing = false;
  }
}
