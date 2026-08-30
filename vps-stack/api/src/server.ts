import express from 'express';
import cors from 'cors';
import { execSync } from 'child_process';
import helmet from 'helmet';
import { pool } from './lib/db';
import cron from 'node-cron';
import { authRouter } from './routes/auth';
import { devicesRouter } from './routes/devices';
import { pppoeRouter } from './routes/pppoe';
import { systemRouter } from './routes/system';
import { usersRouter } from './routes/users';
import { onuRouter } from './routes/onu';
import { genieacsRouter } from './routes/genieacs';
import { vpnRouter } from './routes/vpn';
import { netAccessRouter } from './routes/netaccess';
import { tenantsRouter, tenantsPublicRouter } from './routes/tenants';
import { ispRouter, ispPublicRouter, requireSection, requireModule } from './routes/isp';
import { onuWebRouter } from './routes/onu-web';
import { browserRouter } from './routes/browser';
import { ensureIspSchema } from './lib/ensure-isp-schema';
import { authMiddleware, requirePermission, requireRole } from './middleware/auth';
import { runSignalCollectCron, runSignalCleanupCron } from './cron/signal-collect';
import { runPppoeMonitor, cleanupPppoeEvents } from './cron/pppoe-monitor';
import { collectAcsSignals, cleanupAcsSignals } from './lib/acs-signal';

// Re-export pool for backward compatibility with cron jobs
export { pool };

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes
app.use('/api/auth', authRouter);
app.use('/api/tenants/public', tenantsPublicRouter); // branding público por ISP
app.use('/api/public', ispPublicRouter); // resolución del token TR-069 por ISP



// Protected routes
app.use('/api/tenants', authMiddleware, tenantsRouter);
app.use('/api/isp', authMiddleware, ispRouter);
app.use('/api/devices', authMiddleware, devicesRouter);
app.use('/api/pppoe', authMiddleware, requirePermission('can_manage_pppoe'), requireSection('mikrotik'), requireModule('enable_mikrotik'), pppoeRouter);
app.use('/api/system', authMiddleware, systemRouter);
app.use('/api/auth/users', authMiddleware, requireRole('super_admin', 'admin'), usersRouter);
app.use('/api/onu', authMiddleware, requirePermission('can_manage_onu'), requireSection('onus'), requireModule('enable_onus'), onuRouter);
app.use('/api/genieacs', authMiddleware, requirePermission('can_manage_onu'), requireSection('onus'), requireModule('enable_onus'), requireModule('enable_tr069'), genieacsRouter);
// Acceso web directo a la ONU (sin TR-069), con perfiles aprendidos por modelo
app.use('/api/onu-web', authMiddleware, requireSection('onu_web'), requireModule('enable_onu_web'), onuWebRouter);
app.use('/api/netaccess', authMiddleware, requireSection('red'), requireModule('enable_mikrotik'), netAccessRouter);
app.use('/api/vpn', authMiddleware, requirePermission('can_manage_vps_services'), vpnRouter);
// Navegador remoto (Firefox real) para abrir ONUs/antenas con captcha o JS pesado
app.use('/api/browser', authMiddleware, browserRouter);


// Aliases for frontend compatibility
app.use('/api/mikrotik', authMiddleware, (req, res, next) => {
  // Forward /api/mikrotik/command to /api/system/mikrotik/command
  if (req.path === '/command' && req.method === 'POST') {
    req.url = '/mikrotik/command';
    return systemRouter(req, res, next);
  }
  next();
});


// Cron: recolección de señal óptica cada 5 minutos
cron.schedule('*/5 * * * *', () => {
  console.log('[CRON] Running optical signal collection...');
  // ACS-driven: todas las ONUs conectadas a GenieACS (no requiere registro local)
  collectAcsSignals(pool)
    .then(r => console.log(`[CRON] ACS signal: ${r.collected}/${r.total} ONUs, ${r.alertsSent} alertas`))
    .catch(e => console.error('[CRON] ACS signal error:', e.message));
  // Legacy: ONUs registradas localmente y vinculadas a un MikroTik
  runSignalCollectCron(pool);
});

