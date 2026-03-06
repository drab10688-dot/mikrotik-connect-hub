import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { pool } from '../lib/db';

export const billingRouter = Router();

// Get billing config
billingRouter.get('/:mikrotikId/config', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query('SELECT * FROM billing_config WHERE mikrotik_id = $1', [mikrotikId]);
    res.json({ data: rows[0] || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Upsert billing config
billingRouter.post('/:mikrotikId/config', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const {
      billing_type, billing_day, invoice_maturity_days, grace_period_days,
      reminder_days_before, suspension_address_list, auto_send_telegram, auto_send_whatsapp
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO billing_config (mikrotik_id, created_by, billing_type, billing_day,
        invoice_maturity_days, grace_period_days, reminder_days_before,
        suspension_address_list, auto_send_telegram, auto_send_whatsapp)
       VALUES ($1, $2, $3::billing_type, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (mikrotik_id) DO UPDATE SET
        billing_type = EXCLUDED.billing_type,
        billing_day = EXCLUDED.billing_day,
        invoice_maturity_days = EXCLUDED.invoice_maturity_days,
        grace_period_days = EXCLUDED.grace_period_days,
        reminder_days_before = EXCLUDED.reminder_days_before,
        suspension_address_list = EXCLUDED.suspension_address_list,
        auto_send_telegram = EXCLUDED.auto_send_telegram,
        auto_send_whatsapp = EXCLUDED.auto_send_whatsapp
       RETURNING *`,
      [mikrotikId, req.userId, billing_type || 'advance', billing_day || 1,
       invoice_maturity_days || 15, grace_period_days || 5, reminder_days_before || 3,
       suspension_address_list || 'morosos', auto_send_telegram || false, auto_send_whatsapp || false]
    );

    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get client billing settings (compatible with frontend billingApi.clientSettings)
billingRouter.get('/client/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const { clientId } = req.params;
    const { rows } = await pool.query(
      'SELECT * FROM client_billing_settings WHERE client_id = $1',
      [clientId]
    );
    res.json({ data: rows[0] || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update client billing settings (compatible with frontend)
billingRouter.put('/client/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const { clientId } = req.params;
    const { monthly_amount, billing_day, grace_period_days, reminder_days_before, mikrotik_id } = req.body;

    const resolvedMikrotikId = mikrotik_id || (await pool.query('SELECT mikrotik_id FROM isp_clients WHERE id = $1', [clientId])).rows[0]?.mikrotik_id;

    const { rows } = await pool.query(
      `INSERT INTO client_billing_settings (client_id, mikrotik_id, monthly_amount, billing_day, grace_period_days, reminder_days_before)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (client_id) DO UPDATE SET
        monthly_amount = EXCLUDED.monthly_amount,
        billing_day = EXCLUDED.billing_day,
        grace_period_days = EXCLUDED.grace_period_days,
        reminder_days_before = EXCLUDED.reminder_days_before
       RETURNING *`,
      [clientId, resolvedMikrotikId, monthly_amount, billing_day || 1, grace_period_days || 5, reminder_days_before || 3]
    );

    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get client billing by mikrotik+client (original route)
billingRouter.get('/:mikrotikId/clients/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, clientId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      'SELECT * FROM client_billing_settings WHERE client_id = $1 AND mikrotik_id = $2',
      [clientId, mikrotikId]
    );
    res.json({ data: rows[0] || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update client billing by mikrotik+client (original route)
billingRouter.put('/:mikrotikId/clients/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, clientId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { monthly_amount, billing_day, grace_period_days, reminder_days_before } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO client_billing_settings (client_id, mikrotik_id, monthly_amount, billing_day, grace_period_days, reminder_days_before)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (client_id) DO UPDATE SET
        monthly_amount = EXCLUDED.monthly_amount,
        billing_day = EXCLUDED.billing_day,
        grace_period_days = EXCLUDED.grace_period_days,
        reminder_days_before = EXCLUDED.reminder_days_before
       RETURNING *`,
      [clientId, mikrotikId, monthly_amount, billing_day || 1, grace_period_days || 5, reminder_days_before || 3]
    );

    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List all billing settings for a mikrotik
billingRouter.get('/settings', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.query.mikrotik_id as string;
    if (!mikrotikId) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `SELECT bs.*, c.client_name, c.username, c.identification_number
       FROM client_billing_settings bs
       LEFT JOIN isp_clients c ON c.id = bs.client_id
       WHERE bs.mikrotik_id = $1
       ORDER BY c.client_name`,
      [mikrotikId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Suspension status
billingRouter.get('/suspension-status', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.query.mikrotik_id as string;
    if (!mikrotikId) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `SELECT bs.*, c.client_name, c.username, c.identification_number
       FROM client_billing_settings bs
       LEFT JOIN isp_clients c ON c.id = bs.client_id
       WHERE bs.mikrotik_id = $1 AND bs.is_suspended = true
       ORDER BY bs.suspended_at DESC`,
      [mikrotikId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Payment platforms
billingRouter.get('/platforms', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.query.mikrotik_id as string;
    if (!mikrotikId) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const { rows } = await pool.query(
      'SELECT * FROM payment_platforms WHERE mikrotik_id = $1 ORDER BY platform',
      [mikrotikId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

billingRouter.post('/platforms', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id, platform, public_key, private_key, webhook_secret, environment, is_active } = req.body;
    if (!mikrotik_id || !platform) return res.status(400).json({ error: 'mikrotik_id y platform requeridos' });

    const { rows } = await pool.query(
      `INSERT INTO payment_platforms (mikrotik_id, created_by, platform, public_key, private_key, webhook_secret, environment, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [mikrotik_id, req.userId, platform, public_key, private_key, webhook_secret, environment || 'sandbox', is_active ?? false]
    );

    // If conflict, update instead
    if (!rows[0]) {
      const { rows: updated } = await pool.query(
        `UPDATE payment_platforms SET public_key=$1, private_key=$2, webhook_secret=$3, environment=$4, is_active=$5
         WHERE mikrotik_id=$6 AND platform=$7 RETURNING *`,
        [public_key, private_key, webhook_secret, environment || 'sandbox', is_active ?? false, mikrotik_id, platform]
      );
      return res.json({ data: updated[0] });
    }

    res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

billingRouter.delete('/platforms/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM payment_platforms WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Transactions
billingRouter.get('/transactions', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.query.mikrotik_id as string;
    if (!mikrotikId) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    let query = `SELECT t.*, i.invoice_number, i.client_id
                 FROM payment_transactions t
                 LEFT JOIN client_invoices i ON i.id = t.invoice_id
                 WHERE t.mikrotik_id = $1`;
    const params: any[] = [mikrotikId];

    const status = req.query.status as string;
    if (status) {
      query += ` AND t.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ' ORDER BY t.created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
