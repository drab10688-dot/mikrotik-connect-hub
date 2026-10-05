import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess, requireRole } from '../middleware/auth';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { pool } from '../lib/db';
import { tunnelRouter } from './tunnel';
import { execSync, execFile } from 'child_process';
import { connect as netConnect } from 'net';

export const systemRouter = Router();

// Tunnel management routes
systemRouter.use('/tunnel', tunnelRouter);

/** IPv4 o nombre de equipo: nada que la shell pueda interpretar. */
const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

/** Ejecuta un programa SIN shell (los argumentos nunca se interpretan). */
function runFile(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`;
      if (err) reject(Object.assign(new Error(out.trim() || err.message), { output: out }));
      else resolve(out);
    });
  });
}

// ─── MikroTik Generic Command ────────────────
// Ejecuta cualquier comando REST en el router: solo administradores (el
// técnico usa las rutas de cada sección, que validan ver/editar).
systemRouter.post('/mikrotik/command', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id, command, params: cmdParams } = req.body;
    if (!mikrotik_id || !command) return res.status(400).json({ error: 'mikrotik_id y command requeridos' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotik_id);
    const method = cmdParams ? 'POST' : 'GET';
    const data = await mikrotikRequest(config, `/rest${command}`, method, cmdParams);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Diagnostics ─────────────────────────────
// Antes armaba comandos de shell con el texto del usuario (ping ${host}):
// permitía ejecutar comandos en el contenedor de la API, que controla Docker.
systemRouter.post('/diagnostics', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { action } = req.body;
    const host = String(req.body?.host || '').trim();
    const port = req.body?.port === undefined || req.body?.port === '' ? null : Number(req.body.port);
    if (!host) return res.status(400).json({ error: 'host requerido' });
    if (!HOST_RE.test(host)) return res.status(400).json({ error: 'Host no válido' });
    if (port !== null && !(Number.isInteger(port) && port >= 1 && port <= 65535)) {
      return res.status(400).json({ error: 'Puerto no válido' });
    }

    const results: any = { host, port, action, timestamp: new Date().toISOString() };

    // Ping test
    try {
      const pingResult = await runFile('ping', ['-c', '3', '-W', '2', host], 10000);
      const match = pingResult.match(/(\d+)% packet loss/);
      results.ping = {
        success: true,
        output: pingResult,
        packet_loss: match ? parseInt(match[1]) : null,
      };
    } catch (e: any) {
      results.ping = { success: false, error: e.message };
    }

    // Port check (TCP directo, sin shell)
    if (port) {
      const open = await new Promise<boolean>((resolve) => {
        const sock = netConnect({ host, port, timeout: 3000 });
        sock.once('connect', () => { sock.destroy(); resolve(true); });
        sock.once('timeout', () => { sock.destroy(); resolve(false); });
        sock.once('error', () => resolve(false));
      });
      results.port_check = { success: true, port, open };
    }

    // DNS resolution
    try {
      const dnsResult = await runFile('nslookup', [host], 5000);
      results.dns = { success: true, output: dnsResult };
    } catch (e: any) {
      results.dns = { success: false, error: e.message };
    }

    res.json({ success: true, data: results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Accounting Summary ──────────────────────
systemRouter.get('/accounting/summary', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.query.mikrotik_id as string;
    const startDate = req.query.start_date as string;
    const endDate = req.query.end_date as string;

    if (!mikrotikId) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    // Get invoice totals
    let invoiceQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'paid') as paid_count,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'overdue') as overdue_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) as total_paid,
        COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) as total_pending,
        COALESCE(SUM(amount) FILTER (WHERE status = 'overdue'), 0) as total_overdue,
        COUNT(*) as total_invoices
      FROM client_invoices WHERE mikrotik_id = $1`;
    const params: any[] = [mikrotikId];

    if (startDate) { invoiceQuery += ` AND created_at >= $${params.length + 1}`; params.push(startDate); }
    if (endDate) { invoiceQuery += ` AND created_at <= $${params.length + 1}`; params.push(endDate); }

    const { rows: invoiceSummary } = await pool.query(invoiceQuery, params);

    // Get client count
    const { rows: clientCount } = await pool.query(
      'SELECT COUNT(*) as total FROM isp_clients WHERE mikrotik_id = $1 AND is_potential_client = false',
      [mikrotikId]
    );

    // Get voucher sales
    const { rows: voucherSales } = await pool.query(
      `SELECT COALESCE(SUM(price), 0) as total_voucher_sales, COUNT(*) as vouchers_sold
       FROM voucher_sales_history WHERE mikrotik_id = $1`,
      [mikrotikId]
    );

    res.json({
      data: {
        invoices: invoiceSummary[0],
        clients: { total: parseInt(clientCount[0].total) },
        voucher_sales: voucherSales[0],
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── VPS Status ──────────────────────────────
// Estado y administración de Docker: afectan a TODOS los ISP → solo superadmin.
systemRouter.get('/vps/status', requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const results: any = { timestamp: new Date().toISOString() };

    // System info
    try {
      results.uptime = execSync('uptime -p 2>/dev/null || uptime', { timeout: 3000 }).toString().trim();
      results.disk = execSync("df -h / | tail -1 | awk '{print $3\"/\"$2\" (\"$5\" used)\"}'", { timeout: 3000 }).toString().trim();
      results.memory = execSync("free -h | grep Mem | awk '{print $3\"/\"$2}'", { timeout: 3000 }).toString().trim();
    } catch {}

    // Docker status (running + stopped)
    try {
      const rows = execSync('docker ps -a --format "{{.Names}}|{{.Status}}|{{.Ports}}" 2>/dev/null', { timeout: 5000 }).toString().trim();
      const parsed = rows
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, status = '', ports = ''] = line.split('|');
          return { name, status, ports };
        });

      const containersMap: Record<string, { status: string; ports: string }> = {};
      const aliasMap: Record<string, string[]> = {
        api: ['routeros-proxy'],
      };

      parsed.forEach((container) => {
        const normalized = container.name.replace(/^omnisync-/, '');
        const info = { status: container.status, ports: container.ports };

        containersMap[container.name] = info;
        containersMap[normalized] = info;
        (aliasMap[normalized] || []).forEach((alias) => {
          containersMap[alias] = info;
        });
      });

      results.containers = parsed;
      results.containers_map = containersMap;
    } catch {
      results.containers = [];
      results.containers_map = {};
    }

    res.json({ success: true, data: results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── VPS Docker Management ───────────────────
systemRouter.post('/vps/docker', requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { action, service } = req.body;
    const validActions = ['restart', 'stop', 'start', 'logs', 'ps', 'up', 'down', 'pull'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: `Acción inválida. Válidas: ${validActions.join(', ')}` });
    }

    const serviceAliases: Record<string, string> = {
      'routeros-proxy': 'api',
      'omnisync-api': 'api',
      'omnisync-genieacs': 'genieacs',
      'omnisync-mongo': 'mongo',
      'omnisync-wireguard': 'wireguard',
    };

    const resolvedService = service
      ? (serviceAliases[service] || String(service).replace(/^omnisync-/, ''))
      : '';
    // Solo servicios reales del compose: el nombre va dentro de un comando de shell.
    const SERVICES = ['postgres', 'api', 'nginx', 'mongo', 'genieacs', 'coturn', 'wireguard', 'remote-browser'];
    if (resolvedService && !SERVICES.includes(resolvedService)) {
      return res.status(400).json({ error: `Servicio inválido. Válidos: ${SERVICES.join(', ')}` });
    }

    // Include the integrated ACS profile so GenieACS/Mongo are visible and
    // manageable after updates or host restarts.
    const compose = `COMPOSE_PROFILES=builtin-acs docker compose -f /opt/omnisync/docker-compose.yml`;
    const svcArg = resolvedService ? ` ${resolvedService}` : '';

    let cmd = '';
    switch (action) {
      case 'ps':
        cmd = `${compose} ps 2>&1`;
        break;
      case 'logs':
        cmd = `${compose} logs --tail 80${svcArg} 2>&1`;
        break;
      case 'up':
        cmd = `${compose} up -d${svcArg} 2>&1`;
        break;
      case 'down':
        cmd = `${compose} down 2>&1`;
        break;
      case 'pull':
        cmd = `${compose} pull${svcArg} 2>&1`;
        break;
      default:
        cmd = `${compose} ${action}${svcArg} 2>&1`;
    }

    const output = execSync(cmd, { timeout: 120000 }).toString();
    res.json({ success: true, message: `Acción ${action} ejecutada`, output, service: resolvedService || null });
  } catch (error: any) {
    const stderr = error.stderr ? error.stderr.toString() : '';
    const stdout = error.stdout ? error.stdout.toString() : '';
    const detail = stdout || stderr || error.message;
    res.status(500).json({ success: false, error: detail });
  }
});

