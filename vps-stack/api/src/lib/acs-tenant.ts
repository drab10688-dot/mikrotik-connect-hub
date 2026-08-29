import { pool } from './db';

/**
 * Aislamiento multi-ISP real sobre un único GenieACS.
 *
 * Cada ISP tiene su propio enlace TR-069  (http://host/tr069/<token>/).
 * Cuando una ONU informa, GenieACS guarda en ManagementServer.URL la URL que
 * el instalador configuró en la ONU: de ahí se extrae el token y se "reclama"
 * el dispositivo para ese ISP. Si la URL no trae token (instalación antigua),
 * se usa la IP de la ONU (ConnectionRequestURL) contra las redes declaradas
 * por el ISP en su VPN.
 *
 * El resultado se guarda en acs_device_owners; a partir de ahí cada ISP solo
 * ve sus propias ONUs y se respeta el límite comercial (tenants.onu_limit).
 */

const GENIEACS_NBI = process.env.GENIEACS_NBI_URL || 'http://genieacs:7557';

function nbiAuthHeader(): Record<string, string> {
  const user = process.env.GENIEACS_NBI_USER;
  const pass = process.env.GENIEACS_NBI_PASSWORD;
  if (!user || !pass) return {};
  return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
}

async function nbiGet(path: string): Promise<any> {
  const res = await fetch(`${GENIEACS_NBI}${path}`, {
    headers: { 'Content-Type': 'application/json', ...nbiAuthHeader() },
  });
  if (!res.ok) throw new Error(`NBI ${res.status}`);
  return res.json();
}

// ─── Utilidades de red ───────────────────────────────────
function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [net, bitsRaw] = cidr.trim().split('/');
  const bits = Number(bitsRaw ?? 32);
  const ipInt = ipToInt(ip);
  const netInt = ipToInt(net);
  if (ipInt === null || netInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

function hostFromUrl(url: string): string | null {
  const m = String(url).match(/^[a-z]+:\/\/([^/:\]]+|\[[^\]]+\])/i);
  if (!m) return null;
  return m[1].replace(/^\[|\]$/g, '');
}

function tokenFromAcsUrl(url: string): string | null {
  const m = String(url).match(/\/tr069\/([a-f0-9]{8,64})/i);
  return m ? m[1].toLowerCase() : null;
}

// ─── Matchers por ISP ────────────────────────────────────
export interface TenantMatcher {
  id: string;
  name: string;
  acs_token: string | null;
  onu_limit: number | null;
  networks: string[];
}

