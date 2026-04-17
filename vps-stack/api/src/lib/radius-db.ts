/**
 * RADIUS Database Connection Pool (MariaDB - FreeRADIUS schema)
 * Conexión separada al MariaDB que usa FreeRADIUS para gestionar
 * usuarios, perfiles, sesiones y NAS de forma centralizada.
 */
import mysql from 'mysql2/promise';

let _pool: mysql.Pool | null = null;

export function getRadiusPool(): mysql.Pool {
  if (_pool) return _pool;

  _pool = mysql.createPool({
    host: process.env.RADIUS_DB_HOST || process.env.NUXBILL_DB_HOST || 'mariadb',
    port: parseInt(process.env.RADIUS_DB_PORT || '3306', 10),
    user: process.env.RADIUS_DB_USER || 'radius',
    password:
      process.env.RADIUS_DB_PASSWORD ||
      process.env.RADIUS_DB_PASS ||
      'changeme_radius',
    database: process.env.RADIUS_DB_NAME || 'radius',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
  });

  return _pool;
}

/** Run query and return rows. */
export async function rq<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const pool = getRadiusPool();
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

/** Run write and return affected rows. */
export async function rwrite(sql: string, params: any[] = []): Promise<mysql.ResultSetHeader> {
  const pool = getRadiusPool();
  const [result] = await pool.query(sql, params);
  return result as mysql.ResultSetHeader;
}
