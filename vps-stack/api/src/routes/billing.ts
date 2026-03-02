import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { pool } from '../server';

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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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

// Get client billing settings
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

// Update client billing settings
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