// ─── Tunnel Agent (proxy to cloudflare agent on MikroTik) ─
systemRouter.post('/tunnel/agent', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id, action, ...params } = req.body;

    if (mikrotik_id) {
      const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id);
      if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });
    }

    // For now, tunnel agent actions are handled by the tunnel sub-router
    // This endpoint provides compatibility for frontend calls expecting /system/tunnel/agent
    res.json({ success: true, action, message: 'Use /system/tunnel/status, /start, /stop instead' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// System resource info
systemRouter.get('/:mikrotikId/resource', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const data = await mikrotikRequest(config, '/rest/system/resource');
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// System identity
systemRouter.get('/:mikrotikId/identity', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const data = await mikrotikRequest(config, '/rest/system/identity');
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Interfaces
systemRouter.get('/:mikrotikId/interfaces', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const data = await mikrotikRequest(config, '/rest/interface');
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Log
systemRouter.get('/:mikrotikId/log', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const data = await mikrotikRequest(config, '/rest/log');
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DHCP Leases
systemRouter.get('/:mikrotikId/dhcp-leases', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const data = await mikrotikRequest(config, '/rest/ip/dhcp-server/lease');
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DNS Cache
systemRouter.get('/:mikrotikId/dns-cache', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const data = await mikrotikRequest(config, '/rest/ip/dns/cache');
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
