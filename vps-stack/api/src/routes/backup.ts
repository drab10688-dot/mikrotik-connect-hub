import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../lib/db';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import multer from 'multer';

const execAsync = promisify(exec);
const BACKUP_DIR = process.env.BACKUP_DIR || '/opt/omnisync/backups';

const DB_HOST = process.env.DB_HOST || 'postgres';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_USER = process.env.DB_USER || 'omnisync';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'omnisync';

// Multer config for upload
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    cb(null, BACKUP_DIR);
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safeName);
  },
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB max

export const backupRouter = Router();

function requireSuperAdmin(req: AuthRequest, res: Response): boolean {
  if (req.userRole !== 'super_admin') {
    res.status(403).json({ error: 'Solo super_admin puede gestionar backups' });
    return false;
  }
  return true;
}

/**
 * Dump the PostgreSQL database using pg_dump via network (no docker needed).
 * pg_dump must be available inside the API container.
 */
async function pgDump(outputPath: string): Promise<void> {
  const env = { ...process.env, PGPASSWORD: DB_PASSWORD };
  await execAsync(
    `pg_dump -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${DB_NAME} -f "${outputPath}"`,
    { timeout: 300000, env }
  );
}

/**
 * Restore a SQL file into PostgreSQL via psql over network.
 */
async function pgRestore(filePath: string): Promise<void> {
  const env = { ...process.env, PGPASSWORD: DB_PASSWORD };
  await execAsync(
    `psql -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${DB_NAME} -f "${filePath}"`,
    { timeout: 300000, env }
  );
}

// List existing backups
backupRouter.get('/', async (req: AuthRequest, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const files = fs.readdirSync(BACKUP_DIR);
    const backups = files
      .filter(f => f.endsWith('.tar.gz') || f.endsWith('.sql') || f.endsWith('.tar') || f.endsWith('.gz') || f.endsWith('.bak'))
      .map(f => {
        const stats = fs.statSync(path.join(BACKUP_DIR, f));
        const type = f.includes('docker') ? 'docker' :
                     f.includes('db') ? 'database' :
                     f.includes('full') ? 'full' : 'config';
        return {
          name: f,
          size: stats.size,
          sizeFormatted: formatSize(stats.size),
          created: stats.birthtime || stats.mtime,
          type,
        };
      })
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

    // Get disk usage
    let diskInfo = { total: '0', used: '0', available: '0', percent: '0%' };
    try {
      const { stdout } = await execAsync("df -h /opt/omnisync 2>/dev/null | tail -1 | awk '{print $2,$3,$4,$5}'");
      const parts = stdout.trim().split(' ');
      if (parts.length >= 4) {
        diskInfo = { total: parts[0], used: parts[1], available: parts[2], percent: parts[3] };
      }
    } catch {}

    res.json({
      success: true,
      data: {
        backups,
        disk: diskInfo,
        backupDir: BACKUP_DIR,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create backup
backupRouter.post('/create', async (req: AuthRequest, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  try {
    const { type = 'database' } = req.body; // 'database', 'config', 'full'
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    let resultFile = '';

    switch (type) {
      case 'database': {
        resultFile = `db-backup-${timestamp}.sql`;
        await pgDump(path.join(BACKUP_DIR, resultFile));
        break;
      }

      case 'config': {
        resultFile = `config-backup-${timestamp}.tar.gz`;
        // Only backup config files accessible from the volume
        const configFiles = ['.env', 'docker-compose.yml'].filter(f =>
          fs.existsSync(path.join('/opt/omnisync', f))
        ).join(' ');

        const configDirs = ['nginx', 'radius'].filter(d =>
          fs.existsSync(path.join('/opt/omnisync', d))
        ).join(' ');

        const items = [configFiles, configDirs].filter(Boolean).join(' ');
        if (items) {
          await execAsync(
            `tar czf ${BACKUP_DIR}/${resultFile} -C /opt/omnisync ${items} 2>/dev/null || true`,
            { timeout: 120000 }
          );
        } else {
          return res.status(400).json({ error: 'No se encontraron archivos de configuración para respaldar' });
        }
        break;
      }

      case 'full': {
        resultFile = `full-backup-${timestamp}.tar.gz`;
        const dbFile = `db-temp-${timestamp}.sql`;
        const dbPath = path.join(BACKUP_DIR, dbFile);

        // Dump DB first
        await pgDump(dbPath);

        // Create tarball with config + db dump
        const configItems = ['.env', 'docker-compose.yml'].filter(f =>
          fs.existsSync(path.join('/opt/omnisync', f))
        ).join(' ');

        const configDirs = ['nginx', 'radius'].filter(d =>
          fs.existsSync(path.join('/opt/omnisync', d))
        ).join(' ');

        await execAsync(
          `tar czf ${BACKUP_DIR}/${resultFile} -C /opt/omnisync ${configItems} ${configDirs} -C ${BACKUP_DIR} ${dbFile} 2>/dev/null || true`,
          { timeout: 300000 }
        );

        // Cleanup temp db file
        fs.unlinkSync(dbPath);
        break;
      }

      default:
        return res.status(400).json({ error: 'Tipo de backup inválido. Usa: database, config, full' });
    }

    const filePath = path.join(BACKUP_DIR, resultFile);
    if (!fs.existsSync(filePath)) {
      return res.status(500).json({ success: false, error: 'El archivo de backup no se creó correctamente' });
    }

    const stats = fs.statSync(filePath);

    res.json({
      success: true,
      data: {
        name: resultFile,
        size: stats.size,
        sizeFormatted: formatSize(stats.size),
        type,
        created: new Date().toISOString(),
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Restore database backup
backupRouter.post('/restore', async (req: AuthRequest, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Nombre de archivo requerido' });

    // Security: prevent path traversal
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Nombre de archivo inválido' });
    }

    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });

    if (filename.endsWith('.sql')) {
      await pgRestore(filePath);
    } else if (filename.endsWith('.tar.gz')) {
      // Extract config files
      await execAsync(`tar xzf ${filePath} -C /opt/omnisync/ 2>/dev/null || true`, { timeout: 120000 });
    }

    res.json({ success: true, message: 'Backup restaurado correctamente' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete backup
backupRouter.delete('/:filename', async (req: AuthRequest, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  try {
    const filename = req.params.filename as string;
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Nombre de archivo inválido' });
    }

    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });

    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download backup
backupRouter.get('/download/:filename', async (req: AuthRequest, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  try {
    const filename = req.params.filename as string;
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Nombre de archivo inválido' });
    }

    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });

    res.download(filePath, filename as string);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload backup
backupRouter.post('/upload', upload.single('backup'), async (req: AuthRequest, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  try {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    const stats = fs.statSync(file.path);
    res.json({
      success: true,
      data: {
        name: file.filename,
        size: stats.size,
        sizeFormatted: formatSize(stats.size),
        type: file.filename.includes('docker') ? 'docker' :
              file.filename.includes('db') ? 'database' :
              file.filename.includes('full') ? 'full' : 'config',
        created: new Date().toISOString(),
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
