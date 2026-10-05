import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../lib/db';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  /** ISP (tenant) al que pertenece el usuario. null = global / instalación antigua. */
  tenantId?: string | null;
}

/** Token guardado en cookie para el proxy web (iframes / pestañas nuevas). */
export const WEB_TOKEN_COOKIE = 'omnisync_web_token';

function cookieToken(req: Request): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === WEB_TOKEN_COOKIE) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization;
  const queryToken = typeof req.query?.token === 'string' ? req.query.token : undefined;
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : queryToken || cookieToken(req);

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

  // tenant_id (multi-ISP). Si la columna todavía no existe, se continúa en
  // modo global: el comportamiento es idéntico al de antes de multi-ISP.
  req.tenantId = null;
  try {
    const { rows } = await pool.query(
      `SELECT tenant_id FROM users WHERE id = $1 LIMIT 1`,
      [decoded.userId]
    );
    req.tenantId = rows[0]?.tenant_id || null;
  } catch {
    req.tenantId = null;
  }

  return next();
}




function normalizeStringParam(value: string | string[] | undefined, paramName: string): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  throw new Error(`Parámetro inválido: ${paramName}`);
}

/**
 * SQL de los routers visibles para un usuario ($1 = user_id):
 *  - admin del ISP: todos los routers de su ISP;
 *  - técnico: solo los asignados (user_mikrotik_access) y de su mismo ISP.
 * Usuarios sin ISP (instalación antigua) solo ven routers sin ISP.
 */
const VISIBLE_DEVICES_SQL = `
  SELECT md.id FROM mikrotik_devices md
    JOIN users u ON u.id = $1
   WHERE md.tenant_id IS NOT DISTINCT FROM u.tenant_id
     AND (
       EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role::text = 'admin')
       OR EXISTS (SELECT 1 FROM user_mikrotik_access uma WHERE uma.mikrotik_id = md.id AND uma.user_id = u.id)
     )`;

export async function verifyDeviceAccess(
  userId: string,
  role: string,
  mikrotikIdParam: string | string[]
): Promise<boolean> {
  if (role === 'super_admin') return true;

  const mikrotikId = normalizeStringParam(mikrotikIdParam, 'mikrotikId');
  const { rows } = await pool.query(
    `SELECT 1 FROM (${VISIBLE_DEVICES_SQL}) v WHERE v.id = $2 LIMIT 1`,
    [userId, mikrotikId]
  );
  return rows.length > 0;
}

/**
 * Devuelve los IDs de MikroTik visibles para el usuario, respetando el
 * aislamiento multi-ISP. super_admin sin ISP ve todo (null = sin límite).
 */
export async function getAccessibleDeviceIds(
  req: AuthRequest
): Promise<string[] | null> {
  const role = req.userRole || 'user';

  if (role === 'super_admin' && !req.tenantId) return null;

  if (role === 'super_admin') {
    const { rows } = await pool.query(
      `SELECT id FROM mikrotik_devices WHERE tenant_id = $1`,
      [req.tenantId]
    );
    return rows.map((r: any) => r.id);
  }

  const { rows } = await pool.query(VISIBLE_DEVICES_SQL, [req.userId]);
  return rows.map((r: any) => r.id);
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
