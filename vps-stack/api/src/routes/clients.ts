import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { pool } from '../server';

export const clientsRouter = Router();

// List clients
clientsRouter.get('/:mikrotikId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `SELECT c.*, bs.monthly_amount, bs.is_suspended, bs.billing_day, bs.next_billing_date
       FROM isp_clients c
       LEFT JOIN client_billing_settings bs ON bs.client_id = c.id
       WHERE c.mikrotik_id = $1 AND c.is_potential_client = false
       ORDER BY c.client_name`,
      [mikrotikId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Add client
clientsRouter.post('/:mikrotikId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const {
      client_name, identification_number, username, connection_type,
      plan_or_speed, assigned_ip, phone, email, address, city,
      latitude, longitude, comment, service_option, service_price,
      total_monthly_price
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO isp_clients (
        mikrotik_id, created_by, client_name, identification_number, username,
        connection_type, plan_or_speed, assigned_ip, phone, email, address,
        city, latitude, longitude, comment, service_option, service_price,
        total_monthly_price
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *`,
      [mikrotikId, req.userId, client_name, identification_number, username,
       connection_type, plan_or_speed, assigned_ip, phone, email, address,
       city, latitude, longitude, comment, service_option, service_price || 0,
       total_monthly_price || 0]
    );

    // Auto-create billing settings
    if (total_monthly_price && total_monthly_price > 0) {
      await pool.query(
        `INSERT INTO client_billing_settings (client_id, mikrotik_id, monthly_amount)
         VALUES ($1, $2, $3)`,
        [rows[0].id, mikrotikId, total_monthly_price]
      );
    }

    res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update client
clientsRouter.put('/:mikrotikId/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, clientId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const fields = req.body;
    const setClauses: string[] = [];
    const values: any[] = [];
    let i = 1;

    for (const [key, value] of Object.entries(fields)) {
      setClauses.push(`${key} = $${i}`);
      values.push(value);
      i++;
    }

    values.push(clientId, mikrotikId);
    const { rows } = await pool.query(
      `UPDATE isp_clients SET ${setClauses.join(', ')} WHERE id = $${i} AND mikrotik_id = $${i + 1} RETURNING *`,
      values
    );

    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete client
clientsRouter.delete('/:mikrotikId/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, clientId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    await pool.query('DELETE FROM isp_clients WHERE id = $1 AND mikrotik_id = $2', [clientId, mikrotikId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Search client by identification
clientsRouter.get('/search/identification/:identification', async (req: AuthRequest, res: Response) => {
  try {
    const { identification } = req.params;
    const { rows } = await pool.query(
      `SELECT c.*, bs.monthly_amount, bs.is_suspended, bs.billing_day
       FROM isp_clients c
       LEFT JOIN client_billing_settings bs ON bs.client_id = c.id
       WHERE c.identification_number = $1 AND c.is_potential_client = false`,
      [identification]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
