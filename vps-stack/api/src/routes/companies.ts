import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../lib/db';

export const companiesRouter = Router();

// Listar empresas: super_admin ve todas, el resto solo la suya
companiesRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const isSuper = req.userRole === 'super_admin';
    const { rows } = await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS users_count,
              (SELECT COUNT(*) FROM mikrotik_devices d WHERE d.company_id = c.id) AS devices_count,
              (SELECT COUNT(*) FROM isp_clients ic WHERE ic.company_id = c.id) AS clients_count
       FROM companies c
       ${isSuper ? '' : 'WHERE c.id = $1'}
       ORDER BY c.name`,
      isSuper ? [] : [req.companyId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Crear empresa (solo super_admin), opcionalmente con su usuario administrador
companiesRouter.post('/', async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    if (req.userRole !== 'super_admin') {
      return res.status(403).json({ error: 'Solo super_admin puede crear empresas' });
    }

    const {
      name, tax_id, contact_email, contact_phone, address, logo_url,
      plan, max_devices, max_clients,
      admin_email, admin_password, admin_full_name,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'El nombre de la empresa es requerido' });

    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO companies (name, tax_id, contact_email, contact_phone, address, logo_url, plan, max_devices, max_clients)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, tax_id || null, contact_email || null, contact_phone || null, address || null,
       logo_url || null, plan || 'standard', max_devices || 0, max_clients || 0]
    );
    const company = rows[0];

    if (admin_email && admin_password) {
      const password_hash = await bcrypt.hash(admin_password, await bcrypt.genSalt(12));
      const { rows: userRows } = await client.query(
        `INSERT INTO users (email, password_hash, full_name, company_id)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [String(admin_email).toLowerCase(), password_hash, admin_full_name || name, company.id]
      );
      await client.query(
        `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin'::app_role)
         ON CONFLICT (user_id, role) DO NOTHING`,
        [userRows[0].id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ data: company });
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ error: 'El email del administrador ya está registrado' });
    }
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Actualizar empresa: super_admin cualquiera, admin solo la suya (datos básicos)
companiesRouter.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const isSuper = req.userRole === 'super_admin';

    if (!isSuper) {
      if (req.userRole !== 'admin' || req.companyId !== id) {
        return res.status(403).json({ error: 'Sin permiso sobre esta empresa' });
      }
    }

    const { name, tax_id, contact_email, contact_phone, address, logo_url, plan, max_devices, max_clients, is_active } = req.body;

    const { rows } = await pool.query(
      `UPDATE companies SET
         name = COALESCE($2, name),
         tax_id = COALESCE($3, tax_id),
         contact_email = COALESCE($4, contact_email),
         contact_phone = COALESCE($5, contact_phone),
         address = COALESCE($6, address),
         logo_url = COALESCE($7, logo_url),
         plan = CASE WHEN $10 THEN COALESCE($8, plan) ELSE plan END,
         max_devices = CASE WHEN $10 THEN COALESCE($9, max_devices) ELSE max_devices END,
         max_clients = CASE WHEN $10 THEN COALESCE($11, max_clients) ELSE max_clients END,
         is_active = CASE WHEN $10 THEN COALESCE($12, is_active) ELSE is_active END
       WHERE id = $1 RETURNING *`,
      [id, name ?? null, tax_id ?? null, contact_email ?? null, contact_phone ?? null,
       address ?? null, logo_url ?? null, plan ?? null, max_devices ?? null, isSuper,
       max_clients ?? null, typeof is_active === 'boolean' ? is_active : null]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Empresa no encontrada' });
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar empresa (solo super_admin)
companiesRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== 'super_admin') {
      return res.status(403).json({ error: 'Solo super_admin puede eliminar empresas' });
    }
    const { id } = req.params;

    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM users WHERE company_id = $1', [id]);
    if (rows[0].total > 0) {
      return res.status(400).json({ error: 'La empresa tiene usuarios asignados. Reasígnalos o elimínalos primero.' });
    }

    await pool.query('DELETE FROM companies WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Asignar un usuario existente a una empresa (solo super_admin)
companiesRouter.put('/:id/users/:userId', async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== 'super_admin') {
      return res.status(403).json({ error: 'Solo super_admin puede reasignar usuarios' });
    }
    const { id, userId } = req.params;
    await pool.query('UPDATE users SET company_id = $1 WHERE id = $2', [id, userId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
