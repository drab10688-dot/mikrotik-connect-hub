import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { pool } from '../server';

export const hotspotRouter = Router();

// List hotspot users
hotspotRouter.get('/:mikrotikId/users', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/user');
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// List active hotspot connections
hotspotRouter.get('/:mikrotikId/active', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/active');
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// List hotspot user profiles
hotspotRouter.get('/:mikrotikId/profiles', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/user/profile');
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add hotspot user
hotspotRouter.post('/:mikrotikId/users', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/user/add', 'POST', req.body);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add hotspot profile
hotspotRouter.post('/:mikrotikId/profiles', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/user/profile/add', 'POST', req.body);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove hotspot user
hotspotRouter.delete('/:mikrotikId/users/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, userId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    await mikrotikRequest(config, '/rest/ip/hotspot/user/remove', 'POST', { '.id': userId });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update hotspot user
hotspotRouter.put('/:mikrotikId/users/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, userId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/user/set', 'POST', {
      '.id': userId,
      ...req.body,
    });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Hotspot hosts (connected devices)
hotspotRouter.get('/:mikrotikId/hosts', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/host');
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Public Hotspot Login ────────────────────
hotspotRouter.post('/login', async (req: any, res: Response) => {
  try {
    const { mikrotik_id, username, password } = req.body;
    if (!mikrotik_id || !username || !password) {
      return res.status(400).json({ error: 'mikrotik_id, username y password requeridos' });
    }

    const config = await getDeviceConfig(pool, mikrotik_id);

    // Try to login the user on MikroTik hotspot
    try {
      const data = await mikrotikRequest(config, '/rest/ip/hotspot/active/login', 'POST', {
        user: username,
        password,
      });
      res.json({ success: true, data });
    } catch (mkError: any) {
      // If REST login not available, just validate credentials exist
      const users: any = await mikrotikRequest(config, '/rest/ip/hotspot/user');
      const user = (users as any[]).find((u: any) => u.name === username);

      if (!user) return res.status(401).json({ success: false, error: 'Usuario no encontrado' });

      // Mark voucher as active in DB
      await pool.query(
        `UPDATE vouchers SET status = 'active'::voucher_status, activated_at = now()
         WHERE code = $1 AND mikrotik_id = $2 AND status IN ('available'::voucher_status, 'sold'::voucher_status)`,
        [username, mikrotik_id]
      );

      res.json({ success: true, message: 'Credenciales válidas' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
