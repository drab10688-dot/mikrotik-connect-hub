import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../lib/db';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : undefined;

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

  if (!decoded.userId) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  // La consulta a la base de datos NO debe convertirse en 401: si la BD falla
  // (columna faltante, conexión caída) degradamos al rol del token.
  req.userId = decoded.userId;
  req.userRole = decoded.role || 'user';

  try {
    const { rows } = await pool.query(
      `SELECT (
                SELECT ur.role::text
                FROM user_roles ur
                WHERE ur.user_id = u.id
                ORDER BY CASE ur.role::text
                  WHEN 'super_admin' THEN 1
                  WHEN 'admin' THEN 2
                  WHEN 'secretary' THEN 3
                  WHEN 'reseller' THEN 4
                  ELSE 5
                END
                LIMIT 1
              ) AS role
       FROM users u
       WHERE u.id = $1
       LIMIT 1`,
      [decoded.userId]
    );

    if (rows[0]?.role) {
      req.userRole = rows[0].role;
    }
  } catch (error) {
    console.error('⚠️ Auth: fallo consultando rol en BD, usando rol del token:', error);
  }

  // is_active se consulta aparte: si la columna no existe en instalaciones
  // antiguas, jamás debe convertir un error de esquema en un 401.
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(is_active, true) AS is_active FROM users WHERE id = $1 LIMIT 1`,
      [decoded.userId]
    );
    if (rows[0] && rows[0].is_active === false) {
      return res.status(403).json({ error: 'Cuenta desactivada' });
    }
  } catch (error) {
    console.error('⚠️ Auth: no se pudo verificar is_active, se continúa:', error);
  }

  return next();
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

// ─── Autorización por rol ─────────────────────────────────
export const ADMIN_ROLES = ['super_admin', 'admin'];

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    return next();
  };
}

/**
 * Devuelve true si el asistente tiene el permiso solicitado en alguna de sus
 * asignaciones (por dispositivo o global). Si la columna no existe todavía en
 * instalaciones antiguas, no se bloquea el acceso.
 */
export async function secretaryHasPermission(userId: string, permKey: string): Promise<boolean> {
  if (!/^can_[a-z0-9_]+$/.test(permKey)) return false;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM secretary_assignments
       WHERE secretary_id = $1 AND COALESCE(${permKey}, false) = true
       LIMIT 1`,
      [userId]
    );
    return rows.length > 0;
  } catch (error) {
    console.error(`⚠️ Auth: no se pudo verificar ${permKey}:`, error);
    return true; // columna inexistente en esquemas viejos → no bloquear
  }
}

/**
 * Middleware de módulo. super_admin/admin/user pasan siempre; el asistente
 * necesita el permiso concreto; el reseller solo accede a lo que se le permita.
 */
export function requirePermission(permKey: string, allowReseller = false) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.userRole || 'user';
    if (role === 'super_admin' || role === 'admin' || role === 'user') return next();
    if (role === 'reseller') {
      return allowReseller ? next() : res.status(403).json({ error: 'No tienes permiso para este módulo' });
    }
    if (role === 'secretary') {
      const allowed = await secretaryHasPermission(req.userId!, permKey);
      if (!allowed) return res.status(403).json({ error: 'No tienes permiso para este módulo' });
      return next();
    }
    return res.status(403).json({ error: 'No tienes permiso para este módulo' });
  };
}
