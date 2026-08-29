import { Router, Response } from 'express';
import http from 'http';
import https from 'https';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { pool } from '../lib/db';

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

netAccessRouter.put('/web-ports', async (req: AuthRequest, res: Response) => {
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
      `SELECT id, ip, name, brand, username, port, protocol
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

netAccessRouter.put('/ap-credentials', async (req: AuthRequest, res: Response) => {
  try {
    const { ip, name, brand, username, password, port, protocol } = req.body || {};
    if (!ip || !IPV4.test(String(ip))) {
      return res.status(400).json({ success: false, error: 'IP del AP inválida' });
    }
    const { rows } = await pool.query(
      `INSERT INTO ap_credentials (tenant_id, ip, name, brand, username, password, port, protocol)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, ip) DO UPDATE SET
         name = EXCLUDED.name,
         brand = EXCLUDED.brand,
         username = EXCLUDED.username,
         password = COALESCE(NULLIF(EXCLUDED.password, ''), ap_credentials.password),
         port = EXCLUDED.port,
         protocol = EXCLUDED.protocol,
         updated_at = now()
       RETURNING id, ip, name, brand, username, port, protocol`,
      [
        req.tenantId ?? null,
        String(ip),
        name || null,
        brand || 'otro',
        username || null,
        password || '',
        Number(port) > 0 ? Number(port) : null,
        protocol === 'https' ? 'https' : 'http',
      ]
    );
    res.json({ success: true, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

netAccessRouter.delete('/ap-credentials/:id', async (req: AuthRequest, res: Response) => {
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
    `SELECT ip, brand, username, password, port, protocol
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

// ─── PPPoE por VPN (secrets + sesiones activas unificados) ──────
netAccessRouter.get('/:mikrotikId/pppoe', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = await guard(req, res);
    if (!mikrotikId) return;

    const config = await getDeviceConfig(pool, mikrotikId);
    const [secretsRaw, activeRaw] = await Promise.all([
      mikrotikRequest(config, '/rest/ppp/secret').catch(() => []),
      mikrotikRequest(config, '/rest/ppp/active').catch(() => []),
    ]);

    const active = asArray(activeRaw);
    const activeByName = new Map(active.map((a: any) => [String(a.name), a]));

    const secrets = asArray(secretsRaw).map((s: any) => {
      const session = activeByName.get(String(s.name));
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
      };
    });

    res.json({
      success: true,
      data: {
        secrets,
        active_count: active.length,
        total: secrets.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Equipos detectados en la red (antenas, CPEs, routers) ──────
netAccessRouter.get('/:mikrotikId/devices', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = await guard(req, res);
    if (!mikrotikId) return;

    const config = await getDeviceConfig(pool, mikrotikId);
    const [neighborsRaw, leasesRaw, arpRaw] = await Promise.all([
      mikrotikRequest(config, '/rest/ip/neighbor').catch(() => []),
      mikrotikRequest(config, '/rest/ip/dhcp-server/lease').catch(() => []),
      mikrotikRequest(config, '/rest/ip/arp').catch(() => []),
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

netAccessRouter.all('/:mikrotikId/web/:ip/:port/*', async (req: AuthRequest, res: Response) => {
  const mikrotikId = await guard(req, res);
  if (!mikrotikId) return;

  const { ip, port } = req.params as { ip: string; port: string };
  const targetPort = Number(port);
  if (!IPV4.test(ip) || !Number.isFinite(targetPort) || targetPort < 1 || targetPort > 65535) {
    return res.status(400).send('Destino inválido');
  }

  const prefix = `/api/netaccess/${mikrotikId}/web/${ip}/${targetPort}`;
  const rest = req.originalUrl.startsWith(prefix) ? req.originalUrl.slice(prefix.length) : '/';
  const targetPath = rest.startsWith('/') ? rest : `/${rest}`;

  const secure = targetPort === 443 || targetPort === 8443;
  const client = secure ? https : http;

  const upstream = client.request(
    {
      host: ip,
      port: targetPort,
      path: targetPath || '/',
      method: req.method,
      headers: {
        ...req.headers,
        host: `${ip}:${targetPort}`,
        'accept-encoding': 'identity',
      },
      rejectUnauthorized: false,
      timeout: 20000,
    },
    (proxyRes) => {
      const type = String(proxyRes.headers['content-type'] || '');
      const headers = { ...proxyRes.headers };
      delete headers['content-security-policy'];
      delete headers['x-frame-options'];
      delete headers['content-length'];
      delete headers['content-encoding'];

      if (type.includes('text/html')) {
        // Inyecta <base> para que los recursos relativos pasen por el proxy.
        const chunks: Buffer[] = [];
        proxyRes.on('data', (c) => chunks.push(c as Buffer));
        proxyRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf8');
          const base = `<base href="${prefix}/">`;
          html = /<head[^>]*>/i.test(html)
            ? html.replace(/<head[^>]*>/i, (m) => `${m}${base}`)
            : `${base}${html}`;
          res.writeHead(proxyRes.statusCode || 200, headers);
          res.end(html);
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
      res.status(502).send(`No se pudo abrir ${ip}:${targetPort} — ${err.message}`);
    } else {
      res.end();
    }
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    upstream.end();
  } else {
    upstream.end(req.body ? JSON.stringify(req.body) : undefined);
  }
});
