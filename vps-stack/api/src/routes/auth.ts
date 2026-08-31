import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../lib/db';

export const authRouter = Router();

// ── Protección de fuerza bruta (memoria del proceso) ─────────────────
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
type Attempt = { count: number; first: number; lockedUntil?: number };
const attempts = new Map<string, Attempt>();

function clientIp(req: Request) {
  const fwd = (req.headers['x-forwarded-for'] as string) || '';
  return fwd.split(',')[0].trim() || req.ip || 'unknown';
}
function bruteKey(req: Request, email: string) {
  return `${clientIp(req)}|${(email || '').toLowerCase()}`;
}
function checkLock(key: string): number {
  const a = attempts.get(key);
  if (!a) return 0;
  const now = Date.now();
  if (a.lockedUntil && a.lockedUntil > now) return Math.ceil((a.lockedUntil - now) / 1000);
  if (a.lockedUntil && a.lockedUntil <= now) attempts.delete(key);
  return 0;
}
function registerFailure(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return;
  }
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) a.lockedUntil = now + LOCK_MS;
}
// Limpieza periódica
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of attempts) {
    if ((a.lockedUntil && a.lockedUntil < now) || now - a.first > WINDOW_MS * 2) attempts.delete(k);
  }
}, 5 * 60 * 1000).unref?.();

// Login
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    const key = bruteKey(req, email);
    const lockedFor = checkLock(key);
    if (lockedFor > 0) {
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(lockedFor / 60)} minuto(s).`,
        retry_after: lockedFor,
      });
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
      registerFailure(key);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (!rows[0].is_active) {
      return res.status(403).json({ error: 'Cuenta desactivada' });
    }

    const validPassword = await bcrypt.compare(password, rows[0].password_hash);
    if (!validPassword) {
      registerFailure(key);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    attempts.delete(key);


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

// ─── Restablecer contraseña por correo ───────────────────────────────
import crypto from 'crypto';
import { sendMail, resetPasswordEmail, getSmtpSettings } from '../lib/mailer';

const RESET_TTL_MS = 60 * 60 * 1000; // 60 minutos
const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

/** Base pública del panel para armar el enlace del correo. */
function panelBaseUrl(req: Request, domain?: string | null): string {
  const candidate = String(req.body?.origin || '').trim();
  if (/^https?:\/\/[^\s]+$/i.test(candidate)) return candidate.replace(/\/$/, '');
  if (process.env.APP_URL) return String(process.env.APP_URL).replace(/\/$/, '');
  if (domain) return `https://${domain}`;
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  return `${proto}://${req.headers.host}`;
}

// Solicitud: siempre responde 200 para no revelar qué correos existen.
authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const generic = { success: true, message: 'Si el correo existe, te enviamos las instrucciones.' };
  if (!isEmail(email)) return res.status(400).json({ error: 'Correo inválido' });

  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.is_active, u.tenant_id,
              COALESCE(t.name, 'OmniSync') AS brand, t.slug
         FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
        WHERE u.email = $1 LIMIT 1`,
      [email]
    );
    const user = rows[0];
    if (!user || user.is_active === false) return res.json(generic);

    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');

    await pool.query(`DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
    await pool.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '60 minutes')`,
      [user.id, tokenHash]
    );

    const smtp = await getSmtpSettings(user.tenant_id);
    const base = panelBaseUrl(req, smtp?.domain);
    const link = `${base}/reset-password?token=${raw}`;
    const mail = resetPasswordEmail(link, user.brand);

    await sendMail(user.tenant_id, { to: user.email, subject: mail.subject, html: mail.html });
    res.json(generic);
  } catch (error: any) {
    console.error('[AUTH] forgot-password:', error.message);
    // El fallo de SMTP sí se informa: el usuario debe saber que no llegará el correo.
    res.status(500).json({ error: error.message || 'No se pudo enviar el correo' });
  }
});

// Confirmación: valida el token y guarda la nueva contraseña.
authRouter.post('/reset-password', async (req: Request, res: Response) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');
  if (!token) return res.status(400).json({ error: 'Enlace inválido' });
  if (password.length < 10) return res.status(400).json({ error: 'La contraseña debe tener al menos 10 caracteres' });

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows } = await pool.query(
      `SELECT id, user_id FROM password_resets
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() LIMIT 1`,
      [tokenHash]
    );
    if (!rows[0]) return res.status(400).json({ error: 'El enlace expiró o ya fue utilizado' });

    const hash = await bcrypt.hash(password, await bcrypt.genSalt(12));
    await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [rows[0].user_id, hash]);
    await pool.query(`UPDATE password_resets SET used_at = now() WHERE id = $1`, [rows[0].id]);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[AUTH] reset-password:', error.message);
    res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
  }
});

// Cambio de contraseña del propio usuario (panel principal y dentro del ISP).
authRouter.post('/change-password', async (req: Request, res: Response) => {
  const bearer = req.headers.authorization?.replace('Bearer ', '');
  if (!bearer) return res.status(401).json({ error: 'No autenticado' });

  const current = String(req.body?.current_password || '');
  const next = String(req.body?.new_password || '');
  if (next.length < 10) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 10 caracteres' });
  if (current === next) return res.status(400).json({ error: 'La nueva contraseña debe ser distinta a la actual' });

  try {
    const decoded = jwt.verify(bearer, process.env.JWT_SECRET || 'changeme') as any;
    const { rows } = await pool.query(`SELECT id, password_hash FROM users WHERE id = $1`, [decoded.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });

    const ok = await bcrypt.compare(current, rows[0].password_hash);
    if (!ok) return res.status(400).json({ error: 'La contraseña actual no es correcta' });

    const hash = await bcrypt.hash(next, await bcrypt.genSalt(12));
    await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [rows[0].id, hash]);
    res.json({ success: true });
  } catch (error: any) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token inválido' });
    }
    console.error('[AUTH] change-password:', error.message);
    res.status(500).json({ error: 'No se pudo cambiar la contraseña' });
  }
});
