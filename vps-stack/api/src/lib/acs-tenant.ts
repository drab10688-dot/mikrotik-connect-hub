import { pool } from './db';

/**
 * Aislamiento multi-ISP real sobre un único GenieACS.
 *
 * Cada ISP tiene su propio enlace TR-069  (http://host/tr069/<token>/).
 * Cuando una ONU informa, GenieACS guarda en ManagementServer.URL la URL que
 * el instalador configuró en la ONU: de ahí se extrae el token y se "reclama"
 * el dispositivo para ese ISP. La URL con token es la única fuente de verdad:
 * una ONU configurada con la IP pública base o sin token no pertenece a ningún
 * ISP y no debe aparecer en los paneles multiempresa.
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
}

export async function loadTenantMatchers(): Promise<TenantMatcher[]> {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.acs_token, t.onu_limit
       FROM tenants t
      WHERE COALESCE(t.is_active, true) = true`
  );
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    acs_token: r.acs_token ? String(r.acs_token).toLowerCase() : null,
    onu_limit: r.onu_limit === null ? null : Number(r.onu_limit),
  }));
}

function deviceAcsUrl(device: any): string {
  return (
    device?.InternetGatewayDevice?.ManagementServer?.URL?._value ||
    device?.Device?.ManagementServer?.URL?._value ||
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

  return null;
}

// ─── Sincronización (con caché corta) ────────────────────
let lastSync = 0;
let inflight: Promise<AcsOwnershipSyncResult> | null = null;

export interface AcsOwnershipSyncResult {
  scanned: number;
  matched: number;
  created: number;
  reassigned: number;
  removed: number;
}

export async function syncAcsOwnership(force = false): Promise<AcsOwnershipSyncResult> {
  const emptyResult: AcsOwnershipSyncResult = {
    scanned: 0,
    matched: 0,
    created: 0,
    reassigned: 0,
    removed: 0,
  };
  const now = Date.now();
  if (!force && now - lastSync < 20_000) return emptyResult;
  if (inflight) return inflight;

  inflight = (async () => {
    const result = { ...emptyResult };
    try {
      const matchers = await loadTenantMatchers();
      if (!matchers.length) return result;

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
      result.scanned = list.length;
      if (!list.length) return result;

      const { rows: ownedRows } = await pool.query(
        `SELECT acs_device_id, tenant_id, source, status FROM acs_device_owners`
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
        if (!deviceId) continue;

        // El token del enlace TR-069 manda. También elimina reclamos antiguos
        // hechos por red o por el modo "ISP único", que causaban fugas entre
        // empresas cuando la ONU ya no reportaba por un enlace con token.
        const tokenMatch = resolveTenantForDevice(device, matchers);
        if (tokenMatch) result.matched += 1;
        const existing = owned.get(deviceId);
        if (existing) {
          if (tokenMatch && (
            String(existing.tenant_id) !== String(tokenMatch.tenantId) ||
            existing.source !== 'token'
          )) {
            await pool.query(
              `UPDATE acs_device_owners
                  SET tenant_id = $2, source = 'token', status = 'active', updated_at = now()
                WHERE acs_device_id = $1`,
              [deviceId, tokenMatch.tenantId]
            );
            result.reassigned += 1;
          } else if (!tokenMatch) {
            await pool.query(
              `DELETE FROM acs_device_owners WHERE acs_device_id = $1`,
              [deviceId]
            );
            result.removed += 1;
          }
          continue;
        }

        const match = tokenMatch;
        if (!match) continue;

        const matcher = matchers.find((m) => m.id === match.tenantId);
        if (!matcher) continue;
        const used = usage.get(match.tenantId) || 0;
        const limit = matcher.onu_limit && matcher.onu_limit > 0 ? matcher.onu_limit : null;
        const status = limit !== null && used >= limit ? 'blocked' : 'active';

        await pool.query(
          `INSERT INTO acs_device_owners (acs_device_id, tenant_id, serial_number, source, status)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (acs_device_id) DO NOTHING`,
          [deviceId, match.tenantId, device?._deviceId?._SerialNumber || null, match.source, status]
        );
        result.created += 1;
        if (status === 'active') usage.set(match.tenantId, used + 1);
      }
      return result;
    } catch (error: any) {
      console.warn('[ACS] sync propiedad ISP:', error.message);
      return result;
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
      WHERE tenant_id = $1 AND status = 'active' AND source = 'token'`,
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
