import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { pool } from '../server';

export const invoicesRouter = Router();

// List invoices
invoicesRouter.get('/:mikrotikId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const status = req.query.status as string;
    let query = `SELECT i.*, c.client_name, c.identification_number, c.username
                 FROM client_invoices i
                 LEFT JOIN isp_clients c ON c.id = i.client_id
                 WHERE i.mikrotik_id = $1`;
    const params: any[] = [mikrotikId];

    if (status) {
      query += ` AND i.status = $2`;
      params.push(status);
    }

    query += ' ORDER BY i.due_date DESC';

    const { rows } = await pool.query(query, params);
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create invoice
invoicesRouter.post('/:mikrotikId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const {
      client_id, invoice_number, amount, due_date,
      billing_period_start, billing_period_end, service_breakdown
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO client_invoices (mikrotik_id, client_id, invoice_number, amount, due_date,
        billing_period_start, billing_period_end, service_breakdown)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [mikrotikId, client_id, invoice_number, amount, due_date,
       billing_period_start, billing_period_end, service_breakdown]
    );

    res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Record payment
invoicesRouter.post('/:mikrotikId/pay/:invoiceId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, invoiceId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { paid_via, payment_reference, amount } = req.body;

    // Update invoice
    const { rows } = await pool.query(
      `UPDATE client_invoices SET status = 'paid', paid_at = now(), paid_via = $1, payment_reference = $2
       WHERE id = $3 AND mikrotik_id = $4 RETURNING *`,
      [paid_via, payment_reference, invoiceId, mikrotikId]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });

    // Record transaction
    await pool.query(
      `INSERT INTO payment_transactions (mikrotik_id, invoice_id, platform, amount, status)
       VALUES ($1, $2, $3, $4, 'approved')`,
      [mikrotikId, invoiceId, paid_via || 'cash', amount || rows[0].amount]
    );

    // Reactivate client if suspended
    if (rows[0].client_id) {
      await pool.query(
        `UPDATE client_billing_settings SET is_suspended = false, suspended_at = null, last_payment_date = CURRENT_DATE
         WHERE client_id = $1`,
        [rows[0].client_id]
      );
    }

    res.json({ success: true, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete invoice
invoicesRouter.delete('/:mikrotikId/:invoiceId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, invoiceId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    await pool.query('DELETE FROM client_invoices WHERE id = $1 AND mikrotik_id = $2', [invoiceId, mikrotikId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Generate batch invoices
invoicesRouter.post('/generate', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id } = req.body;
    if (!mikrotik_id) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    // Get all clients with billing settings
    const { rows: clients } = await pool.query(
      `SELECT c.id, c.client_name, c.username, bs.monthly_amount, bs.billing_day
       FROM isp_clients c
       INNER JOIN client_billing_settings bs ON bs.client_id = c.id
       WHERE c.mikrotik_id = $1 AND c.is_potential_client = false AND bs.monthly_amount > 0`,
      [mikrotik_id]
    );

    const now = new Date();
    const invoices: any[] = [];

    for (const client of clients) {
      const invoiceNumber = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${client.username}`;
      const billingStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const billingEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const dueDate = new Date(now.getFullYear(), now.getMonth(), client.billing_day || 1);
      if (dueDate < now) dueDate.setMonth(dueDate.getMonth() + 1);

      try {
        const { rows } = await pool.query(
          `INSERT INTO client_invoices (mikrotik_id, client_id, invoice_number, amount, due_date, billing_period_start, billing_period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [mikrotik_id, client.id, invoiceNumber, client.monthly_amount,
           dueDate.toISOString().slice(0, 10), billingStart.toISOString().slice(0, 10), billingEnd.toISOString().slice(0, 10)]
        );
        invoices.push(rows[0]);
      } catch (e) { /* skip duplicate */ }
    }

    res.json({ success: true, data: invoices, generated: invoices.length, total: clients.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Generate single client invoice
invoicesRouter.post('/generate-single', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id, client_id, amount, due_date, billing_period_start, billing_period_end } = req.body;
    if (!mikrotik_id || !client_id) return res.status(400).json({ error: 'mikrotik_id y client_id requeridos' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows: clientRows } = await pool.query('SELECT username FROM isp_clients WHERE id = $1', [client_id]);
    const now = new Date();
    const invoiceNumber = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${clientRows[0]?.username || 'CLI'}`;

    const { rows } = await pool.query(
      `INSERT INTO client_invoices (mikrotik_id, client_id, invoice_number, amount, due_date, billing_period_start, billing_period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [mikrotik_id, client_id, invoiceNumber, amount,
       due_date || now.toISOString().slice(0, 10),
       billing_period_start || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
       billing_period_end || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)]
    );

    res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Paid history
invoicesRouter.get('/paid-history', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.query.mikrotik_id as string;
    const startDate = req.query.start_date as string;
    const endDate = req.query.end_date as string;

    if (!mikrotikId) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    let query = `SELECT i.*, c.client_name, c.identification_number
                 FROM client_invoices i
                 LEFT JOIN isp_clients c ON c.id = i.client_id
                 WHERE i.mikrotik_id = $1 AND i.status = 'paid'`;
    const params: any[] = [mikrotikId];

    if (startDate) {
      query += ` AND i.paid_at >= $${params.length + 1}`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND i.paid_at <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += ' ORDER BY i.paid_at DESC';
    const { rows } = await pool.query(query, params);
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
