import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { pool } from '../lib/db';
import { swr, invalidate } from '../lib/cache';

export const pppoeRouter = Router();

// List PPPoE secrets
pppoeRouter.get('/:mikrotikId/secrets', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const data = await swr(`pppoe:${mikrotikId}:secrets`, async () => {
      const config = await getDeviceConfig(pool, mikrotikId);
      return mikrotikRequest(config, '/rest/ppp/secret');
    }, { ttlMs: 20000 });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// List active PPPoE connections
pppoeRouter.get('/:mikrotikId/active', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const data = await swr(`pppoe:${mikrotikId}:active`, async () => {
      const config = await getDeviceConfig(pool, mikrotikId);
      return mikrotikRequest(config, '/rest/ppp/active');
    }, { ttlMs: 10000 });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// List PPPoE profiles
pppoeRouter.get('/:mikrotikId/profiles', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const data = await swr(`pppoe:${mikrotikId}:profiles`, async () => {
      const config = await getDeviceConfig(pool, mikrotikId);
      return mikrotikRequest(config, '/rest/ppp/profile');
    }, { ttlMs: 120000 });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add PPPoE secret
pppoeRouter.post('/:mikrotikId/secrets', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { name, password, service, profile, localAddress, remoteAddress, comment } = req.body;
    const config = await getDeviceConfig(pool, mikrotikId);

    const data = await mikrotikRequest(config, '/rest/ppp/secret/add', 'POST', {
      name,
      password,
      service: service || 'pppoe',
      profile: profile || 'default',
      'local-address': localAddress,
      'remote-address': remoteAddress,
      comment: comment || '',
    });

    invalidate(`pppoe:${mikrotikId}:`);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update PPPoE secret
pppoeRouter.put('/:mikrotikId/secrets/:secretId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, secretId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const data = await mikrotikRequest(config, `/rest/ppp/secret/${secretId}`, 'PATCH', req.body);
    invalidate(`pppoe:${mikrotikId}:`);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete PPPoE secret
pppoeRouter.delete('/:mikrotikId/secrets/:secretId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, secretId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    let deletedName = secretId;
    try {
      const found: any = await mikrotikRequest(config, `/rest/ppp/secret/${secretId}`);
      if (found?.name) deletedName = found.name;
    } catch {}
    await mikrotikRequest(config, `/rest/ppp/secret/${secretId}`, 'DELETE');
    await logAudit(req, mikrotikId, deletedName, 'eliminado');
    invalidate(`pppoe:${mikrotikId}:`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Disconnect active PPPoE session
pppoeRouter.post('/:mikrotikId/disconnect/:sessionId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, sessionId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    await mikrotikRequest(config, `/rest/ppp/active/${sessionId}/remove`, 'POST');
    invalidate(`pppoe:${mikrotikId}:active`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Configuración PPPoE del ISP (contraseña global, perfil por defecto) ───
async function loadSettings(mikrotikId: string) {
  const { rows } = await pool.query(
    `SELECT global_password, use_global_password, default_profile, default_service, username_prefix,
            auto_assign_ip, ip_pool_start, ip_pool_end
       FROM pppoe_settings WHERE mikrotik_id = $1`,
    [mikrotikId]
  );
  return (
    rows[0] || {
      global_password: null,
      use_global_password: true,
      default_profile: null,
      default_service: 'pppoe',
      username_prefix: null,
      auto_assign_ip: true,
      ip_pool_start: null,
      ip_pool_end: null,
    }
  );
}

/**
 * Normaliza un nombre para MikroTik: "YERSON  PEPITO PERES" -> "yerson.pepito.peres".
 * Quita tildes, ñ -> n y cualquier símbolo que RouterOS suele rechazar.
 */
export function sanitizeUsername(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tildes
    .replace(/ñ/g, 'n')
    .replace(/Ñ/g, 'N')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.') // espacios y símbolos -> punto
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\-_]+|[.\-_]+$/g, '')
    .slice(0, 60);
}

const ipToInt = (ip: string) =>
  ip.split('.').reduce((acc, o) => acc * 256 + (parseInt(o, 10) || 0), 0);
const intToIp = (n: number) =>
  [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

/** Asignador secuencial de IPs remotas, evitando las ya usadas en la MikroTik. */
async function makeIpAllocator(config: any, settings: any) {
  if (!settings.auto_assign_ip || !settings.ip_pool_start) return () => undefined;

  const used = new Set<number>();
  try {
    const secrets: any[] = ((await mikrotikRequest(config, '/rest/ppp/secret')) as any[]) || [];
    for (const s of secrets) {
      const ip = String(s?.['remote-address'] || '').trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) used.add(ipToInt(ip));
    }
  } catch {
    /* si no se puede leer, se asigna igual desde el inicio del rango */
  }

  let cursor = ipToInt(String(settings.ip_pool_start));
  const end = settings.ip_pool_end ? ipToInt(String(settings.ip_pool_end)) : cursor + 5000;

  return () => {
    while (cursor <= end) {
      const candidate = cursor++;
      const lastOctet = candidate & 255;
      if (lastOctet === 0 || lastOctet === 255) continue; // red / broadcast
      if (used.has(candidate)) continue;
      used.add(candidate);
      return intToIp(candidate);
    }
    return undefined;
  };
}


pppoeRouter.get('/:mikrotikId/settings', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });
    res.json({ success: true, data: await loadSettings(mikrotikId) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

pppoeRouter.put('/:mikrotikId/settings', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    if (req.userRole !== 'super_admin' && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Solo el administrador del ISP puede cambiar la configuración' });
    }
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const {
      global_password = null,
      use_global_password = true,
      default_profile = null,
      default_service = 'pppoe',
      username_prefix = null,
      auto_assign_ip = true,
      ip_pool_start = null,
      ip_pool_end = null,
    } = req.body || {};

    await pool.query(
      `INSERT INTO pppoe_settings
         (tenant_id, mikrotik_id, global_password, use_global_password, default_profile, default_service, username_prefix,
          auto_assign_ip, ip_pool_start, ip_pool_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (mikrotik_id) DO UPDATE SET
         tenant_id = COALESCE(EXCLUDED.tenant_id, pppoe_settings.tenant_id),
         global_password = EXCLUDED.global_password,
         use_global_password = EXCLUDED.use_global_password,
         default_profile = EXCLUDED.default_profile,
         default_service = EXCLUDED.default_service,
         username_prefix = EXCLUDED.username_prefix,
         auto_assign_ip = EXCLUDED.auto_assign_ip,
         ip_pool_start = EXCLUDED.ip_pool_start,
         ip_pool_end = EXCLUDED.ip_pool_end,
         updated_at = now()`,
      [
        req.tenantId || null,
        mikrotikId,
        global_password || null,
        !!use_global_password,
        default_profile || null,
        default_service || 'pppoe',
        username_prefix || null,
        !!auto_assign_ip,
        ip_pool_start || null,
        ip_pool_end || null,
      ]
    );


    res.json({ success: true, data: await loadSettings(mikrotikId) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Auditoría PPPoE ───
async function ensureAuditTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pppoe_audit (
      id BIGSERIAL PRIMARY KEY,
      tenant_id UUID,
      mikrotik_id UUID,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      actor_id UUID,
      actor_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pppoe_audit_device_idx ON pppoe_audit(mikrotik_id, created_at DESC);
  `);
}

async function logAudit(req: AuthRequest, mikrotikId: string, username: string, action: string, detail?: string) {
  try {
    await ensureAuditTable();
    let email: string | null = null;
    try {
      const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [req.userId]);
      email = rows[0]?.email || null;
    } catch {}
    await pool.query(
      `INSERT INTO pppoe_audit (tenant_id, mikrotik_id, username, action, detail, actor_id, actor_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.tenantId || null, mikrotikId, username, action, detail || null, req.userId || null, email]
    );
  } catch {
    /* la auditoría nunca debe romper la operación */
  }
}

pppoeRouter.get('/:mikrotikId/audit', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });
    await ensureAuditTable();
    const { rows } = await pool.query(
      `SELECT id, username, action, detail, actor_email, created_at
         FROM pppoe_audit WHERE mikrotik_id = $1
        ORDER BY created_at DESC LIMIT 200`,
      [mikrotikId]
    );
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** Registra que se compartió un usuario (WhatsApp / Telegram / copiar). */
pppoeRouter.post('/:mikrotikId/audit/share', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });
    const names: string[] = Array.isArray(req.body?.usernames) ? req.body.usernames : [];
    const via = String(req.body?.via || 'desconocido');
    for (const n of names) await logAudit(req, mikrotikId, String(n), 'compartido', `vía ${via}`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Alta de usuarios PPPoE (uno o varios) usando la contraseña global del ISP
 * cuando no se envía una contraseña individual.
 */
pppoeRouter.post('/:mikrotikId/users', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const settings = await loadSettings(mikrotikId);
    const incoming = Array.isArray(req.body?.users) ? req.body.users : [req.body || {}];
    if (!incoming.length) return res.status(400).json({ error: 'Sin usuarios que crear' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const nextIp = await makeIpAllocator(config, settings);

    // Nombres ya existentes en la MikroTik (validación de duplicados)
    const existing = new Set<string>();
    try {
      const secrets: any[] = ((await mikrotikRequest(config, '/rest/ppp/secret')) as any[]) || [];
      for (const s of secrets) if (s?.name) existing.add(String(s.name).toLowerCase());
    } catch {
      /* si no se puede leer, la MikroTik rechazará el duplicado igualmente */
    }

    const results: any[] = [];

    for (const item of incoming) {
      const rawName = String(item?.name || '').trim();
      const clean = sanitizeUsername(rawName);
      if (!clean) {
        results.push({ name: rawName, ok: false, error: 'Nombre vacío o inválido' });
        continue;
      }
      const name = settings.username_prefix ? `${settings.username_prefix}${clean}` : clean;

      if (existing.has(name.toLowerCase())) {
        results.push({ name, originalName: rawName, ok: false, duplicate: true, error: 'Ya existe un usuario con ese nombre en la MikroTik' });
        continue;
      }

      const password =
        (item?.password && String(item.password)) ||
        (settings.use_global_password ? settings.global_password : null);

      if (!password) {
        results.push({ name, ok: false, error: 'Sin contraseña: define la contraseña global o una individual' });
        continue;
      }

      const remoteAddress = String(item?.remoteAddress || '').trim() || nextIp();

      try {
        await mikrotikRequest(config, '/rest/ppp/secret/add', 'POST', {
          name,
          password,
          service: item?.service || settings.default_service || 'pppoe',
          profile: item?.profile || settings.default_profile || 'default',
          'local-address': item?.localAddress || undefined,
          'remote-address': remoteAddress || undefined,
          comment: item?.comment || '',
        });
        existing.add(name.toLowerCase());
        await logAudit(req, mikrotikId, name, 'creado', remoteAddress ? `IP ${remoteAddress}` : undefined);
        results.push({ name, originalName: rawName, ok: true, password, remoteAddress: remoteAddress || null });
      } catch (err: any) {
        results.push({ name, ok: false, error: err?.message || 'Error en la MikroTik' });
      }
    }


    invalidate(`pppoe:${mikrotikId}:`);
    const created = results.filter((r) => r.ok).length;
    res.json({ success: created > 0, data: { created, failed: results.length - created, results } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

