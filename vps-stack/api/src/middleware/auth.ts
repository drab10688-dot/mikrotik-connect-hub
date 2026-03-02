import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../server';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'changeme') as {
      userId: string;
      role: string;
    };
    req.userId = decoded.userId;
    req.userRole = decoded.role;
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
