import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../lib/db';

export const authRouter = Router();

// Login
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.full_name, u.is_active,
              COALESCE(
                (
                  SELECT ur.role
                  FROM user_roles ur
                  WHERE ur.user_id = u.id
                  ORDER BY CASE ur.role
                    WHEN 'super_admin' THEN 1
                    WHEN 'admin' THEN 2
                    WHEN 'secretary' THEN 3
                    WHEN 'reseller' THEN 4
                    ELSE 5
                  END
                  LIMIT 1
                ),
                'user'::app_role
              ) AS role
       FROM users u
       WHERE u.email = $1`,
      [email.toLowerCase()]
    );

    if (!rows[0]) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (!rows[0].is_active) {
      return res.status(403).json({ error: 'Cuenta desactivada' });
    }

    const validPassword = await bcrypt.compare(password, rows[0].password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const jwtSecret = process.env.JWT_SECRET || 'changeme';
    const jwtExpiresIn = (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'];

    const token = jwt.sign(
      { userId: rows[0].id, role: rows[0].role || 'user' },
      jwtSecret,
      { expiresIn: jwtExpiresIn }
    );

    res.json({
      token,
      user: {
        id: rows[0].id,
        email: rows[0].email,
        full_name: rows[0].full_name,
        role: rows[0].role || 'user',
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Register (solo super_admin puede registrar)
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, full_name, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(password, salt);

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name) 
       VALUES ($1, $2, $3) RETURNING id, email, full_name`,
      [email.toLowerCase(), password_hash, full_name]
    );

    // Assign role
    await pool.query(
      'INSERT INTO user_roles (user_id, role) VALUES ($1, $2)',
      [rows[0].id, role || 'user']
    );

    res.status(201).json({ user: rows[0] });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Get current user
authRouter.get('/me', async (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'changeme') as any;
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.full_name,
              COALESCE(
                (
                  SELECT ur.role
                  FROM user_roles ur
                  WHERE ur.user_id = u.id
                  ORDER BY CASE ur.role
                    WHEN 'super_admin' THEN 1
                    WHEN 'admin' THEN 2
                    WHEN 'secretary' THEN 3
                    WHEN 'reseller' THEN 4
                    ELSE 5
                  END
                  LIMIT 1
                ),
                'user'::app_role
              ) AS role
       FROM users u
       WHERE u.id = $1`,
      [decoded.userId]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });

    res.json({ user: rows[0] });
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});

// ─── Debug: Check user roles ─────────────────
authRouter.get('/debug-roles', async (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'changeme') as any;
    
    // Get all roles for this user
    const { rows: roles } = await pool.query(
      'SELECT role, created_at FROM user_roles WHERE user_id = $1 ORDER BY created_at',
      [decoded.userId]
    );

    // Get user info
    const { rows: users } = await pool.query(
      'SELECT id, email, full_name, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    // Get device access
    const { rows: access } = await pool.query(
      `SELECT uma.mikrotik_id, md.name as device_name 
       FROM user_mikrotik_access uma 
       LEFT JOIN mikrotik_devices md ON md.id = uma.mikrotik_id
       WHERE uma.user_id = $1`,
      [decoded.userId]
    );

    res.json({
      token_claims: { userId: decoded.userId, role: decoded.role },
      user: users[0] || null,
      all_roles: roles,
      device_access: access,
      effective_role: roles.length > 0 
        ? roles.sort((a: any, b: any) => {
            const priority: Record<string, number> = { super_admin: 1, admin: 2, secretary: 3, reseller: 4, user: 5 };
            return (priority[a.role] || 99) - (priority[b.role] || 99);
          })[0].role
        : 'user (no role assigned)',
    });
  } catch (err: any) {
    res.status(401).json({ error: 'Token inválido', detail: err.message });
  }
});
