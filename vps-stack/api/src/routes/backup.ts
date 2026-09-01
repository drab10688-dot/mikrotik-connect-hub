import { Router, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { PassThrough } from 'stream';
import multer from 'multer';
import { spawn } from 'child_process';
import { pool } from '../lib/db';
import { AuthRequest, requireRole } from '../middleware/auth';
import * as dropbox from '../lib/dropbox';

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
  error?: string,
  remotePath?: string | null
) {
  await pool
    .query(
      `INSERT INTO backup_jobs (tenant_id, scope, filename, size_bytes, status, error, created_by, remote_path, remote_provider)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tenantId, scope, filename, size, status, error || null, userId || null,
       remotePath || null, remotePath ? 'dropbox' : null]
    )
    .catch(() =>
      pool
        .query(
          `INSERT INTO backup_jobs (tenant_id, scope, filename, size_bytes, status, error, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, scope, filename, size, status, error || null, userId || null]
        )
        .catch(() => undefined)
    );
}

// ─── Configuración de destino remoto (Dropbox) ────────────────────────────
/** Devuelve la configuración de Dropbox del ISP; si no tiene, usa la global. */
async function loadDropboxConfig(tenantId: string | null): Promise<any | null> {
  const { rows } = await pool.query(
    `SELECT * FROM backup_settings
      WHERE tenant_id IS NOT DISTINCT FROM $1 OR tenant_id IS NULL
      ORDER BY (tenant_id IS NOT NULL) DESC LIMIT 1`,
    [tenantId]
  );
  const cfg = rows[0];
  if (!cfg || !cfg.dropbox_enabled || !cfg.dropbox_refresh_token) return null;
  return cfg;
}

function toDropbox(cfg: any): dropbox.DropboxConfig {
  return {
    app_key: cfg.dropbox_app_key,
    app_secret: cfg.dropbox_app_secret,
    refresh_token: cfg.dropbox_refresh_token,
    folder: cfg.dropbox_folder,
  };
}

/** Sube la copia recién creada a Dropbox si el ISP lo tiene activado. */
async function maybeUploadRemote(
  tenantId: string | null,
  filename: string,
  filePath: string
): Promise<string | null> {
  try {
    const cfg = await loadDropboxConfig(tenantId);
    if (!cfg || !cfg.auto_upload) return null;
    const remote = await dropbox.uploadFile(toDropbox(cfg), filePath, filename);
    if (cfg.keep_remote) await dropbox.pruneRemote(toDropbox(cfg), Number(cfg.keep_remote));
    return remote;
  } catch (e: any) {
    console.warn('[BACKUP] Dropbox:', e.message);
    return null;
  }
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

    const remote = await maybeUploadRemote(tenantId, filename, filePath);
    await registerJob(tenantId, 'tenant', filename, gz.length, req.userId, 'ok', undefined, remote);
    res.json({ data: { filename, size_bytes: gz.length, remote_path: remote } });

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
    const remote = await maybeUploadRemote(null, filename, filePath);
    await registerJob(null, 'system', filename, size, req.userId, 'ok', undefined, remote);
    res.json({ data: { filename, size_bytes: size, remote_path: remote } });

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

// ═══════════════════════════════════════════════════════════════════════════
//  RESTAURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/** Orden de restauración: respeta las llaves foráneas entre tablas. */
const RESTORE_ORDER = [
  'users',
  'user_roles',
  'user_permissions',
  'role_permissions',
  'mikrotik_devices',
  'onu_devices',
  'acs_device_owners',
  'tenant_vpn_peers',
  'ap_credentials',
  'onu_web_credentials',
  'onu_web_profiles',
  'onu_events',
  'smtp_settings',
  'pppoe_settings',
];

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => cb(null, `restore-${Date.now()}-${safeName(file.originalname)}`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

/** Lee un .json.gz (o .json) y devuelve el objeto de la copia. */
function readTenantBackup(filePath: string): any {
  const raw = fs.readFileSync(filePath);
  const text = filePath.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const payload = JSON.parse(text);
  if (!payload?.data || payload.scope !== 'tenant') {
    throw new Error('El archivo no es una copia válida de un ISP');
  }
  return payload;
}

/** Inserta/actualiza filas de una tabla manteniendo el id original. */
async function restoreRows(client: any, table: string, rows: any[], tenantId: string) {
  if (!Array.isArray(rows) || !rows.length) return { table, restored: 0 };
  let restored = 0;

  for (const row of rows) {
    const data: Record<string, any> = { ...row };
    if ('tenant_id' in data) data.tenant_id = tenantId;
    const cols = Object.keys(data);
    if (!cols.length) continue;

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    const updates = cols.filter((c) => c !== 'id').map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
    const sql = `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')})
                 VALUES (${placeholders})
                 ${cols.includes('id') && updates ? `ON CONFLICT (id) DO UPDATE SET ${updates}` : 'ON CONFLICT DO NOTHING'}`;
    try {
      await client.query(sql, cols.map((c) => data[c]));
      restored++;
    } catch (e: any) {
      // Reintento tolerante: sólo inserta si no existe
      try {
        await client.query(
          `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          cols.map((c) => data[c])
        );
        restored++;
      } catch {
        console.warn(`[RESTORE] ${table}:`, e.message);
      }
    }
  }
  return { table, restored };
}

/** Restaura una copia de ISP dentro de una transacción. */
async function restoreTenantBackup(payload: any, targetTenantId: string) {
  const client = await pool.connect();
  const summary: any[] = [];
  try {
    await client.query('BEGIN');

    // Datos generales del ISP (sin cambiar id ni slug si ya existe)
    const tenantRow = payload.data?.tenant?.[0];
    if (tenantRow) {
      const skip = new Set(['id', 'created_at']);
      const cols = Object.keys(tenantRow).filter((c) => !skip.has(c));
      if (cols.length) {
        await client.query(
          `UPDATE tenants SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')} WHERE id = $1`,
          [targetTenantId, ...cols.map((c) => tenantRow[c])]
        );
      }
    }

    for (const table of RESTORE_ORDER) {
      const rows = payload.data?.[table];
      if (!rows || !Array.isArray(rows)) continue;
      summary.push(await restoreRows(client, table, rows, targetTenantId));
    }

    await client.query('COMMIT');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Restaura el volcado completo de PostgreSQL con psql. */
function restoreSystemDump(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const psql = spawn(
      'psql',
      ['-h', process.env.DB_HOST || 'postgres', '-p', process.env.DB_PORT || '5432',
       '-U', process.env.DB_USER || 'omnisync', '-d', process.env.DB_NAME || 'omnisync', '-v', 'ON_ERROR_STOP=0'],
      { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' } }
    );
    let stderr = '';
    psql.stderr.on('data', (d) => { stderr += d.toString().slice(0, 4000); });
    psql.on('error', (e) => reject(new Error(`psql no disponible: ${e.message}`)));
    psql.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `psql terminó con código ${code}`))));

    fs.createReadStream(filePath)
      .pipe(filePath.endsWith('.gz') ? zlib.createGunzip() : new PassThrough())
      .pipe(psql.stdin);
  });
}

