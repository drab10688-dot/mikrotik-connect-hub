import { Router, Response } from 'express';
import http from 'http';
import https from 'https';
import { AuthRequest, verifyDeviceAccess, WEB_TOKEN_COOKIE } from '../middleware/auth';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { readApClients, signalQuality, type ApTarget } from '../lib/ap-signal';
import { ensureL2tpTargetRoute } from '../lib/l2tp';
import { pool } from '../lib/db';
import { requireSection } from './isp';
import { swr, keepWarm } from '../lib/cache';

/**
 * Garantiza que exista ruta por el túnel L2TP del ISP hacia la IP del AP
 * antes de leer su señal. Sin esto la lectura falla con EHOSTUNREACH aunque
 * la VPN esté conectada y las credenciales sean correctas.
 */
async function ensureApRoute(mikrotikId: string, tenantId: string | null | undefined, ip: string): Promise<void> {
  try {
    let tId = tenantId ?? null;
    if (!tId) {
      const device = await pool.query(`SELECT tenant_id FROM mikrotik_devices WHERE id = $1 LIMIT 1`, [mikrotikId]);
      tId = device.rows[0]?.tenant_id ?? null;
    }
    const { rows } = await pool.query(
      `SELECT tunnel_ip
         FROM tenant_vpn_peers
        WHERE ($1::uuid IS NULL OR tenant_id = $1)
          AND COALESCE(is_active, true) = true AND tunnel_ip IS NOT NULL
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
        LIMIT 1`,
      [tId]
    );
    const tunnelIp = rows[0]?.tunnel_ip;
    if (tunnelIp) await ensureL2tpTargetRoute(String(tunnelIp), ip);
  } catch { /* mejor esfuerzo: la lectura igual se intenta */ }
}

/**
 * Lectura cacheada contra la MikroTik.
 * Devuelve al instante el último resultado conocido y refresca en segundo plano,
 * para que las tablas no queden vacías cuando la VPN responde lento.
 */
async function mtCached(mikrotikId: string, path: string, ttlMs = 20000): Promise<any> {
  const key = `net:${mikrotikId}:${path}`;
  const loader = async () => {
    const config = await getDeviceConfig(pool, mikrotikId);
    return mikrotikRequest(config, path);
  };
  // Se mantiene caliente: el refresco ocurre solo, así la respuesta al panel
  // es inmediata aunque la VPN esté lenta.
  keepWarm(key, loader, ttlMs);
  return swr(key, loader, { ttlMs, maxAgeMs: 30 * 60_000 }).catch(() => []);
}



const editRed = requireSection('red', true);

export const netAccessRouter = Router();

/** Puertos web por marca (configurable por ISP). */
export const DEFAULT_WEB_PORTS: Record<string, { port: number; protocol: 'http' | 'https' }> = {
  mikrotik: { port: 80, protocol: 'http' },
  ubiquiti: { port: 443, protocol: 'https' },
  mimosa: { port: 443, protocol: 'https' },
  cambium: { port: 443, protocol: 'https' },
  tplink: { port: 80, protocol: 'http' },
  huawei: { port: 80, protocol: 'http' },
  vsol: { port: 80, protocol: 'http' },
  otro: { port: 80, protocol: 'http' },
};

const UBIQUITI_OUIS = [
  '0015 6D', '0418 D6', '2 4A4 3C', '24A4 3C', '788A 20', '6872 51', '44D9 E7',
  'DC9F DB', 'F09F C2', '7483 C2', '802A A8', 'B4FB E4', '18E8 29', '74AC B9',
  'E063 DA', 'FC EC DA', '0027 22', '68D7 9A', '245A 4C', '9803 9B',
].map((o) => o.replace(/\s+/g, '').toUpperCase());

const MIKROTIK_OUIS = ['4C5E0C', '6C3B6B', '2CC81B', 'E48D8C', '000C42', '18FD74', '48A98A', '744D28', 'DC2C6E', 'B869F4'];

function normalizeMac(mac?: string) {
  return String(mac || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

export function detectBrand(entry: Record<string, any>): string {
  const mac = normalizeMac(entry['mac-address'] || entry['active-mac-address']);
  const text = [
    entry.identity, entry.platform, entry.board, entry['system-description'],
    entry['system-caps'], entry.comment, entry['host-name'],
  ].filter(Boolean).join(' ').toLowerCase();

  if (/ubiquiti|ubnt|airmax|airos|nanostation|litebeam|powerbeam|rocket|unifi|nanobeam/.test(text)) return 'ubiquiti';
  if (/mikrotik|routeros/.test(text)) return 'mikrotik';
  if (/mimosa/.test(text)) return 'mimosa';
  if (/cambium|epmp/.test(text)) return 'cambium';
  if (/tp-?link|tplink|pharos/.test(text)) return 'tplink';
  if (/huawei/.test(text)) return 'huawei';
  if (/v-?sol|vsol/.test(text)) return 'vsol';

  if (UBIQUITI_OUIS.some((oui) => mac.startsWith(oui))) return 'ubiquiti';
  if (MIKROTIK_OUIS.some((oui) => mac.startsWith(oui))) return 'mikrotik';
  return 'otro';
}

async function tenantWebPorts(tenantId?: string | null) {
  const ports = { ...DEFAULT_WEB_PORTS };
  if (!tenantId) return ports;
  try {
    const { rows } = await pool.query(`SELECT web_ports FROM tenants WHERE id = $1`, [tenantId]);
    const custom = rows[0]?.web_ports;
    if (custom && typeof custom === 'object') {
      for (const [brand, cfg] of Object.entries(custom as Record<string, any>)) {
        if (!cfg) continue;
        ports[brand] = {
          port: Number(cfg.port) > 0 ? Number(cfg.port) : (ports[brand]?.port ?? 80),
          protocol: cfg.protocol === 'https' ? 'https' : 'http',
        };
      }
    }
  } catch {
    /* columna aún no creada */
  }
  return ports;
}

async function guard(req: AuthRequest, res: Response) {
  const { mikrotikId } = req.params as { mikrotikId: string };
  const ok = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
  if (!ok) {
    res.status(403).json({ success: false, error: 'Sin acceso al router' });
    return null;
  }
  return mikrotikId;
}

const asArray = (data: unknown): any[] => (Array.isArray(data) ? data : []);

// ─── Puertos web configurados por ISP ───────────────────────────
netAccessRouter.get('/web-ports', async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await tenantWebPorts(req.tenantId) });
});

