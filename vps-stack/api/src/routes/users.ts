import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../lib/db';

export const usersRouter = Router();

// List all users (super_admin only)
usersRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const isSuper = req.userRole === 'super_admin';
    if (!isSuper && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Sin permiso para listar usuarios' });
    }

    // super_admin ve todos (o filtra con ?company_id=); admin solo los de su empresa
    const companyFilter = isSuper
      ? (typeof req.query.company_id === 'string' ? req.query.company_id : null)
      : req.companyId;

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.is_active, u.created_at, u.company_id,
              c.name AS company_name, ur.role
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN companies c ON c.id = u.company_id
       ${companyFilter ? 'WHERE u.company_id = $1' : ''}
       ORDER BY u.created_at DESC`,
      companyFilter ? [companyFilter] : []
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create user (super_admin only)
usersRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const isSuper = req.userRole === 'super_admin';
    if (!isSuper && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Sin permiso para crear usuarios' });
    }

    const { email, password, full_name, role } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    // El admin solo crea personal dentro de SU empresa y nunca con rol superior
    const allowedForAdmin = ['secretary', 'reseller', 'user'];
    if (!isSuper && !allowedForAdmin.includes(role || 'user')) {
      return res.status(403).json({ error: 'Solo puedes crear asistentes, vendedores o usuarios' });
    }

    const companyId = isSuper ? (req.body.company_id || req.companyId || null) : req.companyId;
    if (!isSuper && !companyId) {
      return res.status(400).json({ error: 'Tu usuario no tiene empresa asignada' });
    }

    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(password, salt);

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, company_id) 
       VALUES ($1, $2, $3, $4) RETURNING id, email, full_name, company_id, created_at`,
      [email.toLowerCase(), password_hash, full_name, companyId]
    );

    await pool.query(
      'INSERT INTO user_roles (user_id, role) VALUES ($1, $2::app_role)',
      [rows[0].id, role || 'user']
    );

    res.status(201).json({ data: { ...rows[0], role: role || 'user' } });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update user role
usersRouter.put('/:userId/role', async (req: AuthRequest, res: Response) => {
  try {
    const isSuper = req.userRole === 'super_admin';
    if (!isSuper && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Sin permiso para cambiar roles' });
    }

    const { userId } = req.params;
    const { role } = req.body;

    if (!isSuper) {
      if (!['secretary', 'reseller', 'user'].includes(role)) {
        return res.status(403).json({ error: 'Rol no permitido' });
      }
      const { rows: target } = await pool.query('SELECT company_id FROM users WHERE id = $1', [userId]);
      if (!target[0] || target[0].company_id !== req.companyId) {
        return res.status(403).json({ error: 'El usuario no pertenece a tu empresa' });
      }
    }

    await pool.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, $2::app_role)
       ON CONFLICT (user_id, role) DO UPDATE SET role = $2::app_role`,
      [userId, role]
    );

    // If user already has a different role, update it
    await pool.query(
      `UPDATE user_roles SET role = $1::app_role WHERE user_id = $2`,
      [role, userId]
    );

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete user
usersRouter.delete('/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const isSuper = req.userRole === 'super_admin';
    if (!isSuper && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Sin permiso para eliminar usuarios' });
    }

    const { userId } = req.params;

    if (!isSuper) {
      const { rows: target } = await pool.query(
        `SELECT u.company_id, (SELECT ur.role FROM user_roles ur WHERE ur.user_id = u.id LIMIT 1) AS role
         FROM users u WHERE u.id = $1`,
        [userId]
      );
      if (!target[0] || target[0].company_id !== req.companyId) {
        return res.status(403).json({ error: 'El usuario no pertenece a tu empresa' });
      }
      if (['admin', 'super_admin'].includes(target[0].role)) {
        return res.status(403).json({ error: 'No puedes eliminar administradores' });
      }
    }

    // Prevent self-delete
    if (userId === req.userId) {
      return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
