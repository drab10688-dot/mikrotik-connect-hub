import { Router, Response } from 'express';
import { pool } from '../server';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest } from '../lib/mikrotik';

export const devicesRouter = Router();

// List devices user has access to
devicesRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    let query: string;
    let params: string[];

    if (req.userRole === 'super_admin') {
      query = 'SELECT * FROM mikrotik_devices ORDER BY name';
      params = [];
    } else {
      query = `
        SELECT md.* FROM mikrotik_devices md
        INNER JOIN user_mikrotik_access uma ON uma.mikrotik_id = md.id
        WHERE uma.user_id = $1 AND md.status = 'active'
        UNION
        SELECT md.* FROM mikrotik_devices md
        INNER JOIN secretary_assignments sa ON sa.mikrotik_id = md.id
        WHERE sa.secretary_id = $1 AND md.status = 'active'
        UNION
        SELECT md.* FROM mikrotik_devices md
        INNER JOIN reseller_assignments ra ON ra.mikrotik_id = md.id
        WHERE ra.reseller_id = $1 AND md.status = 'active'
        ORDER BY name`;
      params = [req.userId!];
    }

    const { rows } = await pool.query(query, params);
    res.json({ data: rows });
  } catch (error) {
    console.error('Error listing devices:', error);
    res.status(500).json({ error: 'Error al listar dispositivos' });
  }
});

// Test connection
devicesRouter.post('/:id/connect', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso a este dispositivo' });

    const { rows } = await pool.query('SELECT host, port, username, password FROM mikrotik_devices WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Dispositivo no encontrado' });

    const config = rows[0];
    const useTls = config.port === 443 || config.port === 8729;
    const data = await mikrotikRequest(
      { ...config, useTls },
      '/rest/system/resource'
    );

    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add device
devicesRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, host, port, username, password, version } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO mikrotik_devices (name, host, port, username, password, version, created_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active') RETURNING *`,
      [name, host, port || 443, username, password, version || 'v7', req.userId]
    );

    // Auto-assign access
    await pool.query(
      'INSERT INTO user_mikrotik_access (user_id, mikrotik_id, granted_by) VALUES ($1, $2, $1)',
      [req.userId, rows[0].id]
    );

    res.status(201).json({ data: rows[0] });
  } catch (error) {
    console.error('Error adding device:', error);
    res.status(500).json({ error: 'Error al agregar dispositivo' });
  }
});

// Update device
devicesRouter.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { name, host, port, username, password, version } = req.body;
    const { rows } = await pool.query(
      `UPDATE mikrotik_devices SET name=$1, host=$2, port=$3, username=$4, password=$5, version=$6
       WHERE id=$7 RETURNING *`,
      [name, host, port, username, password, version, id]
    );

    res.json({ data: rows[0] });
  } catch (error) {
    console.error('Error updating device:', error);
    res.status(500).json({ error: 'Error al actualizar dispositivo' });
  }
});

// Delete device
devicesRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (req.userRole !== 'super_admin') {
      return res.status(403).json({ error: 'Solo super_admin puede eliminar dispositivos' });
    }

    await pool.query('DELETE FROM mikrotik_devices WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).json({ error: 'Error al eliminar dispositivo' });
  }
});
