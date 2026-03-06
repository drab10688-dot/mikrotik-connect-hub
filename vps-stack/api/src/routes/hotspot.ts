import { Router, Response } from 'express';
import { AuthRequest, authMiddleware, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { validateVoucher, activateVoucher, validateCustomer, getCustomerActivePlan } from '../lib/nuxbill';
import { pool } from '../lib/db';

export const hotspotRouter = Router();

// Keep hotspot login public; require JWT for all other hotspot routes
hotspotRouter.use((req: AuthRequest, res: Response, next) => {
  const isPublicLogin = req.method === 'POST' && /^\/(login|nuxbill-login)\/?$/.test(req.path);
  if (isPublicLogin) return next();
  return authMiddleware(req, res, next);
});

// ─── Helper: verify + get config ─────────────────────────
async function getVerifiedConfig(req: AuthRequest, res: Response) {
  const { mikrotikId } = req.params;
  const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
  if (!hasAccess) { res.status(403).json({ error: 'Sin acceso' }); return null; }
  return await getDeviceConfig(pool, mikrotikId);
}

// ─── Users ───────────────────────────────────────────────
hotspotRouter.get('/:mikrotikId/users', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/user');
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

hotspotRouter.post('/:mikrotikId/users', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/user/add', 'POST', req.body);
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

hotspotRouter.put('/:mikrotikId/users/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/user/set', 'POST', {
      '.id': req.params.userId,
      ...req.body,
    });
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

hotspotRouter.delete('/:mikrotikId/users/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    await mikrotikRequest(config, '/rest/ip/hotspot/user/remove', 'POST', { '.id': req.params.userId });
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

// ─── Active connections ──────────────────────────────────
hotspotRouter.get('/:mikrotikId/active', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/active');
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

// ─── Profiles ────────────────────────────────────────────
hotspotRouter.get('/:mikrotikId/profiles', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/user/profile');
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

hotspotRouter.post('/:mikrotikId/profiles', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/user/profile/add', 'POST', req.body);
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

hotspotRouter.delete('/:mikrotikId/profiles/:profileId', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    await mikrotikRequest(config, '/rest/ip/hotspot/user/profile/remove', 'POST', { '.id': req.params.profileId });
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

// ─── Hosts ───────────────────────────────────────────────
hotspotRouter.get('/:mikrotikId/hosts', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/host');
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

// ─── IP Bindings ─────────────────────────────────────────
hotspotRouter.get('/:mikrotikId/ip-bindings', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/ip-binding');
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

hotspotRouter.post('/:mikrotikId/ip-bindings', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/ip-binding/add', 'POST', req.body);
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

hotspotRouter.delete('/:mikrotikId/ip-bindings/:bindingId', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    await mikrotikRequest(config, '/rest/ip/hotspot/ip-binding/remove', 'POST', { '.id': req.params.bindingId });
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

// ─── Cookies ─────────────────────────────────────────────
hotspotRouter.get('/:mikrotikId/cookies', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/ip/hotspot/cookie');
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

hotspotRouter.delete('/:mikrotikId/cookies/:cookieId', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    await mikrotikRequest(config, '/rest/ip/hotspot/cookie/remove', 'POST', { '.id': req.params.cookieId });
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

// ─── DHCP Leases ─────────────────────────────────────────
hotspotRouter.get('/:mikrotikId/dhcp-leases', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/ip/dhcp-server/lease');
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

// ─── Servers ─────────────────────────────────────────────
hotspotRouter.get('/:mikrotikId/servers', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/ip/hotspot');
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

// ─── System: Reboot / Shutdown ───────────────────────────
hotspotRouter.post('/:mikrotikId/system/reboot', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    await mikrotikRequest(config, '/rest/system/reboot', 'POST');
    res.json({ success: true, message: 'Router reiniciando...' });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

hotspotRouter.post('/:mikrotikId/system/shutdown', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    await mikrotikRequest(config, '/rest/system/shutdown', 'POST');
    res.json({ success: true, message: 'Router apagándose...' });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

// ─── Scheduler ───────────────────────────────────────────
hotspotRouter.get('/:mikrotikId/scheduler', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/system/scheduler');
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

// ─── Log ─────────────────────────────────────────────────
hotspotRouter.get('/:mikrotikId/log', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/log');
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

// ─── Traffic (interfaces) ────────────────────────────────
hotspotRouter.get('/:mikrotikId/traffic', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    const data = await mikrotikRequest(config, '/rest/interface');
    res.json({ success: true, data });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

// ─── Disconnect active user ──────────────────────────────
hotspotRouter.post('/:mikrotikId/active/:activeId/disconnect', async (req: AuthRequest, res: Response) => {
  try {
    const config = await getVerifiedConfig(req, res);
    if (!config) return;
    await mikrotikRequest(config, '/rest/ip/hotspot/active/remove', 'POST', { '.id': req.params.activeId });
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

// ═══════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════

// ─── Public Hotspot Login (MikroTik directo con IP/MAC) ────────────────
hotspotRouter.post('/login', async (req: any, res: Response) => {
  try {
    const { mikrotik_id, username, password, ip, mac } = req.body;
    if (!mikrotik_id || !username || !password) {
      return res.status(400).json({ error: 'mikrotik_id, username y password requeridos' });
    }

    const config = await getDeviceConfig(pool, mikrotik_id);

    // Verify user exists in MikroTik
    const users: any = await mikrotikRequest(config, '/rest/ip/hotspot/user');
    const user = (users as any[]).find((u: any) => u.name === username);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Usuario no encontrado en MikroTik' });
    }

    // If we have IP and MAC from MikroTik redirect, authorize the client directly
    if (ip && mac) {
      try {
        // Method 1: Try using login command with user + IP
        await mikrotikRequest(config, '/rest/ip/hotspot/active/login', 'POST', {
          user: username,
          password,
          ip,
          'mac-address': mac,
        });
        console.log(`Hotspot login OK via active/login for ${username} ip=${ip} mac=${mac}`);
      } catch (loginErr: any) {
        console.log(`active/login failed (${loginErr.message}), trying ip-binding...`);
        try {
          // Method 2: Create an IP binding to bypass auth for this client
          await mikrotikRequest(config, '/rest/ip/hotspot/ip-binding/add', 'POST', {
            address: ip,
            'mac-address': mac,
            type: 'bypassed',
            comment: `OmniSync auto-login: ${username}`,
          });
          console.log(`Hotspot ip-binding created for ${username} ip=${ip} mac=${mac}`);
        } catch (bindErr: any) {
          if (!bindErr.message?.includes('already')) {
            console.error('IP binding failed:', bindErr.message);
          }
        }
      }
    }

    // Update voucher status
    await pool.query(
      `UPDATE vouchers SET status = 'active', activated_at = now()
       WHERE code = $1 AND mikrotik_id = $2 AND status IN ('available', 'sold')`,
      [username, mikrotik_id]
    );

    res.json({ success: true, message: 'Cliente autorizado', data: { username, ip, mac } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Public NuxBill Login ────────────────────────────────
hotspotRouter.post('/nuxbill-login', async (req: any, res: Response) => {
  try {
    const { mikrotik_id, code, username, password, mode, ip, mac } = req.body;
    
    if (!mikrotik_id) {
      return res.status(400).json({ success: false, error: 'mikrotik_id requerido' });
    }

    const config = await getDeviceConfig(pool, mikrotik_id);
    
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

      const result = await validateVoucher(voucherCode);
      if (!result) {
        return res.status(401).json({ success: false, error: 'Voucher inválido o ya utilizado' });
      }

      const { voucher, plan, router: nuxRouter } = result;
      const { username: vUser, password: vPass } = await activateVoucher(
        voucher.id, voucherCode, plan, nuxRouter.name
      );

      const profileName = plan.name_plan || 'default';
      let mikrotikUserCreated = false;
      let mikrotikError = '';

      // First check if profile exists in MikroTik
      let profileExists = false;
      try {
        const profiles = await mikrotikRequest(config, '/rest/ip/hotspot/user/profile') as any[];
        profileExists = profiles.some((p: any) => p.name === profileName);
        if (!profileExists) {
          console.warn(`⚠️ Profile "${profileName}" NOT found in MikroTik. Available: ${profiles.map((p: any) => p.name).join(', ')}`);
        }
      } catch (profErr: any) {
        console.error('Error checking profiles:', profErr.message);
      }

      // Create hotspot user in MikroTik
      try {
        const useProfile = profileExists ? profileName : 'default';
        console.log(`Creating MikroTik hotspot user: name=${vUser}, profile=${useProfile}`);
        await mikrotikRequest(config, '/rest/ip/hotspot/user/add', 'POST', {
          name: vUser, password: vPass, profile: useProfile,
          comment: `NuxBill Voucher - ${plan.name_plan}`,
        });
        mikrotikUserCreated = true;
        console.log(`✅ MikroTik hotspot user created: ${vUser}`);
      } catch (mkErr: any) {
        if (mkErr.message?.includes('already')) {
          mikrotikUserCreated = true;
          console.log(`Hotspot user ${vUser} already exists, skipping creation`);
        } else {
          mikrotikError = mkErr.message || 'Error desconocido';
          console.error(`❌ Error creating MikroTik hotspot user "${vUser}":`, mkErr.message);
        }
      }

      // Authorize client on MikroTik using IP/MAC from portal redirect
      let authorized = false;
      if (ip && mac) {
        try {
          await mikrotikRequest(config, '/rest/ip/hotspot/active/login', 'POST', {
            user: vUser, password: vPass, ip, 'mac-address': mac,
          });
          authorized = true;
          console.log(`NuxBill voucher: authorized ${vUser} ip=${ip} mac=${mac}`);
        } catch (authErr: any) {
          console.log(`active/login failed for voucher (${authErr.message}), trying ip-binding`);
          try {
            await mikrotikRequest(config, '/rest/ip/hotspot/ip-binding/add', 'POST', {
              address: ip, 'mac-address': mac, type: 'bypassed',
              comment: `OmniSync voucher: ${vUser}`,
            });
            authorized = true;
          } catch (bErr: any) {
            if (!bErr.message?.includes('already')) console.error('IP binding failed:', bErr.message);
            else authorized = true;
          }
        }
      }

      return res.json({
        success: true,
        data: {
          username: vUser, password: vPass, profile: profileName,
          plan: plan.name_plan, validity: `${plan.validity} ${plan.validity_unit}`,
          hotspotUrl, type: 'voucher', authorized,
          mikrotikUserCreated, mikrotikError: mikrotikError || undefined,
          profileExists,
        }
      });
    }

    // ── MODE: USERNAME/PASSWORD ──
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Usuario y contraseña requeridos' });
    }

    const customer = await validateCustomer(username, password);
    if (!customer) {
      return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos' });
    }

    const activePlan = await getCustomerActivePlan(username);
    if (!activePlan) {
      return res.status(403).json({ success: false, error: 'No tienes un plan activo' });
    }

    try {
      const users = await mikrotikRequest(config, '/rest/ip/hotspot/user') as any[];
      const existingUser = users.find((u: any) => u.name === username);
      
      if (!existingUser) {
        await mikrotikRequest(config, '/rest/ip/hotspot/user/add', 'POST', {
          name: username, password: password,
          profile: activePlan.name_plan || 'default',
          comment: `NuxBill Customer - ${customer.fullname || username}`,
        });
      }
    } catch (mkErr: any) {
      console.error('MikroTik user sync warning:', mkErr.message);
    }

    // Authorize client on MikroTik using IP/MAC
    if (ip && mac) {
      try {
        await mikrotikRequest(config, '/rest/ip/hotspot/active/login', 'POST', {
          user: username, password, ip, 'mac-address': mac,
        });
        console.log(`NuxBill customer: authorized ${username} ip=${ip} mac=${mac}`);
      } catch (authErr: any) {
        console.log(`active/login failed for customer (${authErr.message}), trying ip-binding`);
        try {
          await mikrotikRequest(config, '/rest/ip/hotspot/ip-binding/add', 'POST', {
            address: ip, 'mac-address': mac, type: 'bypassed',
            comment: `OmniSync customer: ${username}`,
          });
        } catch (bErr: any) {
          if (!bErr.message?.includes('already')) console.error('IP binding failed:', bErr.message);
        }
      }
    }

    return res.json({
      success: true,
      data: {
        username, profile: activePlan.name_plan || 'default',
        plan: activePlan.name_plan, expiration: activePlan.expiration,
        hotspotUrl, type: 'customer', fullname: customer.fullname, authorized: !!(ip && mac),
      }
    });

  } catch (error: any) {
    console.error('NuxBill login error:', error);
    res.status(500).json({ success: false, error: error.message || 'Error de autenticación' });
  }
});
