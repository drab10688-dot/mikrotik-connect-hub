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
        WHERE uma.user_id = $1 AND md.status = 'active'::device_status
        UNION
        SELECT md.* FROM mikrotik_devices md
        INNER JOIN secretary_assignments sa ON sa.mikrotik_id = md.id
        WHERE sa.secretary_id = $1 AND md.status = 'active'::device_status
        UNION
        SELECT md.* FROM mikrotik_devices md
        INNER JOIN reseller_assignments ra ON ra.mikrotik_id = md.id
        WHERE ra.reseller_id = $1 AND md.status = 'active'::device_status
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active'::device_status) RETURNING *`,
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

// ─── Reseller Assignments ─────────────────────
devicesRouter.get('/:id/resellers', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `SELECT ra.*, u.email, u.full_name
       FROM reseller_assignments ra
       LEFT JOIN users u ON u.id = ra.reseller_id
       WHERE ra.mikrotik_id = $1`,
      [id]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.post('/:id/resellers', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reseller_id, commission_percentage } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO reseller_assignments (reseller_id, mikrotik_id, assigned_by, commission_percentage)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [reseller_id, id, req.userId, commission_percentage || 0]
    );
    res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.put('/resellers/:assignmentId', async (req: AuthRequest, res: Response) => {
  try {
    const { assignmentId } = req.params;
    const { commission_percentage } = req.body;
    const { rows } = await pool.query(
      'UPDATE reseller_assignments SET commission_percentage = $1 WHERE id = $2 RETURNING *',
      [commission_percentage, assignmentId]
    );
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.delete('/resellers/:assignmentId', async (req: AuthRequest, res: Response) => {
  try {
    const { assignmentId } = req.params;
    await pool.query('DELETE FROM reseller_assignments WHERE id = $1', [assignmentId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Secretary Assignments ────────────────────
devicesRouter.get('/my-secretary-assignments', async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT sa.*, md.name as device_name, md.host
       FROM secretary_assignments sa
       INNER JOIN mikrotik_devices md ON md.id = sa.mikrotik_id
       WHERE sa.secretary_id = $1`,
      [req.userId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.get('/:id/secretaries', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `SELECT sa.*, u.email, u.full_name
       FROM secretary_assignments sa
       LEFT JOIN users u ON u.id = sa.secretary_id
       WHERE sa.mikrotik_id = $1`,
      [id]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.post('/:id/secretaries', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      secretary_id, can_manage_pppoe, can_create_pppoe, can_edit_pppoe,
      can_delete_pppoe, can_disconnect_pppoe, can_toggle_pppoe,
      can_manage_queues, can_create_queues, can_edit_queues,
      can_delete_queues, can_toggle_queues, can_suspend_queues, can_reactivate_queues
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO secretary_assignments (
        secretary_id, mikrotik_id, assigned_by,
        can_manage_pppoe, can_create_pppoe, can_edit_pppoe, can_delete_pppoe,
        can_disconnect_pppoe, can_toggle_pppoe,
        can_manage_queues, can_create_queues, can_edit_queues, can_delete_queues,
        can_toggle_queues, can_suspend_queues, can_reactivate_queues
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [secretary_id, id, req.userId,
       can_manage_pppoe ?? true, can_create_pppoe ?? true, can_edit_pppoe ?? true, can_delete_pppoe ?? true,
       can_disconnect_pppoe ?? true, can_toggle_pppoe ?? true,
       can_manage_queues ?? true, can_create_queues ?? true, can_edit_queues ?? true, can_delete_queues ?? true,
       can_toggle_queues ?? true, can_suspend_queues ?? true, can_reactivate_queues ?? true]
    );
    res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.put('/secretaries/:assignmentId', async (req: AuthRequest, res: Response) => {
  try {
    const { assignmentId } = req.params;
    const fields = req.body;
    const setClauses: string[] = [];
    const values: any[] = [];
    let i = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (key.startsWith('can_')) {
        setClauses.push(`${key} = $${i}`);
        values.push(value);
        i++;
      }
    }

    if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(assignmentId);
    const { rows } = await pool.query(
      `UPDATE secretary_assignments SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.delete('/secretaries/:assignmentId', async (req: AuthRequest, res: Response) => {
  try {
    const { assignmentId } = req.params;
    await pool.query('DELETE FROM secretary_assignments WHERE id = $1', [assignmentId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
