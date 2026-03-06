import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { pool } from '../lib/db';
import { tunnelRouter } from './tunnel';
import { execSync } from 'child_process';

export const systemRouter = Router();

// Tunnel management routes
systemRouter.use('/tunnel', tunnelRouter);

// ─── MikroTik Generic Command ────────────────
systemRouter.post('/mikrotik/command', async (req: AuthRequest, res: Response) => {
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
systemRouter.post('/diagnostics', async (req: AuthRequest, res: Response) => {
  try {
    const { host, port, action } = req.body;
    if (!host) return res.status(400).json({ error: 'host requerido' });

    const results: any = { host, port, action, timestamp: new Date().toISOString() };

    // Ping test
    try {
      const pingResult = execSync(`ping -c 3 -W 2 ${host} 2>&1`, { timeout: 10000 }).toString();
      const match = pingResult.match(/(\d+)% packet loss/);
      results.ping = {
        success: true,
        output: pingResult,
        packet_loss: match ? parseInt(match[1]) : null,
      };
    } catch (e: any) {
      results.ping = { success: false, error: e.message };
    }

    // Port check
    if (port) {
      try {
        execSync(`timeout 3 bash -c "echo > /dev/tcp/${host}/${port}" 2>&1`, { timeout: 5000 });
        results.port_check = { success: true, port, open: true };
      } catch {
        results.port_check = { success: true, port, open: false };
      }
    }

    // DNS resolution
    try {
      const dnsResult = execSync(`nslookup ${host} 2>&1`, { timeout: 5000 }).toString();
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
systemRouter.get('/vps/status', async (req: AuthRequest, res: Response) => {
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
        freeradius: ['radius'],
        mariadb: ['radius-db'],
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
systemRouter.post('/vps/docker', async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== 'super_admin' && req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores' });
    }

    const { action, service } = req.body;
    const validActions = ['restart', 'stop', 'start', 'logs', 'ps', 'up', 'down', 'pull'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: `Acción inválida. Válidas: ${validActions.join(', ')}` });
    }

    const serviceAliases: Record<string, string> = {
      'routeros-proxy': 'api',
      'omnisync-api': 'api',
      radius: 'freeradius',
      'omnisync-freeradius': 'freeradius',
      'radius-db': 'mariadb',
      'omnisync-mariadb': 'mariadb',
      phpnuxbill: 'phpnuxbill',
      'omnisync-phpnuxbill': 'phpnuxbill',
    };

    const resolvedService = service
      ? (serviceAliases[service] || service.replace(/^omnisync-/, ''))
      : '';

    const serviceProfiles: Record<string, string> = {
      genieacs: 'tr069',
      mongodb: 'tr069',
      wireguard: 'vpn',
    };

    const profileArg = resolvedService && serviceProfiles[resolvedService]
      ? ` --profile ${serviceProfiles[resolvedService]}`
      : '';

    const svcArg = resolvedService ? ` ${resolvedService}` : '';

    let cmd = '';
    switch (action) {
      case 'ps':
        cmd = `docker compose${profileArg} -f /opt/omnisync/docker-compose.yml ps 2>&1`;
        break;
      case 'logs':
        cmd = `docker compose${profileArg} -f /opt/omnisync/docker-compose.yml logs --tail 80${svcArg} 2>&1`;
        break;
      case 'up':
        cmd = `docker compose${profileArg} -f /opt/omnisync/docker-compose.yml up -d${svcArg} 2>&1`;
        break;
      case 'down':
        cmd = `docker compose${profileArg} -f /opt/omnisync/docker-compose.yml down 2>&1`;
        break;
      case 'pull':
        cmd = `docker compose${profileArg} -f /opt/omnisync/docker-compose.yml pull${svcArg} 2>&1`;
        break;
      default:
        cmd = `docker compose${profileArg} -f /opt/omnisync/docker-compose.yml ${action}${svcArg} 2>&1`;
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