export async function loadTenantMatchers(): Promise<TenantMatcher[]> {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.acs_token, t.onu_limit,
            COALESCE(t.onu_networks, '') AS tenant_networks,
            COALESCE(string_agg(p.onu_networks, ','), '') AS peer_networks
       FROM tenants t
       LEFT JOIN tenant_vpn_peers p ON p.tenant_id = t.id
      WHERE COALESCE(t.is_active, true) = true
      GROUP BY t.id`
  );
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    acs_token: r.acs_token ? String(r.acs_token).toLowerCase() : null,
    onu_limit: r.onu_limit === null ? null : Number(r.onu_limit),
    networks: `${r.tenant_networks},${r.peer_networks}`
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean),
  }));
}

function deviceAcsUrl(device: any): string {
  return (
    device?.InternetGatewayDevice?.ManagementServer?.URL?._value ||
    device?.Device?.ManagementServer?.URL?._value ||
    ''
  );
}

function deviceCrUrl(device: any): string {
  return (
    device?.InternetGatewayDevice?.ManagementServer?.ConnectionRequestURL?._value ||
    device?.Device?.ManagementServer?.ConnectionRequestURL?._value ||
    ''
  );
}

export function resolveTenantForDevice(
  device: any,
  matchers: TenantMatcher[]
): { tenantId: string; source: string } | null {
  const token = tokenFromAcsUrl(deviceAcsUrl(device));
  if (token) {
    const byToken = matchers.find((m) => m.acs_token === token);
    if (byToken) return { tenantId: byToken.id, source: 'token' };
  }

  const host = hostFromUrl(deviceCrUrl(device));
  if (host && ipToInt(host) !== null) {
    for (const m of matchers) {
      if (m.networks.some((cidr) => ipInCidr(host, cidr))) {
        return { tenantId: m.id, source: 'network' };
      }
    }
  }
  return null;
}

// ─── Sincronización (con caché corta) ────────────────────
let lastSync = 0;
let inflight: Promise<void> | null = null;

export async function syncAcsOwnership(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastSync < 20_000) return;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const matchers = await loadTenantMatchers();
      if (!matchers.length) return;

      const projection = [
        '_id',
        '_deviceId',
        'InternetGatewayDevice.ManagementServer.URL',
        'InternetGatewayDevice.ManagementServer.ConnectionRequestURL',
        'Device.ManagementServer.URL',
        'Device.ManagementServer.ConnectionRequestURL',
      ].join(',');

      const devices = await nbiGet(`/devices/?projection=${encodeURIComponent(projection)}`);
      const list = Array.isArray(devices) ? devices : [];
      if (!list.length) return;

      const { rows: ownedRows } = await pool.query(
        `SELECT acs_device_id, tenant_id, status FROM acs_device_owners`
      );
      const owned = new Map<string, any>(ownedRows.map((r: any) => [r.acs_device_id, r]));

      // Uso actual por ISP para respetar el cupo comercial
      const usage = new Map<string, number>();
      for (const r of ownedRows) {
        if (r.tenant_id && r.status === 'active') {
          usage.set(r.tenant_id, (usage.get(r.tenant_id) || 0) + 1);
        }
      }

      for (const device of list) {
        const deviceId = device?._id;
        if (!deviceId || owned.has(deviceId)) continue;

        const match = resolveTenantForDevice(device, matchers);
        if (!match) continue;

        const matcher = matchers.find((m) => m.id === match.tenantId)!;
        const used = usage.get(match.tenantId) || 0;
        const limit = matcher.onu_limit && matcher.onu_limit > 0 ? matcher.onu_limit : null;
        const status = limit !== null && used >= limit ? 'blocked' : 'active';

        await pool.query(
          `INSERT INTO acs_device_owners (acs_device_id, tenant_id, serial_number, source, status)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (acs_device_id) DO NOTHING`,
          [deviceId, match.tenantId, device?._deviceId?._SerialNumber || null, match.source, status]
        );
        if (status === 'active') usage.set(match.tenantId, used + 1);
      }
    } catch (error: any) {
      console.warn('[ACS] sync propiedad ISP:', error.message);
    } finally {
      lastSync = Date.now();
      inflight = null;
    }
  })();

  return inflight;
}

/** IDs de ONUs del ACS que pertenecen a un ISP (solo activas dentro del cupo). */
export async function tenantAcsDeviceIds(tenantId: string): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT acs_device_id FROM acs_device_owners
      WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId]
  );
  return rows.map((r: any) => String(r.acs_device_id));
}

/** Uso / cupo de ONUs de un ISP. */
export async function tenantOnuQuota(tenantId: string) {
  const [{ rows: tenantRows }, { rows: countRows }] = await Promise.all([
    pool.query(`SELECT onu_limit FROM tenants WHERE id = $1`, [tenantId]),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active')::int AS used,
         COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked
       FROM acs_device_owners WHERE tenant_id = $1`,
      [tenantId]
    ),
  ]);
  const rawLimit = tenantRows[0]?.onu_limit;
  const limit = rawLimit && Number(rawLimit) > 0 ? Number(rawLimit) : null;
  return {
    limit,
    used: countRows[0]?.used || 0,
    blocked: countRows[0]?.blocked || 0,
    available: limit === null ? null : Math.max(0, limit - (countRows[0]?.used || 0)),
  };
}

/** Reevalúa bloqueos tras cambiar el cupo de un ISP. */
export async function applyTenantOnuLimit(tenantId: string): Promise<void> {
  const { rows } = await pool.query(`SELECT onu_limit FROM tenants WHERE id = $1`, [tenantId]);
  const raw = rows[0]?.onu_limit;
  const limit = raw && Number(raw) > 0 ? Number(raw) : null;

  if (limit === null) {
    await pool.query(
      `UPDATE acs_device_owners SET status = 'active', updated_at = now()
        WHERE tenant_id = $1 AND status = 'blocked'`,
      [tenantId]
    );
    return;
  }

  await pool.query(
    `WITH ordered AS (
       SELECT acs_device_id, row_number() OVER (ORDER BY claimed_at) AS rn
         FROM acs_device_owners WHERE tenant_id = $1
     )
     UPDATE acs_device_owners o
        SET status = CASE WHEN ordered.rn <= $2 THEN 'active' ELSE 'blocked' END,
            updated_at = now()
       FROM ordered
      WHERE o.acs_device_id = ordered.acs_device_id`,
    [tenantId, limit]
  );
}
