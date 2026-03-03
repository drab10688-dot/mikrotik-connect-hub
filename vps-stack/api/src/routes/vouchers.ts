import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { pool } from '../server';

export const vouchersRouter = Router();

// List vouchers from DB
vouchersRouter.get('/:mikrotikId', async (req: AuthRequest, res: Response) => {
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
vouchersRouter.post('/:mikrotikId/generate', async (req: AuthRequest, res: Response) => {
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
vouchersRouter.post('/:mikrotikId/sell/:voucherId', async (req: AuthRequest, res: Response) => {
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
vouchersRouter.delete('/:mikrotikId/:voucherId', async (req: AuthRequest, res: Response) => {
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

// Voucher presets
vouchersRouter.get('/:mikrotikId/presets', async (req: AuthRequest, res: Response) => {
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
vouchersRouter.get('/:mikrotikId/sales-history', async (req: AuthRequest, res: Response) => {
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
