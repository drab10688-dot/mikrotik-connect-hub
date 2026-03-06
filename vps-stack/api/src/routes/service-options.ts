import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { pool } from '../lib/db';

export const serviceOptionsRouter = Router();

// List service options
serviceOptionsRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.query.mikrotik_id as string;
    if (!mikrotikId) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      'SELECT * FROM service_options WHERE mikrotik_id = $1 ORDER BY name',
      [mikrotikId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create
serviceOptionsRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id, name, description, price, is_default } = req.body;
    if (!mikrotik_id) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `INSERT INTO service_options (mikrotik_id, created_by, name, description, price, is_default)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [mikrotik_id, req.userId, name, description, price || 0, is_default || false]
    );
    res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

serviceOptionsRouter.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rows: currentRows } = await pool.query('SELECT * FROM service_options WHERE id = $1', [id]);
    if (!currentRows[0]) return res.status(404).json({ error: 'Servicio no encontrado' });

    const current = currentRows[0];
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, current.mikrotik_id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const nextName = req.body.name ?? current.name;
    const nextDescription = req.body.description ?? current.description;
    const nextPrice = req.body.price ?? current.price;
    const nextIsDefault = req.body.is_default ?? current.is_default;

    const { rows } = await pool.query(
      `UPDATE service_options
       SET name=$1, description=$2, price=$3, is_default=$4, updated_at=now()
       WHERE id=$5
       RETURNING *`,
      [nextName, nextDescription, nextPrice, nextIsDefault, id]
    );

    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete
serviceOptionsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { rows: currentRows } = await pool.query('SELECT mikrotik_id FROM service_options WHERE id = $1', [id]);
    if (!currentRows[0]) return res.status(404).json({ error: 'Servicio no encontrado' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, currentRows[0].mikrotik_id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    await pool.query('DELETE FROM service_options WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
