import { Router, Response } from 'express';
import { AuthRequest, authMiddleware, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { validateVoucher, activateVoucher, validateCustomer, getCustomerActivePlan } from '../lib/nuxbill';
import { pool } from '../server';
import { pool } from '../server';

export const hotspotRouter = Router();

// Keep hotspot login public; require JWT for all other hotspot routes
hotspotRouter.use((req: AuthRequest, res: Response, next) => {
  const isPublicLogin = req.method === 'POST' && /^\/(login|nuxbill-login)\/?$/.test(req.path);
  if (isPublicLogin) return next();
  return authMiddleware(req, res, next);
});

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

// ─── Public Hotspot Login (MikroTik directo) ────────────────────
hotspotRouter.post('/login', async (req: any, res: Response) => {
  try {
    const { mikrotik_id, username, password } = req.body;
    if (!mikrotik_id || !username || !password) {
      return res.status(400).json({ error: 'mikrotik_id, username y password requeridos' });
    }

    const config = await getDeviceConfig(pool, mikrotik_id);

    try {
      const data = await mikrotikRequest(config, '/rest/ip/hotspot/active/login', 'POST', {
        user: username,
        password,
      });
      res.json({ success: true, data });
    } catch (mkError: any) {
      const users: any = await mikrotikRequest(config, '/rest/ip/hotspot/user');
      const user = (users as any[]).find((u: any) => u.name === username);

      if (!user) return res.status(401).json({ success: false, error: 'Usuario no encontrado' });

      await pool.query(
        `UPDATE vouchers SET status = 'active', activated_at = now()
         WHERE code = $1 AND mikrotik_id = $2 AND status IN ('available', 'sold')`,
        [username, mikrotik_id]
      );

      res.json({ success: true, message: 'Credenciales válidas' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Public NuxBill Login (vouchers + customers via PHPNuxBill DB) ────────
hotspotRouter.post('/nuxbill-login', async (req: any, res: Response) => {
  try {
    const { mikrotik_id, code, username, password, mode } = req.body;
    
    if (!mikrotik_id) {
      return res.status(400).json({ success: false, error: 'mikrotik_id requerido' });
    }

    // Get MikroTik config for creating hotspot user
    const config = await getDeviceConfig(pool, mikrotik_id);
    
    // Get hotspot URL for redirect
    const deviceResult = await pool.query(
      'SELECT hotspot_url FROM mikrotik_devices WHERE id = $1',
      [mikrotik_id]
    );
    const hotspotUrl = deviceResult.rows[0]?.hotspot_url || `http://${config.host}/login`;

    // ── MODE: VOUCHER ──
    if (mode === 'voucher' || code) {
      const voucherCode = code || username;
      if (!voucherCode) {
        return res.status(400).json({ success: false, error: 'Código de voucher requerido' });
      }

      // Validate voucher in NuxBill DB
      const result = await validateVoucher(voucherCode);
      if (!result) {
        return res.status(401).json({ success: false, error: 'Voucher inválido o ya utilizado' });
      }

      const { voucher, plan, router: nuxRouter } = result;

      // Activate voucher in NuxBill DB (creates customer + recharge)
      const { username: vUser, password: vPass } = await activateVoucher(
        voucher.id, voucherCode, plan, nuxRouter.name
      );

      // Create hotspot user in MikroTik
      const profileName = plan.name_plan || 'default';
      try {
        await mikrotikRequest(config, '/rest/ip/hotspot/user/add', 'POST', {
          name: vUser,
          password: vPass,
          profile: profileName,
          comment: `NuxBill Voucher - ${plan.name_plan}`,
        });
      } catch (mkErr: any) {
        // User might already exist, try to update
        if (mkErr.message?.includes('already')) {
          console.log(`Hotspot user ${vUser} already exists, skipping creation`);
        } else {
          console.error('Error creating MikroTik user:', mkErr.message);
        }
      }

      return res.json({
        success: true,
        data: {
          username: vUser,
          password: vPass,
          profile: profileName,
          plan: plan.name_plan,
          validity: `${plan.validity} ${plan.validity_unit}`,
          hotspotUrl,
          type: 'voucher',
        }
      });
    }

    // ── MODE: USERNAME/PASSWORD ──
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Usuario y contraseña requeridos' });
    }

    // Validate customer in NuxBill DB
    const customer = await validateCustomer(username, password);
    if (!customer) {
      return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos' });
    }

    // Get active plan
    const activePlan = await getCustomerActivePlan(username);
    if (!activePlan) {
      return res.status(403).json({ success: false, error: 'No tienes un plan activo' });
    }

    // Verify/create hotspot user in MikroTik
    try {
      const users = await mikrotikRequest(config, '/rest/ip/hotspot/user') as any[];
      const existingUser = users.find((u: any) => u.name === username);
      
      if (!existingUser) {
        await mikrotikRequest(config, '/rest/ip/hotspot/user/add', 'POST', {
          name: username,
          password: password,
          profile: activePlan.name_plan || 'default',
          comment: `NuxBill Customer - ${customer.fullname || username}`,
        });
      }
    } catch (mkErr: any) {
      console.error('MikroTik user sync warning:', mkErr.message);
    }

    return res.json({
      success: true,
      data: {
        username,
        profile: activePlan.name_plan || 'default',
        plan: activePlan.name_plan,
        expiration: activePlan.expiration,
        hotspotUrl,
        type: 'customer',
        fullname: customer.fullname,
      }
    });

  } catch (error: any) {
    console.error('NuxBill login error:', error);
    res.status(500).json({ success: false, error: error.message || 'Error de autenticación' });
  }
});