netAccessRouter.put('/web-ports', editRed, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.tenantId) return res.status(400).json({ success: false, error: 'Tu usuario no pertenece a ningún ISP' });
    if (req.userRole !== 'super_admin' && req.userRole !== 'admin') {
      return res.status(403).json({ success: false, error: 'Solo administradores' });
    }
    const incoming = req.body?.web_ports ?? req.body;
    await pool.query(`UPDATE tenants SET web_ports = $2::jsonb, updated_at = now() WHERE id = $1`, [
      req.tenantId,
      JSON.stringify(incoming || {}),
    ]);
    res.json({ success: true, data: await tenantWebPorts(req.tenantId) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Credenciales de los APs/antenas (por ISP) ──────────────────
netAccessRouter.get('/ap-credentials', async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, ip, name, brand, username, port, protocol, access_method, ssh_port, sector
         FROM ap_credentials
        WHERE tenant_id IS NOT DISTINCT FROM $1
        ORDER BY ip`,
      [req.tenantId ?? null]
    );
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

netAccessRouter.put('/ap-credentials', editRed, async (req: AuthRequest, res: Response) => {
  try {
    const { ip, name, brand, username, password, port, protocol, access_method, ssh_port, sector } = req.body || {};
    if (!ip || !IPV4.test(String(ip))) {
      return res.status(400).json({ success: false, error: 'IP del AP inválida' });
    }
    const { rows } = await pool.query(
      `INSERT INTO ap_credentials (tenant_id, ip, name, brand, username, password, port, protocol, access_method, ssh_port, sector)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (tenant_id, ip) DO UPDATE SET
         name = EXCLUDED.name,
         sector = EXCLUDED.sector,
         brand = EXCLUDED.brand,
         username = EXCLUDED.username,
         password = COALESCE(NULLIF(EXCLUDED.password, ''), ap_credentials.password),
         port = EXCLUDED.port,
         protocol = EXCLUDED.protocol,
         access_method = EXCLUDED.access_method,
         ssh_port = EXCLUDED.ssh_port,
         updated_at = now()
       RETURNING id, ip, name, brand, username, port, protocol, access_method, ssh_port, sector`,
      [
        req.tenantId ?? null,
        String(ip),
        name || null,
        brand || 'otro',
        username || null,
        password || '',
        Number(port) > 0 ? Number(port) : null,
        protocol === 'https' ? 'https' : 'http',
        ['auto', 'web', 'ssh'].includes(access_method) ? access_method : 'auto',
        Number(ssh_port) > 0 ? Number(ssh_port) : 22,
        sector || null,
      ]
    );
    res.json({ success: true, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

netAccessRouter.delete('/ap-credentials/:id', editRed, async (req: AuthRequest, res: Response) => {
  try {
    await pool.query(`DELETE FROM ap_credentials WHERE id = $1 AND tenant_id IS NOT DISTINCT FROM $2`, [
      req.params.id,
      req.tenantId ?? null,
    ]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

async function apTarget(tenantId: string | null | undefined, ip: string, brandHint?: string): Promise<ApTarget> {
  const ports = await tenantWebPorts(tenantId);
  const { rows } = await pool.query(
    `SELECT ip, brand, username, password, port, protocol, access_method, ssh_port
       FROM ap_credentials WHERE tenant_id IS NOT DISTINCT FROM $1 AND ip = $2`,
    [tenantId ?? null, ip]
  );
  const saved = rows[0];
  const brand = (saved?.brand || brandHint || 'otro') as string;
  const fallback = ports[brand] || ports.otro;
  return {
    ip,
    brand,
    port: saved?.port || fallback.port,
    protocol: (saved?.protocol || fallback.protocol) as 'http' | 'https',
    username: saved?.username || (brand === 'ubiquiti' ? 'ubnt' : 'admin'),
    password: saved?.password || '',
    accessMethod: saved?.access_method || 'auto',
    sshPort: saved?.ssh_port || 22,
  };
}

// Clientes/señal leídos directamente desde un AP detrás del router
netAccessRouter.get('/:mikrotikId/ap/:ip/clients', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = await guard(req, res);
    if (!mikrotikId) return;

    const ip = String(req.params.ip);
    if (!IPV4.test(ip)) return res.status(400).json({ success: false, error: 'IP inválida' });

    const target = await apTarget(req.tenantId, ip, String(req.query.brand || ''));
    await ensureApRoute(mikrotikId, req.tenantId, ip);
    const clients = await readApClients(target);
    res.json({
      success: true,
      data: {
        ip,
        brand: target.brand,
        port: target.port,
        protocol: target.protocol,
        total: clients.length,
        clients,
      },
    });
  } catch (error: any) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// ─── Lectura automática de TODOS los APs (sin registrar nada) ───
// Descubre antenas desde la MikroTik (neighbors/ARP/DHCP) y prueba
// credenciales típicas por marca hasta obtener la tabla de clientes.
const DEFAULT_LOGINS: Record<string, Array<{ username: string; password: string }>> = {
  ubiquiti: [
    { username: 'ubnt', password: 'ubnt' },
    { username: 'admin', password: 'admin' },
    { username: 'admin', password: '' },
  ],
  mikrotik: [
    { username: 'admin', password: '' },
    { username: 'admin', password: 'admin' },
  ],
  otro: [
    { username: 'admin', password: 'admin' },
    { username: 'admin', password: '' },
    { username: 'ubnt', password: 'ubnt' },
  ],
};

async function autoReadAp(
  tenantId: string | null | undefined,
  ip: string,
  brandHint: string,
  ports: Record<string, { port: number; protocol: 'http' | 'https' }>,
  saved?: any,
  mikrotikId?: string
) {
  if (mikrotikId) await ensureApRoute(mikrotikId, tenantId, ip);
  const brand = (saved?.brand && saved.brand !== 'otro' ? saved.brand : brandHint) || 'otro';
  const cfg = ports[brand] || ports.otro;
  const candidates: Array<{ username: string; password: string; port: number; protocol: 'http' | 'https'; accessMethod?: 'auto' | 'web' | 'ssh'; sshPort?: number }> = [];

  if (saved?.username) {
    candidates.push({
      username: saved.username,
      password: saved.password || '',
      port: saved.port || cfg.port,
      protocol: (saved.protocol || cfg.protocol) as 'http' | 'https',
      accessMethod: saved.access_method || 'auto',
      sshPort: saved.ssh_port || 22,
    });
  }
  const logins = DEFAULT_LOGINS[brand] || DEFAULT_LOGINS.otro;
  const transports: Array<{ port: number; protocol: 'http' | 'https' }> =
    brand === 'ubiquiti'
      ? [{ port: cfg.port, protocol: cfg.protocol }, { port: 80, protocol: 'http' }]
      : [{ port: cfg.port, protocol: cfg.protocol }, { port: 443, protocol: 'https' }];
  for (const t of transports) {
    for (const l of logins) candidates.push({ ...l, ...t, accessMethod: 'web' });
  }

  let lastError = 'No respondió';
  for (const c of candidates) {
    try {
      const clients = await readApClients({ ip, brand, port: c.port, protocol: c.protocol, username: c.username, password: c.password, accessMethod: c.accessMethod, sshPort: c.sshPort });
      return { ip, brand, port: c.port, protocol: c.protocol, ok: true as const, clients, error: null };
    } catch (error: any) {
      lastError = error?.message || String(error);
    }
  }
  return { ip, brand, port: cfg.port, protocol: cfg.protocol, ok: false as const, clients: [] as any[], error: lastError };
}

netAccessRouter.get('/:mikrotikId/aps-auto', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = await guard(req, res);
    if (!mikrotikId) return;

    const data = await swr(
      `aps-auto:${mikrotikId}:${req.tenantId ?? 'global'}`,
      async () => {
        const ports = await tenantWebPorts(req.tenantId);
        const [neighborsRaw, arpRaw, savedRes] = await Promise.all([
          mtCached(mikrotikId, '/rest/ip/neighbor', 60000),
          mtCached(mikrotikId, '/rest/ip/arp', 60000),
          pool
            .query(
              `SELECT ip, name, brand, username, password, port, protocol, access_method, ssh_port, sector
                 FROM ap_credentials WHERE tenant_id IS NOT DISTINCT FROM $1`,
              [req.tenantId ?? null]
            )
            .catch(() => ({ rows: [] as any[] })),
        ]);

        const saved = new Map<string, any>((savedRes.rows || []).map((r: any) => [String(r.ip), r]));
        const candidates = new Map<string, { ip: string; name: string; brand: string }>();

        const add = (entry: any) => {
          const ip = entry?.address;
          if (!ip || typeof ip !== 'string' || !IPV4.test(ip)) return;
          const brand = detectBrand(entry);
          const prev = candidates.get(ip);
          candidates.set(ip, {
            ip,
            name: entry.identity || entry['host-name'] || entry.comment || prev?.name || ip,
            brand: brand !== 'otro' ? brand : prev?.brand || 'otro',
          });
        };
        asArray(neighborsRaw).forEach(add);
        asArray(arpRaw).forEach(add);
        for (const [ip, row] of saved) {
          candidates.set(ip, { ip, name: row.name || ip, brand: row.brand || 'otro' });
        }

        // Sólo equipos que pueden ser APs: marcas conocidas o registrados a mano.
        const list = [...candidates.values()]
          .filter((c) => saved.has(c.ip) || c.brand === 'ubiquiti' || c.brand === 'mikrotik' || c.brand === 'mimosa' || c.brand === 'cambium' || c.brand === 'tplink')
          .slice(0, 60);

        const results: any[] = [];
        const CONCURRENCY = 8;
        for (let i = 0; i < list.length; i += CONCURRENCY) {
          const chunk = list.slice(i, i + CONCURRENCY);
          const read = await Promise.all(
            chunk.map((c) =>
              autoReadAp(req.tenantId, c.ip, c.brand, ports, saved.get(c.ip), mikrotikId).then((r) => ({
                ...r,
                name: saved.get(c.ip)?.name || c.name,
                saved: saved.has(c.ip),
              }))
            )
          );
          results.push(...read);
        }

        const aps = results.sort((a, b) => Number(b.ok) - Number(a.ok) || a.ip.localeCompare(b.ip, undefined, { numeric: true }));
        return {
          scanned: list.length,
          online: aps.filter((a) => a.ok).length,
          total_clients: aps.reduce((n, a) => n + a.clients.length, 0),
          aps,
        };
      },
      { ttlMs: 60000 }
    );

    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// Señal wireless del propio router MikroTik (si tiene clientes asociados)
netAccessRouter.get('/:mikrotikId/wireless', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = await guard(req, res);
    if (!mikrotikId) return;

    const config = await getDeviceConfig(pool, mikrotikId);
    const paths = [
      '/rest/interface/wireless/registration-table',
      '/rest/interface/wifi/registration-table',
      '/rest/interface/wifiwave2/registration-table',
    ];
    let list: any[] = [];
    for (const path of paths) {
      const data = await mikrotikRequest(config, path).catch(() => null);
      if (Array.isArray(data) && data.length) { list = data; break; }
    }

    const clients = list.map((r: any) => {
      const signal = Number(String(r['signal-strength'] ?? r.signal ?? '').split('@')[0]) || null;
      const snr = Number(r['signal-to-noise']) || null;
      return {
        mac: r['mac-address'] || null,
        name: r.comment || r['last-ip'] || r.interface || null,
        interface: r.interface || null,
        signal,
        snr,
        ccq: Number(r['tx-ccq']) || null,
        tx_rate: r['tx-rate'] || null,
        rx_rate: r['rx-rate'] || null,
        uptime: r.uptime || null,
        quality: signalQuality(signal, snr),
      };
    });

    res.json({ success: true, data: { total: clients.length, clients } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Estado de los puertos Ethernet (link, velocidad, errores) ──
netAccessRouter.get('/:mikrotikId/ethernet', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = await guard(req, res);
    if (!mikrotikId) return;

    const config = await getDeviceConfig(pool, mikrotikId);

    const [ethRaw, ifaceRaw] = await Promise.all([
      mtCached(mikrotikId, '/rest/interface/ethernet'),
      mtCached(mikrotikId, '/rest/interface'),
    ]);
    const eth: any[] = Array.isArray(ethRaw) ? ethRaw : [];
    const ifaces: any[] = Array.isArray(ifaceRaw) ? ifaceRaw : [];

    // Monitor en vivo (link, rate, duplex). Puede no estar disponible en algunas versiones.
    const monitors = await Promise.all(
      eth.map((e) =>
        mikrotikRequest(config, '/rest/interface/ethernet/monitor', 'POST', {
          numbers: e['.id'],
          once: '',
        })
          .then((r: any) => (Array.isArray(r) ? r[0] : r))
          .catch(() => null)
      )
    );

    const parseRate = (rate?: string | null) => {
      if (!rate) return null;
      const m = String(rate).match(/(\d+)\s*([MG])/i);
      if (!m) return null;
      const value = Number(m[1]);
      return m[2].toUpperCase() === 'G' ? value * 1000 : value;
    };

    const ports = eth.map((e, i) => {
      const m: any = monitors[i] || {};
      const stats = ifaces.find((f: any) => f.name === e.name) || {};
      const status = String(m.status ?? (e.running === 'true' ? 'link-ok' : 'no-link'));
      const connected = status === 'link-ok';
      const speedMbps = parseRate(m.rate ?? m['rate'] ?? null);
      const rxErrors = Number(stats['rx-error'] ?? 0) || 0;
      const txErrors = Number(stats['tx-error'] ?? 0) || 0;
      const rxDrops = Number(stats['rx-drop'] ?? 0) || 0;
      const txDrops = Number(stats['tx-drop'] ?? 0) || 0;
      const linkDowns = Number(e['link-downs'] ?? m['link-downs'] ?? 0) || 0;
      const errors = rxErrors + txErrors + rxDrops + txDrops;

      let health: 'ok' | 'degradado' | 'fallo' | 'desconectado' = 'ok';
      if (!connected) health = 'desconectado';
      else if (errors > 0 || linkDowns > 3) health = 'fallo';
      else if (speedMbps !== null && speedMbps < 100) health = 'degradado';

      return {
        id: e['.id'],
        name: e.name,
        comment: e.comment || stats.comment || null,
        disabled: e.disabled === 'true' || e.disabled === true,
        connected,
        status,
        speed_mbps: speedMbps,
        base: speedMbps ? `${speedMbps}Base-T` : null,
        duplex:
          m['full-duplex'] === 'true' ? 'full' : m['full-duplex'] === 'false' ? 'half' : null,
        auto_negotiation: m['auto-negotiation'] ?? null,
        default_speed: e.speed ?? null,
        mac: e['mac-address'] || stats['mac-address'] || null,
        rx_errors: rxErrors,
        tx_errors: txErrors,
        rx_drops: rxDrops,
        tx_drops: txDrops,
        link_downs: linkDowns,
        last_link_up: stats['last-link-up-time'] || e['last-link-up-time'] || null,
        last_link_down: stats['last-link-down-time'] || e['last-link-down-time'] || null,
        rx_bytes: Number(stats['rx-byte'] ?? 0) || 0,
        tx_bytes: Number(stats['tx-byte'] ?? 0) || 0,
        health,
      };
    });

    res.json({
      success: true,
      data: {
        total: ports.length,
        connected: ports.filter((p) => p.connected).length,
        with_errors: ports.filter((p) => p.health === 'fallo').length,
        ports,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Alertas de cable LAN desconectado (router + clientes) ──────
netAccessRouter.get('/:mikrotikId/lan-alerts', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = await guard(req, res);
    if (!mikrotikId) return;

    const config = await getDeviceConfig(pool, mikrotikId);

    const [ethRaw, secretsRaw, activeRaw, sessionsRes] = await Promise.all([
      mtCached(mikrotikId, '/rest/interface/ethernet'),
      mtCached(mikrotikId, '/rest/ppp/secret'),
      mtCached(mikrotikId, '/rest/ppp/active', 10000),
      pool
        .query(
          `SELECT username, is_online, address, caller_id, last_up, last_down, last_seen
             FROM pppoe_sessions WHERE mikrotik_id = $1`,
          [mikrotikId]
        )
        .catch(() => ({ rows: [] as any[] })),
    ]);

    const now = Date.now();
    const sessions = new Map<string, any>(
      (sessionsRes.rows || []).map((r: any) => [String(r.username), r])
    );
    const activeNames = new Set(asArray(activeRaw).map((a: any) => String(a.name)));

    // 1) Puertos del router sin cable / con enlace degradado
    const portAlerts = asArray(ethRaw)
      .filter((e: any) => !(e.disabled === 'true' || e.disabled === true))
      .filter((e: any) => e.running !== 'true' && e.running !== true)
      .map((e: any) => ({
        type: 'puerto' as const,
        severity: 'critica' as const,
        name: e.name,
        comment: e.comment || null,
        message: 'Cable LAN desconectado en el puerto del router',
        last_link_down: e['last-link-down-time'] || null,
        link_downs: Number(e['link-downs'] ?? 0) || 0,
      }));

    // 2) Clientes PPPoE caídos (cable/ONU desconectada del lado del cliente)
    const clientAlerts = asArray(secretsRaw)
      .filter((s: any) => !(s.disabled === 'true' || s.disabled === true))
      .filter((s: any) => !activeNames.has(String(s.name)))
      .map((s: any) => {
        const sess = sessions.get(String(s.name));
        const lastDown = sess?.last_down ? new Date(sess.last_down) : null;
        const minutesDown = lastDown ? Math.max(0, Math.round((now - lastDown.getTime()) / 60000)) : null;
        const severity =
          minutesDown === null ? 'media' : minutesDown >= 60 ? 'critica' : minutesDown >= 10 ? 'alta' : 'media';
        return {
          type: 'cliente' as const,
          severity,
          name: s.name,
          comment: s.comment || null,
          profile: s.profile || null,
          address: sess?.address || s['remote-address'] || null,
          caller_id: sess?.caller_id || null,
          last_down: sess?.last_down || null,
          last_up: sess?.last_up || null,
          minutes_down: minutesDown,
          message:
            minutesDown === null
              ? 'Cliente sin conexión (sin sesión PPPoE activa)'
              : `Sin enlace hace ${minutesDown} min — posible cable LAN/ONU desconectada`,
        };
      })
      .sort((a, b) => (b.minutes_down ?? 1e9) - (a.minutes_down ?? 1e9));

    const alerts = [...portAlerts, ...clientAlerts];

    res.json({
      success: true,
      data: {
        generated_at: new Date().toISOString(),
        total: alerts.length,
        ports_down: portAlerts.length,
        clients_down: clientAlerts.length,
        critical: alerts.filter((a) => a.severity === 'critica').length,
        alerts,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// ─── Informe de desconexiones PPPoE ─────────────────────────────
netAccessRouter.get('/:mikrotikId/pppoe-events', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = await guard(req, res);
    if (!mikrotikId) return;

    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    const interval = `${days} days`;

    const [ranking, timeline, recent, totals] = await Promise.all([
      pool.query(
        `SELECT e.username,
                COUNT(*) FILTER (WHERE e.event = 'down') AS disconnections,
                MAX(e.created_at) FILTER (WHERE e.event = 'down') AS last_down,
                s.is_online, s.address, s.caller_id, s.last_up
           FROM pppoe_events e
           LEFT JOIN pppoe_sessions s
             ON s.mikrotik_id = e.mikrotik_id AND s.username = e.username
          WHERE e.mikrotik_id = $1 AND e.created_at > now() - $2::interval
          GROUP BY e.username, s.is_online, s.address, s.caller_id, s.last_up
         HAVING COUNT(*) FILTER (WHERE e.event = 'down') > 0
          ORDER BY disconnections DESC, last_down DESC
          LIMIT 100`,
        [mikrotikId, interval]
      ),
      pool.query(
        `SELECT date_trunc('day', created_at) AS day,
                COUNT(*) FILTER (WHERE event = 'down') AS downs,
                COUNT(*) FILTER (WHERE event = 'up') AS ups
           FROM pppoe_events
          WHERE mikrotik_id = $1 AND created_at > now() - $2::interval
          GROUP BY 1 ORDER BY 1`,
        [mikrotikId, interval]
      ),
      pool.query(
        `SELECT username, event, address, caller_id, created_at
           FROM pppoe_events
          WHERE mikrotik_id = $1 AND created_at > now() - $2::interval
          ORDER BY created_at DESC LIMIT 200`,
        [mikrotikId, interval]
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE event = 'down') AS downs,
                COUNT(DISTINCT username) FILTER (WHERE event = 'down') AS affected
           FROM pppoe_events
          WHERE mikrotik_id = $1 AND created_at > now() - $2::interval`,
        [mikrotikId, interval]
      ),
    ]);

    const clients = ranking.rows.map((r: any) => {
      const count = Number(r.disconnections);
      const perDay = count / days;
      const severity = perDay >= 3 ? 'critica' : perDay >= 1 ? 'alta' : perDay >= 0.3 ? 'media' : 'baja';
      return {
        username: r.username,
        disconnections: count,
        per_day: Number(perDay.toFixed(2)),
        last_down: r.last_down,
        last_up: r.last_up,
        is_online: r.is_online ?? null,
        address: r.address,
        caller_id: r.caller_id,
        severity,
      };
    });

    res.json({
      success: true,
      data: {
        days,
        total_disconnections: Number(totals.rows[0]?.downs || 0),
        affected_clients: Number(totals.rows[0]?.affected || 0),
        unstable_clients: clients.filter((c) => c.severity === 'critica' || c.severity === 'alta').length,
        clients,
        timeline: timeline.rows.map((t: any) => ({
          day: t.day,
          downs: Number(t.downs),
          ups: Number(t.ups),
        })),
        recent: recent.rows,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});



// ─── PPPoE por VPN (secrets + sesiones activas unificados) ──────
netAccessRouter.get('/:mikrotikId/pppoe', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = await guard(req, res);
    if (!mikrotikId) return;

    const [secretsRaw, activeRaw] = await Promise.all([
      mtCached(mikrotikId, '/rest/ppp/secret'),
      mtCached(mikrotikId, '/rest/ppp/active', 10000),
    ]);

    const active = asArray(activeRaw);

    // Puede haber VARIOS clientes/sesiones con el mismo nombre: se agrupan en
    // colas por nombre para no perder ninguno al emparejar con los secretos.
    const sessionsByName = new Map<string, any[]>();
    for (const a of active) {
      const key = String(a.name);
      const list = sessionsByName.get(key) || [];
      list.push(a);
      sessionsByName.set(key, list);
    }

    const secrets = asArray(secretsRaw).map((s: any) => {
      const queue = sessionsByName.get(String(s.name));
      const session = queue && queue.length ? queue.shift() : undefined;
      return {
        id: s['.id'],
        name: s.name,
        profile: s.profile,
        service: s.service,
        comment: s.comment || '',
        disabled: s.disabled === 'true' || s.disabled === true,
        remote_address: session?.address || s['remote-address'] || null,
        caller_id: session?.['caller-id'] || null,
        uptime: session?.uptime || null,
        online: !!session,
        source: 'secret' as const,
      };
    });

    // Muchos routers autentican por RADIUS o tienen los secretos en otro
    // servidor: en ese caso quedan sesiones activas sin secreto local (o
    // sesiones extra de un nombre repetido). Se agregan igual para que la
    // lista muestre TODOS los clientes conectados.
    const sessionOnly: any[] = [];
    for (const list of sessionsByName.values()) {
      for (const a of list) {
        sessionOnly.push({
          id: a['.id'],
          name: a.name,
          profile: a.profile || null,
          service: a.service || 'pppoe',
          comment: a.comment || '',
          disabled: false,
          remote_address: a.address || null,
          caller_id: a['caller-id'] || null,
          uptime: a.uptime || null,
          online: true,
          source: 'active' as const,
        });
      }
    }

    const all = [...secrets, ...sessionOnly];


    res.json({
      success: true,
      data: {
        secrets: all,
        active_count: active.length,
        total: all.length,
        secrets_count: secrets.length,
        radius_sessions: sessionOnly.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Aplica cambios a un secreto PPPoE usando el mismo estilo de comando que la
 * creación (que sí funciona): POST a /set con el `.id` dentro del cuerpo.
 * Evita rutas con el ID en la URL, que fallan en la API nativa de RouterOS v6.
 */
async function setPppoeSecret(config: any, secretId: string, patch: Record<string, string>) {
  return mikrotikRequest(config, '/rest/ppp/secret/set', 'POST', { '.id': secretId, ...patch });
}

/** Busca un secreto por su `.id` leyendo la lista completa (compatible v6/v7). */
async function findSecretById(config: any, secretId: string): Promise<any | null> {
  const list = asArray(await mikrotikRequest(config, '/rest/ppp/secret').catch(() => []));
  return list.find((s: any) => String(s['.id']) === String(secretId)) || null;
}

/** Tumba la sesión activa de un usuario para forzar reconexión. */
async function kickPppoeSession(config: any, name?: string | null) {
  if (!name) return false;
  const active = asArray(await mikrotikRequest(config, '/rest/ppp/active').catch(() => []));
  const session = active.find((a: any) => String(a.name) === String(name));
  if (!session?.['.id']) return false;
  await mikrotikRequest(config, '/rest/ppp/active/remove', 'POST', { '.id': session['.id'] }).catch(() => undefined);
  return true;
}

/** Cambia la clave PPPoE de un cliente directo en el MikroTik (vía VPN/REST). */

netAccessRouter.put('/:mikrotikId/pppoe/:secretId/password', editRed, async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = await guard(req, res);
    if (!mikrotikId) return;

    const { secretId } = req.params as { secretId: string };
    const password = String(req.body?.password || '').trim();
    if (!secretId) return res.status(400).json({ success: false, error: 'Falta el ID del secreto' });
    if (password.length < 4) return res.status(400).json({ success: false, error: 'La clave debe tener al menos 4 caracteres' });

    const config = await getDeviceConfig(pool, mikrotikId);
    await setPppoeSecret(config, secretId, { password });

    // Opcional: tumbar la sesión activa para que reconecte con la clave nueva
    let kicked = false;
    if (req.body?.kick) {
      const secret = await findSecretById(config, secretId);
      kicked = await kickPppoeSession(config, secret?.name);
    }



    res.json({ success: true, data: { secret_id: secretId, kicked } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** Edita comentario y/o perfil de un secreto PPPoE directo en el MikroTik. */
netAccessRouter.put('/:mikrotikId/pppoe/:secretId', editRed, async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = await guard(req, res);
    if (!mikrotikId) return;

    const { secretId } = req.params as { secretId: string };
    if (!secretId) return res.status(400).json({ success: false, error: 'Falta el ID del secreto' });

    const patch: Record<string, string> = {};
    if (typeof req.body?.comment === 'string') patch.comment = req.body.comment;
    if (typeof req.body?.profile === 'string' && req.body.profile.trim()) patch.profile = req.body.profile.trim();
    if (!Object.keys(patch).length) {
      return res.status(400).json({ success: false, error: 'Nada que actualizar (envía comment y/o profile)' });
    }

    const config = await getDeviceConfig(pool, mikrotikId);
    await mikrotikRequest(config, `/rest/ppp/secret/${encodeURIComponent(secretId)}`, 'PATCH', patch);

    // Si cambió el perfil, tumbar la sesión activa para que reconecte con el perfil nuevo
    let kicked = false;
    if (patch.profile) {
      const active = asArray(await mikrotikRequest(config, '/rest/ppp/active').catch(() => []));
      const secret = await mikrotikRequest(config, `/rest/ppp/secret/${encodeURIComponent(secretId)}`).catch(() => null);
      const name = (secret as any)?.name;
      const session = active.find((a: any) => String(a.name) === String(name));
      if (session?.['.id']) {
        await mikrotikRequest(config, `/rest/ppp/active/${encodeURIComponent(session['.id'])}`, 'DELETE').catch(() => undefined);
        kicked = true;
      }
    }

    res.json({ success: true, data: { secret_id: secretId, kicked } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Equipos detectados en la red (antenas, CPEs, routers) ──────
netAccessRouter.get('/:mikrotikId/devices', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = await guard(req, res);
    if (!mikrotikId) return;

    const [neighborsRaw, leasesRaw, arpRaw] = await Promise.all([
      mtCached(mikrotikId, '/rest/ip/neighbor', 30000),
      mtCached(mikrotikId, '/rest/ip/dhcp-server/lease', 30000),
      mtCached(mikrotikId, '/rest/ip/arp', 30000),
    ]);

    const ports = await tenantWebPorts(req.tenantId);
    const byIp = new Map<string, any>();

    const push = (entry: Record<string, any>, source: string) => {
      const ip = entry.address || entry['address4'] || entry.address;
      if (!ip || typeof ip !== 'string') return;
      const brand = detectBrand(entry);
      const cfg = ports[brand] || ports.otro;
      const prev = byIp.get(ip);
      const merged = {
        ip,
        mac: entry['mac-address'] || entry['active-mac-address'] || prev?.mac || null,
        name: entry.identity || entry['host-name'] || entry.comment || prev?.name || ip,
        platform: entry.platform || entry.board || entry['system-description'] || prev?.platform || null,
        brand: brand !== 'otro' ? brand : prev?.brand || 'otro',
        source: prev ? `${prev.source},${source}` : source,
        web_port: cfg.port,
        web_protocol: cfg.protocol,
        web_url: `${cfg.protocol}://${ip}:${cfg.port}/`,
        proxy_path: `/api/netaccess/${mikrotikId}/web/${ip}/${cfg.port}/`,
      };
      byIp.set(ip, merged);
    };

    asArray(neighborsRaw).forEach((n: any) => push(n, 'neighbor'));
    asArray(leasesRaw).forEach((l: any) => push(l, 'dhcp'));
    asArray(arpRaw).forEach((a: any) => push(a, 'arp'));

    const devices = [...byIp.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
    res.json({ success: true, data: { devices, web_ports: ports } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Árbol de topología por sectores (MikroTik → AP → cliente) ──
netAccessRouter.get('/:mikrotikId/topology', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = await guard(req, res);
    if (!mikrotikId) return;

    const config = await getDeviceConfig(pool, mikrotikId);
    const { rows: devRows } = await pool.query(
      `SELECT name, host FROM mikrotik_devices WHERE id = $1`,
      [mikrotikId]
    );
    const router = devRows[0] || { name: 'MikroTik', host: '' };

    const [apsRes, activeRaw, secretsRaw, arpRaw, wirelessRaw] = await Promise.all([
      pool.query(
        `SELECT id, ip, name, brand, sector, username, password, port, protocol
           FROM ap_credentials WHERE tenant_id IS NOT DISTINCT FROM $1 ORDER BY sector NULLS LAST, ip`,
        [req.tenantId ?? null]
      ).catch(() => ({ rows: [] as any[] })),
      mikrotikRequest(config, '/rest/ppp/active').catch(() => []),
      mikrotikRequest(config, '/rest/ppp/secret').catch(() => []),
      mikrotikRequest(config, '/rest/ip/arp').catch(() => []),
      mikrotikRequest(config, '/rest/interface/wireless/registration-table').catch(() => []),
    ]);

    const ports = await tenantWebPorts(req.tenantId);
    const aps = apsRes.rows as any[];

    // Clientes leídos de cada AP (en paralelo)
    const apResults = await Promise.all(
      aps.map(async (ap) => {
        const fallback = ports[ap.brand] || ports.otro;
        const target: ApTarget = {
          ip: ap.ip,
          brand: ap.brand || 'otro',
          port: ap.port || fallback.port,
          protocol: (ap.protocol || fallback.protocol) as 'http' | 'https',
          username: ap.username || (ap.brand === 'ubiquiti' ? 'ubnt' : 'admin'),
          password: ap.password || '',
        };
        let clients: any[] = [];
        let error: string | null = null;
        try {
          await ensureApRoute(mikrotikId, req.tenantId, ap.ip);
          clients = await readApClients(target);
        } catch (e: any) {
          error = e?.message || 'sin respuesta';
        }
        return { ap, target, clients, error };
      })
    );

    const arp = asArray(arpRaw);
    const active = asArray(activeRaw);
    const secrets = asArray(secretsRaw);
    const macToPppoe = new Map<string, any>();
    active.forEach((a: any) => {
      const mac = normalizeMac(a['caller-id']);
      if (mac) macToPppoe.set(mac, a);
    });
    arp.forEach((a: any) => {
      const mac = normalizeMac(a['mac-address']);
      if (mac && !macToPppoe.has(mac)) macToPppoe.set(mac, { address: a.address, name: a.comment || null });
    });

    const claimed = new Set<string>();
    const clientWeb = ports.otro || { port: 80, protocol: 'http' };
    const clientNode = (c: any, apIp: string) => {
      const mac = normalizeMac(c.mac);
      const link = mac ? macToPppoe.get(mac) : null;
      if (link?.name) claimed.add(String(link.name));
      const ip = link?.address || null;
      return {
        type: 'cliente' as const,
        mac: c.mac,
        name: link?.name || c.name || c.mac || 'cliente',
        ip,
        signal: c.signal ?? null,
        noise: c.noise ?? null,
        snr: c.snr ?? null,
        ccq: c.ccq ?? null,
        tx_rate: c.tx_rate ?? null,
        rx_rate: c.rx_rate ?? null,
        uptime: c.uptime ?? null,
        distance: c.distance ?? null,
        quality: c.quality || signalQuality(c.signal ?? null, c.snr ?? null),
        via_ap: apIp,
        // Web del CPE/antena del cliente accesible por el proxy del VPS
        web_url: ip ? `${clientWeb.protocol}://${ip}:${clientWeb.port}/` : null,
        proxy_path: ip ? `/api/netaccess/${mikrotikId}/web/${ip}/${clientWeb.port}/` : null,
      };
    };

    // Nodos AP agrupados por sector
    const sectors = new Map<string, any>();
    const sectorOf = (name?: string | null) => (name && String(name).trim()) || 'Sin sector';

    for (const { ap, target, clients, error } of apResults) {
      const key = sectorOf(ap.sector);
      if (!sectors.has(key)) sectors.set(key, { type: 'sector', name: key, aps: [], clients: [] });
      sectors.get(key).aps.push({
        type: 'ap',
        id: ap.id,
        ip: ap.ip,
        name: ap.name || ap.ip,
        brand: ap.brand,
        online: !error,
        error,
        web_url: `${target.protocol}://${ap.ip}:${target.port}/`,
        proxy_path: `/api/netaccess/${mikrotikId}/web/${ap.ip}/${target.port}/`,
        total_clients: clients.length,
        clients: clients.map((c) => clientNode(c, ap.ip)),
      });
    }

    // Wireless del propio router = sector local
    const localClients = asArray(wirelessRaw).map((r: any) => {
      const signal = Number(String(r['signal-strength'] ?? r.signal ?? '').split('@')[0]) || null;
      const snr = Number(r['signal-to-noise']) || null;
      return clientNode(
        {
          mac: r['mac-address'],
          name: r.comment || r['last-ip'] || null,
          signal,
          snr,
          ccq: Number(r['tx-ccq']) || null,
          tx_rate: r['tx-rate'] || null,
          rx_rate: r['rx-rate'] || null,
          uptime: r.uptime || null,
          quality: signalQuality(signal, snr),
        },
        router.host
      );
    });
    if (localClients.length) {
      const key = 'Wireless del router';
      sectors.set(key, {
        type: 'sector',
        name: key,
        aps: [
          {
            type: 'ap',
            id: 'router-wireless',
            ip: router.host,
            name: `${router.name} (wireless)`,
            brand: 'mikrotik',
            online: true,
            error: null,
            web_url: `${ports.mikrotik.protocol}://${router.host}:${ports.mikrotik.port}/`,
            proxy_path: `/api/netaccess/${mikrotikId}/web/${router.host}/${ports.mikrotik.port}/`,
            total_clients: localClients.length,
            clients: localClients,
          },
        ],
        clients: [],
      });
    }

    // Clientes PPPoE sin AP identificado (cuelgan directo del router)
    const activeNames = new Set(active.map((a: any) => String(a.name)));
    const orphans = secrets
      .filter((s: any) => !claimed.has(String(s.name)))
      .map((s: any) => {
        const a = active.find((x: any) => String(x.name) === String(s.name));
        return {
          type: 'cliente' as const,
          mac: a?.['caller-id'] || null,
          name: s.name,
          ip: a?.address || s['remote-address'] || null,
          signal: null,
          snr: null,
          quality: 'desconocida' as const,
          online: activeNames.has(String(s.name)),
          via_ap: null,
        };
      });

    const tree = {
      type: 'router',
      id: mikrotikId,
      name: router.name,
      host: router.host,
      proxy_path: `/api/netaccess/${mikrotikId}/web/${router.host}/${ports.mikrotik.port}/`,
      sectors: [...sectors.values()],
      direct_clients: orphans,
    };

    res.json({
      success: true,
      data: {
        generated_at: new Date().toISOString(),
        totals: {
          sectors: sectors.size,
          aps: apResults.length + (localClients.length ? 1 : 0),
          clients_with_signal: apResults.reduce((n, r) => n + r.clients.length, 0) + localClients.length,
          direct_clients: orphans.length,
        },
        tree,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Router propio: acceso a WebFig embebido ────────────────────
netAccessRouter.get('/:mikrotikId/webfig', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = await guard(req, res);
    if (!mikrotikId) return;

    const { rows } = await pool.query(`SELECT host FROM mikrotik_devices WHERE id = $1`, [mikrotikId]);
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Router no encontrado' });

    const ports = await tenantWebPorts(req.tenantId);
    const requested = Number(req.query.port);
    const port = Number.isFinite(requested) && requested > 0 ? requested : ports.mikrotik.port;

    res.json({
      success: true,
      data: {
        host: rows[0].host,
        port,
        proxy_path: `/api/netaccess/${mikrotikId}/web/${rows[0].host}/${port}/`,
        direct_url: `${ports.mikrotik.protocol}://${rows[0].host}:${port}/`,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Proxy web hacia el equipo (WebFig / airOS) ─────────────────
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Diagnóstico: prueba si el equipo responde por HTTP/HTTPS desde el VPS. */
netAccessRouter.get('/:mikrotikId/web-check/:ip/:port', async (req: AuthRequest, res: Response) => {
  const mikrotikId = await guard(req, res);
  if (!mikrotikId) return;

  const { ip, port } = req.params as { ip: string; port: string };
  const basePort = Number(port);
  if (!IPV4.test(ip)) return res.status(400).json({ success: false, error: 'IP inválida' });

  const candidates = Array.from(
    new Set([basePort, 80, 8080, 443, 8443, 8291].filter((p) => Number.isFinite(p) && p > 0 && p < 65536))
  );

  const probe = (p: number) =>
    new Promise<any>((resolve) => {
      const secure = p === 443 || p === 8443;
      const client = secure ? https : http;
      const started = Date.now();
      const rq = client.request(
        { host: ip, port: p, path: '/', method: 'GET', rejectUnauthorized: false, timeout: 6000 },
        (r) => {
          r.resume();
          resolve({
            port: p,
            protocol: secure ? 'https' : 'http',
            ok: true,
            status: r.statusCode,
            server: r.headers['server'] || null,
            auth: r.headers['www-authenticate'] || null,
            ms: Date.now() - started,
          });
        }
      );
      rq.on('timeout', () => rq.destroy(new Error('timeout')));
      rq.on('error', (e: any) =>
        resolve({ port: p, protocol: secure ? 'https' : 'http', ok: false, error: e.code || e.message, ms: Date.now() - started })
      );
      rq.end();
    });

  const results = await Promise.all(candidates.map(probe));
  const best = results.find((r) => r.ok && r.port === basePort) || results.find((r) => r.ok) || null;

  res.json({
    success: true,
    data: {
      ip,
      requested_port: basePort,
      reachable: !!best,
      suggested_port: best?.port ?? null,
      needs_login: !!best?.auth,
      results,
      proxy_path: best ? `/api/netaccess/${mikrotikId}/web/${ip}/${best.port}/` : null,
    },
  });
});

// Sin barra final el firmware resuelve mal los recursos relativos: normaliza.
netAccessRouter.all('/:mikrotikId/web/:ip/:port', (req: AuthRequest, res: Response) => {
  const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(302, `${req.originalUrl.split('?')[0]}/${q}`);
});

netAccessRouter.all('/:mikrotikId/web/:ip/:port/*', async (req: AuthRequest, res: Response) => {
  const mikrotikId = await guard(req, res);
  if (!mikrotikId) return;

  const { ip, port } = req.params as { ip: string; port: string };
  const targetPort = Number(port);
  if (!IPV4.test(ip) || !Number.isFinite(targetPort) || targetPort < 1 || targetPort > 65535) {
    return res.status(400).send('Destino inválido');
  }

  // Al abrir en pestaña nueva o iframe no viaja la cabecera Authorization:
  // el token llega por ?token= y se guarda en cookie para las peticiones hijas.
  const webTokenCookie = typeof req.query.token === 'string' && req.query.token
    ? `${WEB_TOKEN_COOKIE}=${encodeURIComponent(req.query.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`
    : null;

  const prefix = `/api/netaccess/${mikrotikId}/web/${ip}/${targetPort}`;
  const rawRest = req.originalUrl.startsWith(prefix) ? req.originalUrl.slice(prefix.length) : '/';
  const rest = rawRest
    .replace(/([?&])token=[^&]*&?/, '$1')
    .replace(/[?&]$/, '');
  const targetPath = rest.startsWith('/') ? rest : `/${rest}`;

  const secure = targetPort === 443 || targetPort === 8443;
  const client = secure ? https : http;
  const upstreamOrigin = `${secure ? 'https' : 'http'}://${ip}:${targetPort}`;

  // Credencial guardada del equipo (Basic auth automático para ONUs/antenas).
  let basic: string | undefined;
  try {
    const cred = await pool.query(
      `SELECT username, password FROM onu_web_credentials
        WHERE ($1::uuid IS NULL OR tenant_id = $1::uuid) AND (ip = $2 OR COALESCE(ip,'') = '')
        ORDER BY (ip = $2) DESC LIMIT 1`,
      [req.tenantId || null, ip]
    );
    if (cred.rows[0]?.username) {
      basic = 'Basic ' + Buffer.from(`${cred.rows[0].username}:${cred.rows[0].password || ''}`).toString('base64');
    }
  } catch {
    /* la tabla puede no existir todavía */
  }

  // Cuerpo re-codificado según el content-type original (los formularios web fallan con JSON).
  const reqType = String(req.headers['content-type'] || '');
  let bodyBuf: Buffer | undefined;
  if (Buffer.isBuffer(req.body)) {
    bodyBuf = req.body;
  } else if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length) {
    if (reqType.includes('application/x-www-form-urlencoded')) {
      bodyBuf = Buffer.from(new URLSearchParams(req.body as any).toString());
    } else {
      bodyBuf = Buffer.from(JSON.stringify(req.body));
    }
  }

  const browserReferer = String(req.headers.referer || '');
  const refererPath = browserReferer.includes(prefix)
    ? browserReferer.slice(browserReferer.indexOf(prefix) + prefix.length) || '/'
    : '/';
  const upstreamCookies = String(req.headers.cookie || '')
    .split(';')
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie && !cookie.startsWith(`${WEB_TOKEN_COOKIE}=`))
    // Elimina cookies antiguas creadas por versiones previas del proxy.
    .filter((cookie) => !/^owp_[a-f0-9]{12}_/i.test(cookie))
    .join('; ');

  const outHeaders: Record<string, any> = {
    ...req.headers,
    host: `${ip}:${targetPort}`,
    'accept-encoding': 'identity',
    // El firmware debe recibir exactamente el nombre de cookie que emitió.
    // El Path reescrito la mantiene aislada dentro de esta ONU.
    cookie: upstreamCookies,
  };
  delete outHeaders.authorization;
  delete outHeaders.referer;
  delete outHeaders.origin;
  delete outHeaders['content-length'];
  outHeaders.origin = upstreamOrigin;
  outHeaders.referer = `${upstreamOrigin}${refererPath.startsWith('/') ? refererPath : `/${refererPath}`}`;
  if (basic) outHeaders.authorization = basic;
  if (bodyBuf) outHeaders['content-length'] = bodyBuf.length;

  const rewriteUrl = (u: string) => {
    if (!u) return u;
    if (/^https?:\/\//i.test(u)) {
      const m = u.match(/^https?:\/\/([^/]+)(\/.*)?$/i);
      if (m && m[1].split(':')[0] === ip) return `${prefix}${m[2] || '/'}`;
      return u;
    }
    if (u.startsWith('//') || u.startsWith('#') || /^(data|javascript|mailto|tel):/i.test(u)) return u;
    if (u.startsWith('/')) return `${prefix}${u}`;
    return u;
  };

  const sendRequest = (useBasic: boolean, allowRetry: boolean) => {
    const headersOut: Record<string, any> = { ...outHeaders };
    if (useBasic && basic) headersOut.authorization = basic;
    else delete headersOut.authorization;

    const upstream = client.request(
      {
        host: ip,
        port: targetPort,
        path: targetPath || '/',
        method: req.method,
        headers: headersOut,
        rejectUnauthorized: false,
        timeout: 45000,
      },
      (proxyRes) => {
        // Muchas ONU (V-SOL, Zyxel) usan login por formulario + captcha:
        // solo se manda Basic auth si el equipo realmente lo pide.
        if (proxyRes.statusCode === 401 && allowRetry && basic && !useBasic) {
          proxyRes.resume();
          sendRequest(true, false);
          return;
        }

        const type = String(proxyRes.headers['content-type'] || '');
        const headers = { ...proxyRes.headers };
        delete headers['content-security-policy'];
        delete headers['content-security-policy-report-only'];
        delete headers['x-frame-options'];
        delete headers['x-content-type-options'];
        delete headers['content-length'];
        delete headers['content-encoding'];
        headers['cache-control'] = 'no-store, no-cache, must-revalidate';
        headers.pragma = 'no-cache';
        if (headers.location) headers.location = rewriteUrl(String(headers.location));
        if (headers['set-cookie']) {
          // Conserva el nombre original: varios firmware validan el captcha contra
          // una cookie concreta. El Path del proxy aísla la sesión por equipo.
          headers['set-cookie'] = (headers['set-cookie'] as string[]).map((c) => {
            return c
              .replace(/;\s*Path=[^;]*/i, '')
              .replace(/;\s*Domain=[^;]*/i, '')
              .replace(/;\s*Secure/gi, '')
              .replace(/;\s*SameSite=[^;]*/i, '') + `; Path=${prefix}/; SameSite=Lax`
          });
        }
        if (webTokenCookie) {
          const upstreamCookies = Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [];
          headers['set-cookie'] = [...upstreamCookies, webTokenCookie];
        }

        // Helmet protege el panel, pero sus cabeceras no pueden aplicarse al firmware
        // embebido: las ONUs antiguas dependen de scripts inline y frames propios.
        res.removeHeader('content-security-policy');
        res.removeHeader('content-security-policy-report-only');
        res.removeHeader('x-frame-options');
        res.removeHeader('x-content-type-options');

        if (headers.refresh) {
          headers.refresh = String(headers.refresh).replace(
            /url=([^;,\s]+)/i,
            (_m, u) => `url=${rewriteUrl(String(u))}`
          );
        }

        const textual = type.includes('text/html') || type.includes('javascript') || type.includes('text/css') ||
          type.includes('text/plain') || type.includes('xml');
        if (textual) {
          const chunks: Buffer[] = [];
          proxyRes.on('data', (c) => chunks.push(c as Buffer));
          proxyRes.on('end', () => {
            // Muchos firmwares antiguos sirven gb2312 / iso-8859-1: decodificar
            // como utf8 corrompe el HTML y la página queda en blanco.
            const charset = (type.match(/charset=\s*"?([\w-]+)/i)?.[1] || '').toLowerCase();
            const enc: BufferEncoding = !charset || /utf-?8|ascii|us-ascii/.test(charset) ? 'utf8' : 'latin1';
            let body = Buffer.concat(chunks).toString(enc);

            // URLs absolutas al propio equipo (frames, scripts, imágenes de captcha).
            const abs = new RegExp(`https?://${ip.replace(/\./g, '\\.')}(?::\\d+)?`, 'gi');
            body = body.replace(abs, prefix);
            const protocolRelative = new RegExp(`//${ip.replace(/\./g, '\\.')}(?::\\d+)?`, 'gi');
            body = body.replace(protocolRelative, prefix);

            if (type.includes('text/css')) {
              body = body.replace(
                /url\(\s*(["']?)(\/[^)'"\s]+)\1\s*\)/gi,
                (_m, q, url) => `url(${q}${prefix}${url}${q})`
              );
            }

            if (type.includes('text/html')) {
              // Convierte también rutas relativas de frames y recursos. Varias
              // interfaces BOA antiguas ignoran <base> en frameset/iframe.
              body = body.replace(
                /\b(src|href|action|data-src|background)\s*=\s*(["'])(?!#|data:|javascript:|mailto:|tel:|https?:|\/\/)([^"']+)\2/gi,
                (_m, attr, q, url) => {
                  if (url.startsWith(prefix)) return `${attr}=${q}${url}${q}`;
                  const resolved = url.startsWith('/')
                    ? `${prefix}${url}`
                    : `${prefix}/${url.replace(/^\.\//, '')}`;
                  return `${attr}=${q}${resolved}${q}`;
                }
              );
              // src/href sin comillas (firmware antiguo).
              body = body.replace(
                /\b(src|href|action)\s*=\s*(\/[^\s>]+)/gi,
                (_m, attr, url) => `${attr}="${prefix}${url}"`
              );
              // <meta http-equiv="refresh" content="0;url=/login.html">
              body = body.replace(
                /(content\s*=\s*["'][^"']*url=\s*)(\/[^"'\s]*)/gi,
                (_m, head, url) => `${head}${prefix}${url}`
              );
              // Los atributos de integridad rompen los recursos reescritos.
              body = body.replace(/\s(integrity|nonce)\s*=\s*(["'])[^"']*\2/gi, '');
              const base = `<base href="${prefix}/">`;
              body = /<head[^>]*>/i.test(body)
                ? body.replace(/<head[^>]*>/i, (m) => `${m}${base}`)
                : `${base}${body}`;

              // Algunos firmwares construyen rutas absolutas en tiempo de ejecución
              // (frames, captcha, ajax, redirecciones tras el login). El shim las
              // mantiene dentro del mismo proxy autenticado.
              const shim = `<script>(function(){var p=${JSON.stringify(prefix)};
function r(u){if(typeof u!=="string")return u;if(u.indexOf(p)===0)return u;if(/^(#|data:|javascript:|mailto:|tel:|blob:)/i.test(u))return u;var m=u.match(/^https?:\\/\\/([^\\/]+)(\\/.*)?$/i);if(m)return m[1].split(":")[0]===location.hostname?u:p+(m[2]||"/");if(u.charAt(0)==="/")return p+u;return u}
var f=window.fetch;if(f)window.fetch=function(i,o){return f.call(this,typeof i==="string"?r(i):i,o)};
var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=r(u);return xo.apply(this,arguments)};
var wo=window.open;window.open=function(u){arguments[0]=r(u);return wo.apply(this,arguments)};
var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(/^(src|href|action|background)$/i.test(n))v=r(v);return sa.call(this,n,v)};
function fix(el){["src","href","action"].forEach(function(a){if(el.getAttribute&&el.hasAttribute&&el.hasAttribute(a)){var v=el.getAttribute(a);var n=r(v);if(n!==v)sa.call(el,a,n)}})}
try{new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes&&Array.prototype.forEach.call(m.addedNodes,function(n){if(n.nodeType===1){fix(n);n.querySelectorAll&&Array.prototype.forEach.call(n.querySelectorAll("[src],[href],[action]"),fix)}})})}).observe(document.documentElement,{childList:true,subtree:true})}catch(e){}
try{var la=location.assign.bind(location),lr=location.replace.bind(location);location.assign=function(u){return la(r(u))};location.replace=function(u){return lr(r(u))}}catch(e){}
document.addEventListener("submit",function(e){var fm=e.target;if(fm&&fm.getAttribute){var a=fm.getAttribute("action");if(a)sa.call(fm,"action",r(a))}},true);
})();</script>`;
              body = /<head[^>]*>/i.test(body)
                ? body.replace(/<head[^>]*>/i, (m) => `${m}${shim}`)
                : `${shim}${body}`;
            }

            // Rutas absolutas usadas desde JavaScript (location, open, ajax, captcha refresh).
            body = body.replace(
              /(["'`])(\/[a-zA-Z0-9_\-./]*\.(?:js|css|png|jpg|jpeg|gif|svg|cgi|htm|html|asp|json|xml)(?:\?[^"'`]*)?)\1/g,
              (_m, q, url) => `${q}${prefix}${url}${q}`
            );
            body = body.replace(
              /((?:location(?:\.href)?|window\.open|\.action)\s*=\s*|\.open\s*\(\s*["'][A-Z]+["']\s*,\s*)(["'])(\/[^"']*)\2/g,
              (_m, head, q, url) => `${head}${q}${prefix}${url}${q}`
            );

            res.writeHead(proxyRes.statusCode || 200, headers);
            res.end(Buffer.from(body, enc));
            return;
          });
          return;
        }



        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
      }
    );

    upstream.on('timeout', () => upstream.destroy(new Error('Tiempo de espera agotado')));
    upstream.on('error', (err: any) => {
      if (!res.headersSent) {
        res
          .status(502)
          .send(
            `No se pudo abrir ${ip}:${targetPort} — ${err.code || err.message}. ` +
              `Verifica que el equipo tenga la administración web habilitada en ese puerto y que sea alcanzable por la VPN.`
          );
      } else {
        res.end();
      }
    });

    upstream.end(bodyBuf);
  };

  sendRequest(false, true);
});