// Cron: limpieza de historial de señal óptica cada día a las 3:00 AM
cron.schedule('0 3 * * *', () => {
  console.log('[CRON] Running signal history cleanup...');
  cleanupAcsSignals(pool)
    .then(n => console.log(`[CRON] ACS signal cleanup: ${n} registros`))
    .catch(e => console.error('[CRON] ACS cleanup error:', e.message));
  runSignalCleanupCron(pool);
  cleanupPppoeEvents(pool)
    .then(n => console.log(`[CRON] PPPoE events cleanup: ${n} registros`))
    .catch(e => console.error('[CRON] PPPoE cleanup error:', e.message));
});

// Cron: monitor de sesiones PPPoE (detecta desconexiones) cada minuto
cron.schedule('* * * * *', () => {
  runPppoeMonitor(pool).catch(e => console.error('[CRON] PPPoE monitor error:', e.message));
});

app.listen(PORT, () => {
  console.log(`🚀 OmniSync API running on port ${PORT}`);

  // Esquema multi-ISP (tokens TR-069, permisos, peers VPN)
  ensureIspSchema(pool).catch((e: any) => console.error('[SCHEMA] isp:', e.message));
  
  // Auto-configure WireGuard route after a short delay (wait for DNS)
  setTimeout(async () => {
    try {
      // Try multiple methods to find WireGuard container IP
      const methods = [
        "getent hosts omnisync-wireguard | awk '{print $1}' | head -1",
        "getent hosts wireguard | awk '{print $1}' | head -1",
        "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' omnisync-wireguard 2>/dev/null | awk '{print $NF}'",
      ];
      
      let wgIp = '';
      for (const cmd of methods) {
        try {
          const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
          if (result && /^\d+\.\d+\.\d+\.\d+$/.test(result)) {
            wgIp = result;
            break;
          }
        } catch {}
      }
      
      if (wgIp) {
        // First ensure WireGuard is on our network
        try {
          execSync(
            `docker network connect omnisync_omnisync-net omnisync-wireguard 2>/dev/null || true`,
            { timeout: 10000 }
          );
        } catch {}
        
        // Re-resolve after network connect
        try {
          const freshIp = execSync(
            `docker inspect omnisync-wireguard --format '{{range $k,$v := .NetworkSettings.Networks}}{{if eq $k "omnisync_omnisync-net"}}{{$v.IPAddress}}{{end}}{{end}}' 2>/dev/null`,
            { encoding: 'utf-8', timeout: 5000 }
          ).trim();
          if (freshIp && /^\d+\.\d+\.\d+\.\d+$/.test(freshIp)) {
            wgIp = freshIp;
          }
        } catch {}
        
        // Add route
        try {
          execSync(`ip route replace 10.13.13.0/24 via ${wgIp}`, { timeout: 5000 });
          console.log(`🔗 WireGuard route configured via ${wgIp}`);
        } catch (routeErr: any) {
          console.log(`⚠️ Could not add WireGuard route: ${routeErr.message}`);
        }
        
        // Setup iptables forwarding on WireGuard container
        try {
          const fwdCmds = [
            'iptables -C FORWARD -i eth0 -o wg0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i eth0 -o wg0 -j ACCEPT',
            'iptables -C FORWARD -i wg0 -o eth0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i wg0 -o eth0 -j ACCEPT',
            'iptables -t nat -C POSTROUTING -s 172.16.0.0/12 -o wg0 -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 172.16.0.0/12 -o wg0 -j MASQUERADE',
          ].join(' && ');
          execSync(`docker exec omnisync-wireguard sh -c '${fwdCmds}'`, { timeout: 10000 });
          console.log(`🔗 WireGuard iptables forwarding configured`);
        } catch (fwErr: any) {
          console.log(`⚠️ Could not configure WireGuard forwarding: ${fwErr.message}`);
        }
      } else {
        console.log('ℹ️ WireGuard container not found, skipping route setup');
      }
    } catch (err: any) {
      console.log(`ℹ️ WireGuard route setup skipped: ${err.message}`);
    }
  }, 5000);
});
