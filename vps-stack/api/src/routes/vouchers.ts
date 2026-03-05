import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { pool } from '../server';

export const vouchersRouter = Router();

// ── Inventory (list vouchers from DB with query param) ──
vouchersRouter.get('/inventory', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.query.mikrotik_id as string;
    if (!mikrotikId) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      'SELECT * FROM vouchers WHERE mikrotik_id = $1 ORDER BY created_at DESC',
      [mikrotikId]
    );
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Sync vouchers from MikroTik ──
vouchersRouter.post('/sync', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id } = req.body;
    if (!mikrotik_id) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotik_id);

    // Get all hotspot users from MikroTik
    let mtUsers: any[] = [];
    try {
      mtUsers = await mikrotikRequest(config, '/rest/ip/hotspot/user') as any[];
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo conectar a MikroTik para sincronizar' });
    }

    // Get existing vouchers from DB
    const { rows: existingVouchers } = await pool.query(
      'SELECT code FROM vouchers WHERE mikrotik_id = $1',
      [mikrotik_id]
    );
    const existingCodes = new Set(existingVouchers.map(v => v.code));

    // Filter vouchers (users with "OmniSync" in comment)
    const omnisyncUsers = mtUsers.filter((u: any) =>
      u.comment && u.comment.includes('OmniSync')
    );

    let updated = 0;
    let deleted = 0;

    // Remove DB vouchers whose code no longer exists in MikroTik
    for (const existing of existingVouchers) {
      const stillExists = mtUsers.some((u: any) => u.name === existing.code);
      if (!stillExists) {
        await pool.query('DELETE FROM vouchers WHERE code = $1 AND mikrotik_id = $2', [existing.code, mikrotik_id]);
        deleted++;
      }
    }

    // Add MikroTik vouchers that aren't in DB
    for (const mtUser of omnisyncUsers) {
      if (!existingCodes.has(mtUser.name)) {
        const validityMatch = mtUser.comment?.match(/validity=([^\s|]+)/);
        const validity = validityMatch ? validityMatch[1] : mtUser['limit-uptime'] || '1d';
        await pool.query(
          `INSERT INTO vouchers (mikrotik_id, created_by, code, password, profile, validity, price, status)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 'available')
           ON CONFLICT DO NOTHING`,
          [mikrotik_id, req.userId, mtUser.name, mtUser.password || '', mtUser.profile || 'default', validity]
        );
        updated++;
      }
    }

    res.json({ success: true, updated, deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Archive expired voucher ──
vouchersRouter.post('/:voucherId/archive', async (req: AuthRequest, res: Response) => {
  try {
    const { voucherId } = req.params;
    const { mikrotik_id, uptime } = req.body;

    if (!mikrotik_id) return res.status(400).json({ error: 'mikrotik_id requerido' });

    // Get voucher info
    const { rows: voucherRows } = await pool.query(
      'SELECT * FROM vouchers WHERE id = $1 AND mikrotik_id = $2',
      [voucherId, mikrotik_id]
    );

    if (!voucherRows[0]) return res.status(404).json({ error: 'Voucher no encontrado' });

    const voucher = voucherRows[0];

    // Save to sales history
    try {
      await pool.query(
        `INSERT INTO voucher_sales_history 
         (mikrotik_id, created_by, voucher_code, voucher_password, profile, validity, price, sold_by, sold_at, activated_at, total_uptime, expired_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
        [
          mikrotik_id, voucher.created_by, voucher.code, voucher.password,
          voucher.profile, voucher.validity, voucher.price || 0,
          voucher.sold_by, voucher.sold_at, voucher.activated_at, uptime || null
        ]
      );
    } catch (histErr) {
      console.error('Error archiving to sales history:', histErr);
    }

    // Remove from MikroTik
    try {
      const config = await getDeviceConfig(pool, mikrotik_id);
      const users: any = await mikrotikRequest(config, '/rest/ip/hotspot/user');
      const mtUser = (users as any[]).find((u: any) => u.name === voucher.code);
      if (mtUser) {
        await mikrotikRequest(config, '/rest/ip/hotspot/user/remove', 'POST', { '.id': mtUser['.id'] });
      }
    } catch { /* ignore MikroTik errors */ }

    // Delete from vouchers table
    await pool.query('DELETE FROM vouchers WHERE id = $1', [voucherId]);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Update voucher status ──
vouchersRouter.put('/:voucherId', async (req: AuthRequest, res: Response) => {
  try {
    const { voucherId } = req.params;
    const { status } = req.body;

    const validStatuses = ['available', 'sold', 'used', 'expired'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const { rows } = await pool.query(
      'UPDATE vouchers SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, voucherId]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Voucher no encontrado' });

    res.json({ success: true, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Presets (managed here to avoid route collision) ──
vouchersRouter.get('/presets/all', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.query.mikrotik_id as string;
    const { rows } = await pool.query(
      'SELECT * FROM voucher_presets WHERE mikrotik_id = $1 ORDER BY name',
      [mikrotikId || '']
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List vouchers from DB (by mikrotikId path param)
vouchersRouter.get('/:mikrotikId([0-9a-fA-F-]{36})', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      'SELECT * FROM vouchers WHERE mikrotik_id = $1 ORDER BY created_at DESC',
      [mikrotikId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Generate vouchers
vouchersRouter.post('/:mikrotikId([0-9a-fA-F-]{36})/generate', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { count, profile, validity, price, prefix } = req.body;
    const config = await getDeviceConfig(pool, mikrotikId);
    const vouchers: any[] = [];

    for (let i = 0; i < (count || 1); i++) {
      const code = `${prefix || 'VS'}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const password = Math.random().toString(36).substring(2, 8);

      // Create in MikroTik
      const comment = `OmniSync Voucher | validity=${validity} | created=${new Date().toISOString()}`;
      await mikrotikRequest(config, '/rest/ip/hotspot/user/add', 'POST', {
        name: code,
        password,
        profile: profile || 'default',
        comment,
        'limit-uptime': validity || '1d',
      });

      // Save in DB
      const { rows } = await pool.query(
        `INSERT INTO vouchers (mikrotik_id, created_by, code, password, profile, validity, price, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'available') RETURNING *`,
        [mikrotikId, req.userId, code, password, profile, validity, price || 0]
      );

      vouchers.push(rows[0]);
    }

    res.json({ success: true, data: vouchers });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Sell voucher
vouchersRouter.post('/:mikrotikId([0-9a-fA-F-]{36})/sell/:voucherId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, voucherId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `UPDATE vouchers SET status = 'sold', sold_by = $1, sold_at = now()
       WHERE id = $2 AND mikrotik_id = $3 AND status = 'available' RETURNING *`,
      [req.userId, voucherId, mikrotikId]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Voucher no disponible' });

    res.json({ success: true, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete voucher
vouchersRouter.delete('/:mikrotikId([0-9a-fA-F-]{36})/:voucherId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, voucherId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    // Get voucher code to delete from MikroTik
    const { rows: voucher } = await pool.query('SELECT code FROM vouchers WHERE id = $1', [voucherId]);
    if (voucher[0]) {
      try {
        const config = await getDeviceConfig(pool, mikrotikId);
        const users: any = await mikrotikRequest(config, '/rest/ip/hotspot/user');
        const mtUser = (users as any[]).find((u: any) => u.name === voucher[0].code);
        if (mtUser) {
          await mikrotikRequest(config, '/rest/ip/hotspot/user/remove', 'POST', { '.id': mtUser['.id'] });
        }
      } catch { /* ignore MikroTik errors on cleanup */ }
    }

    await pool.query('DELETE FROM vouchers WHERE id = $1 AND mikrotik_id = $2', [voucherId, mikrotikId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Voucher presets by mikrotikId
vouchersRouter.get('/:mikrotikId([0-9a-fA-F-]{36})/presets', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const { rows } = await pool.query(
      'SELECT * FROM voucher_presets WHERE mikrotik_id = $1 ORDER BY name',
      [mikrotikId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Sales history
vouchersRouter.get('/:mikrotikId([0-9a-fA-F-]{36})/sales-history', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `SELECT vsh.*, u.email as sold_by_email, u.full_name as sold_by_name
       FROM voucher_sales_history vsh
       LEFT JOIN users u ON u.id = vsh.sold_by
       WHERE vsh.mikrotik_id = $1
       ORDER BY vsh.created_at DESC`,
      [mikrotikId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
