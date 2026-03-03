import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { pool } from '../server';

export const contractsRouter = Router();

// List contracts
contractsRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.query.mikrotik_id as string;
    if (!mikrotikId) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `SELECT * FROM isp_contracts WHERE mikrotik_id = $1 ORDER BY created_at DESC`,
      [mikrotikId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single contract
contractsRouter.get('/verify/:contractNumber', async (_req: any, res: Response) => {
  try {
    const { contractNumber } = _req.params;
    const { rows } = await pool.query(
      `SELECT c.*, cl.client_name, cl.identification_number, cl.phone, cl.email
       FROM isp_contracts c
       LEFT JOIN isp_clients cl ON cl.id = c.client_id
       WHERE c.contract_number = $1`,
      [contractNumber]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Contrato no encontrado' });
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

contractsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT * FROM isp_contracts WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Contrato no encontrado' });
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create contract
contractsRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const {
      mikrotik_id, client_id, contract_number, client_name, identification,
      address, phone, email, plan, speed, price, service_option, service_price,
      total_price, equipment, client_signature_url, manager_signature_url, status
    } = req.body;

    if (!mikrotik_id) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `INSERT INTO isp_contracts (
        mikrotik_id, client_id, created_by, contract_number, client_name,
        identification, address, phone, email, plan, speed, price,
        service_option, service_price, total_price, equipment,
        client_signature_url, manager_signature_url, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *`,
      [mikrotik_id, client_id, req.userId, contract_number, client_name,
       identification, address, phone, email, plan, speed, price,
       service_option, service_price, total_price, equipment || [],
       client_signature_url, manager_signature_url, status || 'draft']
    );

    res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update contract
contractsRouter.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const setClauses: string[] = [];
    const values: any[] = [];
    let i = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (key === 'id' || key === 'created_by' || key === 'created_at') continue;
      setClauses.push(`${key} = $${i}`);
      values.push(value);
      i++;
    }

    if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE isp_contracts SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );

    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete contract
contractsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM isp_contracts WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
