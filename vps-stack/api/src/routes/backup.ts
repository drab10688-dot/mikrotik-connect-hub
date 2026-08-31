import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { spawn } from 'child_process';
import { pool } from '../lib/db';
import { AuthRequest, requireRole } from '../middleware/auth';

export const backupRouter = Router();

const BACKUP_DIR = process.env.BACKUP_DIR || '/opt/omnisync/backups';

function ensureDir(): string {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.accessSync(BACKUP_DIR, fs.constants.W_OK);
    return BACKUP_DIR;
  } catch {
    const fallback = '/tmp/omnisync-backups';
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const safeName = (name: string) => path.basename(String(name)).replace(/[^A-Za-z0-9._-]/g, '');

/**
 * Tablas exportadas en la copia de un ISP. Cada entrada es una consulta
 * filtrada por tenant_id para que nunca se filtren datos de otra empresa.
 */
const TENANT_EXPORTS: Array<{ table: string; sql: string }> = [
  { table: 'tenant', sql: `SELECT * FROM tenants WHERE id = $1` },
  { table: 'users', sql: `SELECT id, email, full_name, is_active, tenant_id, created_at FROM users WHERE tenant_id = $1` },
  { table: 'user_roles', sql: `SELECT ur.* FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE u.tenant_id = $1` },
  { table: 'user_permissions', sql: `SELECT * FROM user_permissions WHERE tenant_id = $1` },
  { table: 'role_permissions', sql: `SELECT * FROM role_permissions WHERE tenant_id = $1` },
  { table: 'mikrotik_devices', sql: `SELECT * FROM mikrotik_devices WHERE tenant_id = $1` },
  { table: 'onu_devices', sql: `SELECT * FROM onu_devices WHERE tenant_id = $1` },
  { table: 'acs_device_owners', sql: `SELECT * FROM acs_device_owners WHERE tenant_id = $1` },
  { table: 'tenant_vpn_peers', sql: `SELECT * FROM tenant_vpn_peers WHERE tenant_id = $1` },
  { table: 'ap_credentials', sql: `SELECT * FROM ap_credentials WHERE tenant_id = $1` },
  { table: 'onu_web_credentials', sql: `SELECT * FROM onu_web_credentials WHERE tenant_id = $1` },
  { table: 'onu_web_profiles', sql: `SELECT * FROM onu_web_profiles WHERE tenant_id = $1` },
  { table: 'onu_events', sql: `SELECT * FROM onu_events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 5000` },
  { table: 'smtp_settings', sql: `SELECT id, tenant_id, host, port, secure, username, from_email, from_name, domain, is_active FROM smtp_settings WHERE tenant_id = $1` },
  {
    table: 'pppoe_settings',
    sql: `SELECT s.* FROM pppoe_settings s
          JOIN mikrotik_devices d ON d.id = s.mikrotik_id WHERE d.tenant_id = $1`,
  },
];

async function registerJob(
  tenantId: string | null,
  scope: string,
  filename: string,
  size: number,
  userId?: string,
  status = 'ok',
  error?: string
) {
  await pool
    .query(
      `INSERT INTO backup_jobs (tenant_id, scope, filename, size_bytes, status, error, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, scope, filename, size, status, error || null, userId || null]
    )
    .catch(() => undefined);
}

/** Copia de seguridad de un ISP: exporta sus tablas a un JSON comprimido. */
backupRouter.post('/tenant', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.userRole === 'super_admin' && req.body?.tenant_id
    ? String(req.body.tenant_id)
    : req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'No hay un ISP asociado a esta copia' });

  try {
    const { rows: tRows } = await pool.query(`SELECT slug FROM tenants WHERE id = $1`, [tenantId]);
    if (!tRows[0]) return res.status(404).json({ error: 'ISP no encontrado' });

    const payload: Record<string, any> = {
      generated_at: new Date().toISOString(),
      scope: 'tenant',
      tenant_id: tenantId,
      version: 1,
      data: {},
    };

    for (const item of TENANT_EXPORTS) {
      try {
        const { rows } = await pool.query(item.sql, [tenantId]);
        payload.data[item.table] = rows;
      } catch (e: any) {
        payload.data[item.table] = { error: e.message };
      }
    }

    const dir = ensureDir();
    const filename = `isp-${tRows[0].slug}-${stamp()}.json.gz`;
    const filePath = path.join(dir, filename);
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload, null, 2)));
    fs.writeFileSync(filePath, gz);

    await registerJob(tenantId, 'tenant', filename, gz.length, req.userId);
    res.json({ data: { filename, size_bytes: gz.length } });
  } catch (error: any) {
    await registerJob(tenantId, 'tenant', 'error', 0, req.userId, 'error', error.message);
    res.status(500).json({ error: error.message });
  }
});

/** Copia total del sistema: volcado completo de PostgreSQL (solo super_admin). */
backupRouter.post('/system', requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  const dir = ensureDir();
  const filename = `sistema-${stamp()}.sql.gz`;
  const filePath = path.join(dir, filename);

  try {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(filePath);
      const gzip = zlib.createGzip();
      const dump = spawn(
        'pg_dump',
        ['-h', process.env.DB_HOST || 'postgres', '-p', process.env.DB_PORT || '5432',
         '-U', process.env.DB_USER || 'omnisync', '-d', process.env.DB_NAME || 'omnisync',
         '--no-owner', '--no-privileges'],
        { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' } }
      );

      let stderr = '';
      dump.stderr.on('data', (d) => { stderr += d.toString().slice(0, 2000); });
      dump.on('error', (e) => reject(new Error(`pg_dump no disponible: ${e.message}`)));
      dump.stdout.pipe(gzip).pipe(out);
      out.on('error', reject);
      out.on('finish', () => {
        if (dump.exitCode && dump.exitCode !== 0) reject(new Error(stderr || 'pg_dump falló'));
        else resolve();
      });
      dump.on('close', (code) => {
        if (code !== 0) reject(new Error(stderr || `pg_dump terminó con código ${code}`));
      });
    });

    const size = fs.statSync(filePath).size;
    await registerJob(null, 'system', filename, size, req.userId);
    res.json({ data: { filename, size_bytes: size } });
  } catch (error: any) {
    fs.rmSync(filePath, { force: true });
    await registerJob(null, 'system', filename, 0, req.userId, 'error', error.message);
    res.status(500).json({ error: error.message });
  }
});

/** Historial de copias visibles para el usuario. */
backupRouter.get('/', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = req.userRole === 'super_admin'
      ? await pool.query(
          `SELECT b.*, t.name AS tenant_name FROM backup_jobs b
             LEFT JOIN tenants t ON t.id = b.tenant_id
            ORDER BY b.created_at DESC LIMIT 100`
        )
      : await pool.query(
          `SELECT b.*, t.name AS tenant_name FROM backup_jobs b
             LEFT JOIN tenants t ON t.id = b.tenant_id
            WHERE b.tenant_id = $1 ORDER BY b.created_at DESC LIMIT 100`,
          [req.tenantId]
        );

    const dir = ensureDir();
    res.json({
      data: rows.map((r: any) => ({ ...r, available: fs.existsSync(path.join(dir, r.filename)) })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** Descarga (el token puede ir en ?token= porque es una descarga directa). */
backupRouter.get('/download/:filename', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const filename = safeName(req.params.filename);
  try {
    const { rows } = await pool.query(`SELECT * FROM backup_jobs WHERE filename = $1 LIMIT 1`, [filename]);
    const job = rows[0];
    if (!job) return res.status(404).json({ error: 'Copia no encontrada' });
    if (req.userRole !== 'super_admin' && job.tenant_id !== req.tenantId) {
      return res.status(403).json({ error: 'Sin acceso a esta copia' });
    }
    const filePath = path.join(ensureDir(), filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'El archivo ya no está en el servidor' });
    res.download(filePath, filename);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

backupRouter.delete('/:filename', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const filename = safeName(req.params.filename);
  try {
    const { rows } = await pool.query(`SELECT * FROM backup_jobs WHERE filename = $1 LIMIT 1`, [filename]);
    const job = rows[0];
    if (job && req.userRole !== 'super_admin' && job.tenant_id !== req.tenantId) {
      return res.status(403).json({ error: 'Sin acceso a esta copia' });
    }
    fs.rmSync(path.join(ensureDir(), filename), { force: true });
    await pool.query(`DELETE FROM backup_jobs WHERE filename = $1`, [filename]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
