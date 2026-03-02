import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);
const BACKUP_DIR = process.env.BACKUP_DIR || '/opt/omnisync/backups';

export const backupRouter = Router();

// Only super_admin can manage backups
function requireSuperAdmin(req: AuthRequest, res: Response): boolean {
  if (req.userRole !== 'super_admin') {
    res.status(403).json({ error: 'Solo super_admin puede gestionar backups' });
    return false;
  }
  return true;
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
      .filter(f => f.endsWith('.tar.gz') || f.endsWith('.sql') || f.endsWith('.tar'))
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
      const { stdout } = await execAsync("df -h /opt/omnisync | tail -1 | awk '{print $2,$3,$4,$5}'");
      const parts = stdout.trim().split(' ');
      diskInfo = { total: parts[0], used: parts[1], available: parts[2], percent: parts[3] };
    } catch {}

    // Get Docker status
    let dockerServices: any[] = [];
    try {
      const { stdout } = await execAsync('cd /opt/omnisync && docker compose ps --format json 2>/dev/null || echo "[]"');
      const lines = stdout.trim().split('\n').filter(l => l.startsWith('{'));
      dockerServices = lines.map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch {}

    res.json({
      success: true,
      data: {
        backups,
        disk: diskInfo,
        services: dockerServices,
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
    const { type = 'full' } = req.body; // 'database', 'docker', 'config', 'full'
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    let resultFile = '';
    let commands: string[] = [];

    switch (type) {
      case 'database':
        resultFile = `db-backup-${timestamp}.sql`;
        commands = [
          `docker compose -f /opt/omnisync/docker-compose.yml exec -T postgres pg_dumpall -U ${process.env.DB_USER || 'omnisync'} > ${BACKUP_DIR}/${resultFile}`
        ];
        break;

      case 'docker':
        resultFile = `docker-images-${timestamp}.tar`;
        commands = [
          `docker save -o ${BACKUP_DIR}/${resultFile} $(docker images --format "{{.Repository}}:{{.Tag}}" | grep -v '<none>' | head -20)`
        ];
        break;

      case 'config':
        resultFile = `config-backup-${timestamp}.tar.gz`;
        commands = [
          `tar czf ${BACKUP_DIR}/${resultFile} -C /opt/omnisync .env docker-compose.yml nginx/ radius/ 2>/dev/null || true`
        ];
        break;

      case 'full':
        resultFile = `full-backup-${timestamp}.tar.gz`;
        const dbFile = `${BACKUP_DIR}/temp-db-${timestamp}.sql`;
        commands = [
          `docker compose -f /opt/omnisync/docker-compose.yml exec -T postgres pg_dumpall -U ${process.env.DB_USER || 'omnisync'} > ${dbFile}`,
          `tar czf ${BACKUP_DIR}/${resultFile} -C /opt/omnisync .env docker-compose.yml nginx/ radius/ -C ${BACKUP_DIR} temp-db-${timestamp}.sql 2>/dev/null || true`,
          `rm -f ${dbFile}`
        ];
        break;

      default:
        return res.status(400).json({ error: 'Tipo de backup inválido' });
    }

    for (const cmd of commands) {
      await execAsync(cmd, { timeout: 300000 }); // 5 min timeout
    }

    const stats = fs.statSync(path.join(BACKUP_DIR, resultFile));

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

    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });

    // Security: prevent path traversal
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Nombre de archivo inválido' });
    }

    if (filename.endsWith('.sql')) {
      await execAsync(
        `cat ${filePath} | docker compose -f /opt/omnisync/docker-compose.yml exec -T postgres psql -U ${process.env.DB_USER || 'omnisync'}`,
        { timeout: 300000 }
      );
    } else if (filename.endsWith('.tar')) {
      await execAsync(`docker load -i ${filePath}`, { timeout: 600000 });
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

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
