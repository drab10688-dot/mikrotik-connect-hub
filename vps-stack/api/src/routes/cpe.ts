import { Router, Response, NextFunction } from 'express';
import { pool } from '../lib/db';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, mikrotikNativeRequest, getDeviceConfig, isAuthenticationError } from '../lib/mikrotik';
import { requireSection } from './isp';
import { ensureApRoute, mtCached, apsWithPppoe, formatMac, detectBrand, tenantWebPorts } from './netaccess';
import {
  CpeBrand, CpeLogin, SshAuthError, sshRun, findLogin, passwordHash, IDENTIFY, parseIdentify, BACKUP,
  setPppoeUserCmd, setPasswordCmd, SAFE_PPPOE_USER, SAFE_PASSWORD, SAFE_USERNAME,
} from '../lib/cpe-ssh';
import { withRobot, runInWebfig, WebfigAuthError } from '../lib/webfig-robot';

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
      `SELECT brand, username, ssh_port, api_port, cardinality(passwords) AS password_count, updated_at
         FROM cpe_credentials WHERE mikrotik_id = $1 ORDER BY brand`,
      [req.params.mikrotikId]
    );
    // Las claves nunca salen de la API: solo cuántas hay
    res.json({ success: true, data: BRANDS.map((b) => rows.find((r) => r.brand === b) || { brand: b, username: b === 'ubiquiti' ? 'ubnt' : 'admin', ssh_port: 22, api_port: DEFAULT_API_PORT, password_count: 0 }) });
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
  const { brand, username, ssh_port, api_port, add_password, clear_passwords } = req.body || {};
  if (!BRANDS.includes(brand)) return res.status(400).json({ success: false, error: 'Marca no válida' });
  if (!SAFE_USERNAME.test(String(username || ''))) return res.status(400).json({ success: false, error: 'Usuario no válido' });
  if (add_password !== undefined && (typeof add_password !== 'string' || !add_password || add_password.length > 128 || /[\r\n]/.test(add_password))) {
    return res.status(400).json({ success: false, error: 'Clave no válida' });
  }
  const port = Number(ssh_port) > 0 && Number(ssh_port) < 65536 ? Number(ssh_port) : 22;
  const apiPort = Number(api_port) > 0 && Number(api_port) < 65536 ? Number(api_port) : DEFAULT_API_PORT;
  try {
    await pool.query(
      `INSERT INTO cpe_credentials (tenant_id, mikrotik_id, brand, username, ssh_port, api_port, passwords)
       VALUES ($1, $2, $3, $4, $5, $8, CASE WHEN $6::text IS NULL THEN '{}'::text[] ELSE ARRAY[$6::text] END)
       ON CONFLICT (mikrotik_id, brand) DO UPDATE SET
         username = EXCLUDED.username,
         ssh_port = EXCLUDED.ssh_port,
         api_port = EXCLUDED.api_port,
         passwords = CASE
           WHEN $7 THEN COALESCE(EXCLUDED.passwords, '{}')
           WHEN $6::text IS NULL THEN cpe_credentials.passwords
           ELSE ARRAY[$6::text] || array_remove(cpe_credentials.passwords, $6::text) END,
         updated_at = now()`,
      [req.tenantId ?? null, req.params.mikrotikId, brand, username, port, add_password ?? null, Boolean(clear_passwords), apiPort]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

async function loadCredentials(mikrotikId: string): Promise<Map<CpeBrand, { username: string; port: number; apiPort: number; passwords: string[] }>> {
  const { rows } = await pool.query(`SELECT brand, username, ssh_port, api_port, passwords FROM cpe_credentials WHERE mikrotik_id = $1`, [mikrotikId]);
  return new Map(rows.map((r: any) => [r.brand, { username: r.username, port: r.ssh_port || 22, apiPort: r.api_port || DEFAULT_API_PORT, passwords: r.passwords || [] }]));
}

// ─── Lista de antenas cliente con señal ─────────────────────────
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

cpeRouter.get('/:mikrotikId/cpes', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.params.mikrotikId;
    const [activeRaw, devRes, aps] = await Promise.all([
      mtCached(mikrotikId, '/rest/ppp/active', 10000),
      pool.query(`SELECT * FROM cpe_devices WHERE mikrotik_id = $1`, [mikrotikId]),
      // La señal sale de los APs (caché 60 s); si tarda, la lista sale sin señal
      withTimeout(apsWithPppoe(req.tenantId, mikrotikId).catch(() => null), 15000),
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
      };
    }).sort((x, y) => x.pppoe_user.localeCompare(y.pppoe_user, undefined, { numeric: true }));
    res.json({ success: true, data: { cpes: list, signal_pending: !aps } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Trabajos en lote ──────────────────────────────────────────
type Action = 'identify' | 'pppoe-user' | 'password' | 'enable-api';
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

type Ctx = {
  mikrotikId: string; tenantId: string | null; action: Action; newPassword?: string;
  creds: Map<CpeBrand, { username: string; port: number; apiPort: number; passwords: string[] }>;
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
      let used: CpeLogin | null = null;
      let shot: string | undefined;
      await withRobot(async (browser) => {
        for (const login of cands) {
          try {
            const out = await runInWebfig(browser, { ip: t.ip, port: ctx.webPort, username: login.username, password: login.password, command });
            used = login;
            shot = out.shot;
            return;
          } catch (e: any) {
            if (e instanceof WebfigAuthError) continue;
            r.shot = e?.shot;
            throw new Error(`WebFig: ${e.message}`);
          }
        }
        throw new Error('Ninguna clave de la sede entra en WebFig');
      });
      // Verificación: la API debe responder con esa misma clave
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
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
      r.status = 'ok';
      r.message = [brand === 'mikrotik' ? 'MikroTik' : 'Ubiquiti', model, version, `por ${via}`].filter(Boolean).join(' · ');
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
    if (!['identify', 'pppoe-user', 'password', 'enable-api'].includes(action)) return res.status(400).json({ success: false, error: 'Acción no válida' });
    if ((action === 'password' || action === 'enable-api') && !isAdmin(req)) {
      return res.status(403).json({ success: false, error: 'Solo administradores pueden cambiar claves o activar servicios' });
    }
    // Activar API: solo desde la VPN (y redes de gestión extra que indique el admin)
    const extra = String(req.body?.allow_from || '').split(/[\s,;]+/).filter(Boolean);
    if (extra.some((n) => !CIDR.test(n))) return res.status(400).json({ success: false, error: 'Red de gestión no válida (ej: 10.10.10.0/24)' });
    const allowFrom = [VPN_NET, ...extra].join(',');
    const webPortReq = Number(req.body?.webfig_port);
    const webPort = webPortReq > 0 && webPortReq < 65536 ? webPortReq : (await tenantWebPorts(req.tenantId)).mikrotik?.port || 80;
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
    const newPassword = action === 'password' ? String(req.body?.new_password || '') : undefined;
    if (action === 'password' && !SAFE_PASSWORD.test(newPassword!)) {
      return res.status(400).json({ success: false, error: 'La clave nueva debe tener 8 a 64 caracteres: letras, números y !@#%^*()_+=.,:~-' });
    }

    const creds = await loadCredentials(mikrotikId);
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
      mikrotikId, tenantId: req.tenantId ?? null, action, newPassword, creds, promoted: new Set<CpeBrand>(),
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
    Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))
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