/** Restaura desde una copia que ya está en el servidor (o en Dropbox). */
backupRouter.post('/restore/:filename', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const filename = safeName(req.params.filename);
  const dir = ensureDir();
  let filePath = path.join(dir, filename);

  try {
    const { rows } = await pool.query(`SELECT * FROM backup_jobs WHERE filename = $1 LIMIT 1`, [filename]);
    const job = rows[0];
    if (job && req.userRole !== 'super_admin' && job.tenant_id !== req.tenantId) {
      return res.status(403).json({ error: 'Sin acceso a esta copia' });
    }

    // Si el archivo local ya no está, se intenta recuperar desde Dropbox
    if (!fs.existsSync(filePath)) {
      const cfg = await loadDropboxConfig(job?.tenant_id ?? req.tenantId ?? null);
      if (!cfg) return res.status(404).json({ error: 'El archivo no está en el servidor y no hay Dropbox configurado' });
      await dropbox.downloadFile(toDropbox(cfg), filename, filePath);
    }

    if (filename.endsWith('.sql.gz') || filename.endsWith('.sql')) {
      if (req.userRole !== 'super_admin') return res.status(403).json({ error: 'Sólo el super administrador puede restaurar el sistema' });
      await restoreSystemDump(filePath);
      return res.json({ data: { scope: 'system', restored: true } });
    }

    const payload = readTenantBackup(filePath);
    const targetTenant = req.userRole === 'super_admin' && req.body?.tenant_id
      ? String(req.body.tenant_id)
      : (req.tenantId || payload.tenant_id);
    if (!targetTenant) return res.status(400).json({ error: 'No se pudo determinar el ISP destino' });

    const summary = await restoreTenantBackup(payload, targetTenant);
    res.json({ data: { scope: 'tenant', tenant_id: targetTenant, summary } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** Restaura subiendo un archivo desde el computador del usuario. */
backupRouter.post(
  '/restore-upload',
  requireRole('super_admin', 'admin'),
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: 'Falta el archivo de la copia' });

    try {
      if (file.originalname.endsWith('.sql.gz') || file.originalname.endsWith('.sql')) {
        if (req.userRole !== 'super_admin') {
          return res.status(403).json({ error: 'Sólo el super administrador puede restaurar el sistema' });
        }
        await restoreSystemDump(file.path);
        return res.json({ data: { scope: 'system', restored: true } });
      }

      const payload = readTenantBackup(file.path);
      const targetTenant = req.userRole === 'super_admin' && req.body?.tenant_id
        ? String(req.body.tenant_id)
        : (req.tenantId || payload.tenant_id);
      if (!targetTenant) return res.status(400).json({ error: 'No se pudo determinar el ISP destino' });

      const summary = await restoreTenantBackup(payload, targetTenant);
      res.json({ data: { scope: 'tenant', tenant_id: targetTenant, summary } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    } finally {
      fs.rmSync(file.path, { force: true });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
//  DROPBOX
// ═══════════════════════════════════════════════════════════════════════════

const settingsScope = (req: AuthRequest): string | null =>
  req.userRole === 'super_admin' && req.body?.global ? null : (req.tenantId ?? null);

/** Configuración actual del destino remoto. */
backupRouter.get('/settings', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM backup_settings WHERE tenant_id IS NOT DISTINCT FROM $1 LIMIT 1`,
      [req.tenantId ?? null]
    );
    const cfg = rows[0];
    res.json({
      data: cfg
        ? {
            dropbox_enabled: cfg.dropbox_enabled,
            auto_upload: cfg.auto_upload,
            dropbox_app_key: cfg.dropbox_app_key || '',
            dropbox_folder: cfg.dropbox_folder || '/OmniSync',
            keep_remote: cfg.keep_remote || 10,
            has_secret: Boolean(cfg.dropbox_app_secret),
            has_refresh_token: Boolean(cfg.dropbox_refresh_token),
          }
        : {
            dropbox_enabled: false,
            auto_upload: true,
            dropbox_app_key: '',
            dropbox_folder: '/OmniSync',
            keep_remote: 10,
            has_secret: false,
            has_refresh_token: false,
          },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** Guarda la configuración de Dropbox (los secretos vacíos no se sobreescriben). */
backupRouter.put('/settings', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenantId ?? null;
  const b = req.body || {};
  try {
    await pool.query(
      `INSERT INTO backup_settings (tenant_id, dropbox_enabled, auto_upload, dropbox_app_key, dropbox_app_secret, dropbox_refresh_token, dropbox_folder, keep_remote)
       VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),$7,$8)
       ON CONFLICT (tenant_key) DO UPDATE SET
         dropbox_enabled = EXCLUDED.dropbox_enabled,
         auto_upload = EXCLUDED.auto_upload,
         dropbox_app_key = EXCLUDED.dropbox_app_key,
         dropbox_app_secret = COALESCE(EXCLUDED.dropbox_app_secret, backup_settings.dropbox_app_secret),
         dropbox_refresh_token = COALESCE(EXCLUDED.dropbox_refresh_token, backup_settings.dropbox_refresh_token),
         dropbox_folder = EXCLUDED.dropbox_folder,
         keep_remote = EXCLUDED.keep_remote,
         updated_at = now()`,
      [
        tenantId,
        Boolean(b.dropbox_enabled),
        b.auto_upload !== false,
        String(b.dropbox_app_key || ''),
        String(b.dropbox_app_secret || ''),
        String(b.dropbox_refresh_token || ''),
        String(b.dropbox_folder || '/OmniSync'),
        Number(b.keep_remote) || 10,
      ]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** Prueba las credenciales de Dropbox. */
backupRouter.post('/settings/test', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM backup_settings WHERE tenant_id IS NOT DISTINCT FROM $1 LIMIT 1`,
      [req.tenantId ?? null]
    );
    if (!rows[0]?.dropbox_refresh_token) return res.status(400).json({ error: 'Falta configurar Dropbox' });
    const info = await dropbox.testConnection(toDropbox(rows[0]));
    res.json({ data: info });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/** Copias disponibles en Dropbox. */
backupRouter.get('/remote', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const cfg = await loadDropboxConfig(req.tenantId ?? null);
    if (!cfg) return res.json({ data: [] });
    res.json({ data: await dropbox.listFiles(toDropbox(cfg)) });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/** Sube manualmente una copia existente a Dropbox. */
backupRouter.post('/remote/:filename', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const filename = safeName(req.params.filename);
  try {
    const cfg = await loadDropboxConfig(req.tenantId ?? null);
    if (!cfg) return res.status(400).json({ error: 'Dropbox no está configurado' });
    const filePath = path.join(ensureDir(), filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'El archivo ya no está en el servidor' });
    const remote = await dropbox.uploadFile(toDropbox(cfg), filePath, filename);
    await pool
      .query(`UPDATE backup_jobs SET remote_path = $2, remote_provider = 'dropbox' WHERE filename = $1`, [filename, remote])
      .catch(() => undefined);
    res.json({ data: { remote_path: remote } });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/** Trae una copia desde Dropbox al servidor (paso previo a restaurar). */
backupRouter.post('/remote/:filename/pull', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const filename = safeName(req.params.filename);
  try {
    const cfg = await loadDropboxConfig(req.tenantId ?? null);
    if (!cfg) return res.status(400).json({ error: 'Dropbox no está configurado' });
    const filePath = path.join(ensureDir(), filename);
    await dropbox.downloadFile(toDropbox(cfg), filename, filePath);
    const size = fs.statSync(filePath).size;
    const scope = filename.endsWith('.sql.gz') ? 'system' : 'tenant';
    await pool.query(`DELETE FROM backup_jobs WHERE filename = $1`, [filename]).catch(() => undefined);
    await registerJob(scope === 'system' ? null : req.tenantId ?? null, scope, filename, size, req.userId, 'ok', undefined, dropbox.dropboxPath(toDropbox(cfg), filename));
    res.json({ data: { filename, size_bytes: size } });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});
