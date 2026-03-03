import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../server';

export const voucherPresetsRouter = Router();

// Create preset
voucherPresetsRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id, name, validity, price, description } = req.body;
    if (!mikrotik_id || !name || !validity) {
      return res.status(400).json({ error: 'mikrotik_id, name y validity requeridos' });
    }

    const { rows } = await pool.query(
      `INSERT INTO voucher_presets (mikrotik_id, created_by, name, validity, price, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [mikrotik_id, req.userId, name, validity, price || 0, description]
    );
    res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update preset
voucherPresetsRouter.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, validity, price, description } = req.body;
    const { rows } = await pool.query(
      `UPDATE voucher_presets SET name=$1, validity=$2, price=$3, description=$4 WHERE id=$5 RETURNING *`,
      [name, validity, price, description, id]
    );
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete preset
voucherPresetsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM voucher_presets WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
