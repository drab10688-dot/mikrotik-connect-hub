import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../lib/db';

export const usersRouter = Router();

const ROLE_ORDER = `CASE ur.role::text
  WHEN 'super_admin' THEN 1
  WHEN 'admin' THEN 2
  WHEN 'secretary' THEN 3
  WHEN 'reseller' THEN 4
  ELSE 5
END`;

/** Roles que cada rol puede asignar. */
function allowedRoles(role?: string): string[] {
  if (role === 'super_admin') return ['super_admin', 'admin', 'user', 'secretary', 'reseller'];
  if (role === 'admin') return ['admin', 'user', 'secretary', 'reseller'];
  return [];
}

/** El admin de un ISP solo puede tocar usuarios de su propio ISP. */
async function sameTenant(req: AuthRequest, userId: string): Promise<boolean> {
  if (req.userRole === 'super_admin') return true;
  if (!req.tenantId) return false;
  const { rows } = await pool.query('SELECT tenant_id FROM users WHERE id = $1', [userId]);
  return !!rows[0] && rows[0].tenant_id === req.tenantId;
}

// Listar usuarios (super_admin: todos | admin: los de su ISP)
usersRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== 'super_admin' && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Sin permiso para ver usuarios' });
    }

    const isGlobal = req.userRole === 'super_admin';
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.is_active, u.created_at, u.tenant_id,
              (SELECT ur.role::text FROM user_roles ur
                WHERE ur.user_id = u.id ORDER BY ${ROLE_ORDER} LIMIT 1) AS role
       FROM users u
       WHERE $2::boolean = true OR u.tenant_id = $1::uuid
       ORDER BY u.created_at DESC`,
      [req.tenantId || null, isGlobal]
    );

    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Crear usuario dentro del ISP (admin) o en cualquier ISP (super_admin)
usersRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, full_name, role, tenant_id } = req.body || {};
    const newRole = role || 'user';

    if (!allowedRoles(req.userRole).includes(newRole)) {
      return res.status(403).json({ error: 'No puedes asignar ese rol' });
    }
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const targetTenant =
      req.userRole === 'super_admin' ? tenant_id || req.tenantId || null : req.tenantId || null;

    if (req.userRole !== 'super_admin' && !targetTenant) {
      return res.status(400).json({ error: 'Tu cuenta no está asociada a ningún ISP' });
    }

    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(password, salt);

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, tenant_id)
       VALUES ($1, $2, $3, $4) RETURNING id, email, full_name, tenant_id, created_at`,
      [String(email).toLowerCase(), password_hash, full_name || null, targetTenant]
    );

    await pool.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2::app_role)', [
      rows[0].id,
      newRole,
    ]);

    res.status(201).json({ data: { ...rows[0], role: newRole } });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Cambiar rol
usersRouter.put('/:userId/role', async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { role } = req.body || {};

    if (!allowedRoles(req.userRole).includes(role)) {
      return res.status(403).json({ error: 'No puedes asignar ese rol' });
    }
    if (!(await sameTenant(req, userId))) {
      return res.status(403).json({ error: 'Ese usuario no pertenece a tu ISP' });
    }

    await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await pool.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2::app_role)', [userId, role]);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Activar / desactivar
usersRouter.put('/:userId/active', async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    if (!(await sameTenant(req, userId))) {
      return res.status(403).json({ error: 'Ese usuario no pertenece a tu ISP' });
    }
    if (userId === req.userId) {
      return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
    }
    await pool.query('UPDATE users SET is_active = $2 WHERE id = $1', [userId, !!req.body?.is_active]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Restablecer contraseña
usersRouter.put('/:userId/password', async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { password } = req.body || {};
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    if (!(await sameTenant(req, userId))) {
      return res.status(403).json({ error: 'Ese usuario no pertenece a tu ISP' });
    }
    const salt = await bcrypt.genSalt(12);
    const hash = await bcrypt.hash(password, salt);
    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, hash]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar usuario
usersRouter.delete('/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    if (userId === req.userId) {
      return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    }
    if (!(await sameTenant(req, userId))) {
      return res.status(403).json({ error: 'Ese usuario no pertenece a tu ISP' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
