import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../server';

export const usersRouter = Router();

// List all users (super_admin only)
usersRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== 'super_admin') {
      return res.status(403).json({ error: 'Solo super_admin puede listar usuarios' });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.is_active, u.created_at,
              ur.role
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       ORDER BY u.created_at DESC`
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create user (super_admin only)
usersRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== 'super_admin') {
      return res.status(403).json({ error: 'Solo super_admin puede crear usuarios' });
    }

    const { email, password, full_name, role } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(password, salt);

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name) 
       VALUES ($1, $2, $3) RETURNING id, email, full_name, created_at`,
      [email.toLowerCase(), password_hash, full_name]
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
    if (req.userRole !== 'super_admin') {
      return res.status(403).json({ error: 'Solo super_admin puede cambiar roles' });
    }

    const { userId } = req.params;
    const { role } = req.body;

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
    if (req.userRole !== 'super_admin') {
      return res.status(403).json({ error: 'Solo super_admin puede eliminar usuarios' });
    }

    const { userId } = req.params;

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
