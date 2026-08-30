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
