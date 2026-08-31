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
    await mikrotikRequest(config, `/rest/ppp/secret/${secretId}`, 'DELETE');
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
    `SELECT global_password, use_global_password, default_profile, default_service, username_prefix
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
    }
  );
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
    } = req.body || {};

    await pool.query(
      `INSERT INTO pppoe_settings
         (tenant_id, mikrotik_id, global_password, use_global_password, default_profile, default_service, username_prefix)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (mikrotik_id) DO UPDATE SET
         tenant_id = COALESCE(EXCLUDED.tenant_id, pppoe_settings.tenant_id),
         global_password = EXCLUDED.global_password,
         use_global_password = EXCLUDED.use_global_password,
         default_profile = EXCLUDED.default_profile,
         default_service = EXCLUDED.default_service,
         username_prefix = EXCLUDED.username_prefix,
         updated_at = now()`,
      [
        req.tenantId || null,
        mikrotikId,
        global_password || null,
        !!use_global_password,
        default_profile || null,
        default_service || 'pppoe',
        username_prefix || null,
      ]
    );

    res.json({ success: true, data: await loadSettings(mikrotikId) });
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
    const results: any[] = [];

    for (const item of incoming) {
      const rawName = String(item?.name || '').trim();
      if (!rawName) {
        results.push({ name: rawName, ok: false, error: 'Nombre vacío' });
        continue;
      }
      const name = settings.username_prefix ? `${settings.username_prefix}${rawName}` : rawName;
      const password =
        (item?.password && String(item.password)) ||
        (settings.use_global_password ? settings.global_password : null);

      if (!password) {
        results.push({ name, ok: false, error: 'Sin contraseña: define la contraseña global o una individual' });
        continue;
      }

      try {
        await mikrotikRequest(config, '/rest/ppp/secret/add', 'POST', {
          name,
          password,
          service: item?.service || settings.default_service || 'pppoe',
          profile: item?.profile || settings.default_profile || 'default',
          'local-address': item?.localAddress || undefined,
          'remote-address': item?.remoteAddress || undefined,
          comment: item?.comment || '',
        });
        results.push({ name, ok: true });
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
