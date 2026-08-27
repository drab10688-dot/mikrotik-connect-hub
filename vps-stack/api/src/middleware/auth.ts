import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../lib/db';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'changeme') as {
      userId: string;
      role?: string;
    };

    const { rows } = await pool.query(
      `SELECT u.is_active,
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
       WHERE u.id = $1
       LIMIT 1`,
      [decoded.userId]
    );

    if (!rows[0]) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    if (!rows[0].is_active) {
      return res.status(403).json({ error: 'Cuenta desactivada' });
    }

    req.userId = decoded.userId;
    req.userRole = rows[0].role || decoded.role || 'user';
    console.log(`🔑 Auth: userId=${req.userId}, dbRole=${rows[0].role}, tokenRole=${decoded.role}, finalRole=${req.userRole}`);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function normalizeStringParam(value: string | string[] | undefined, paramName: string): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  throw new Error(`Parámetro inválido: ${paramName}`);
}

export async function verifyDeviceAccess(
  userId: string,
  role: string,
  mikrotikIdParam: string | string[]
): Promise<boolean> {
  if (role === 'super_admin') return true;

  const mikrotikId = normalizeStringParam(mikrotikIdParam, 'mikrotikId');

  const { rows } = await pool.query(
    `SELECT id FROM user_mikrotik_access WHERE user_id = $1 AND mikrotik_id = $2
     UNION
     SELECT id FROM secretary_assignments WHERE secretary_id = $1 AND mikrotik_id = $2
     UNION
     SELECT id FROM reseller_assignments WHERE reseller_id = $1 AND mikrotik_id = $2
     LIMIT 1`,
    [userId, mikrotikId]
  );

  return rows.length > 0;
}
