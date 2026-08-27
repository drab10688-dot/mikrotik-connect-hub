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

  let decoded: { userId: string; role?: string };
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET || 'changeme') as {
      userId: string;
      role?: string;
    };
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  // La consulta a la base de datos NO debe convertirse en 401: si la BD falla
  // (columna faltante, conexión caída) degradamos al rol del token.
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(u.is_active, true) AS is_active,
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

    if (rows[0].is_active === false) {
      return res.status(403).json({ error: 'Cuenta desactivada' });
    }

    req.userId = decoded.userId;
    req.userRole = rows[0].role || decoded.role || 'user';
    return next();
  } catch (error) {
    console.error('⚠️ Auth: fallo consultando rol en BD, usando rol del token:', error);
    req.userId = decoded.userId;
    req.userRole = decoded.role || 'user';
    return next();
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
     SELECT sa.id FROM secretary_assignments sa
     WHERE sa.secretary_id = $1
       AND (
         sa.mikrotik_id = $2
         OR (
           sa.mikrotik_id IS NULL
           AND EXISTS (
             SELECT 1 FROM mikrotik_devices md
             WHERE md.id = $2 AND md.created_by = sa.assigned_by
           )
         )
       )
     UNION
     SELECT id FROM reseller_assignments WHERE reseller_id = $1 AND mikrotik_id = $2
     LIMIT 1`,
    [userId, mikrotikId]
  );

  return rows.length > 0;
}
