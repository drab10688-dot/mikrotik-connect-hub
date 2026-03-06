import express from 'express';
import cors from 'cors';
import { execSync } from 'child_process';
import helmet from 'helmet';
import { pool } from './lib/db';
import cron from 'node-cron';
import { authRouter } from './routes/auth';
import { devicesRouter } from './routes/devices';
import { clientsRouter } from './routes/clients';
import { pppoeRouter } from './routes/pppoe';
import { hotspotRouter } from './routes/hotspot';
import { queuesRouter } from './routes/queues';
import { vouchersRouter } from './routes/vouchers';
import { portalAdsRouter } from './routes/portal-ads';
import { billingRouter } from './routes/billing';
import { invoicesRouter } from './routes/invoices';
import { addressListRouter } from './routes/address-list';
import { systemRouter } from './routes/system';
import { backupRouter } from './routes/backup';
import { usersRouter } from './routes/users';
import { contractsRouter } from './routes/contracts';
import { serviceOptionsRouter } from './routes/service-options';
import { messagingRouter } from './routes/messaging';
import { voucherPresetsRouter } from './routes/voucher-presets';
import { onuRouter } from './routes/onu';
import { genieacsRouter } from './routes/genieacs';
import { vpnRouter } from './routes/vpn';
import { ubiquitiRouter } from './routes/ubiquiti';
import { antennasRouter } from './routes/antennas';
import { authMiddleware } from './middleware/auth';
import { runBillingCron } from './cron/billing';
import { runSignalCollectCron, runSignalCleanupCron } from './cron/signal-collect';

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
app.use('/api/hotspot', hotspotRouter); // hotspot/login is public, others need auth via route-level check
app.use('/api/portal-ads', (req, res, next) => {
  // Public routes don't need auth
  if (req.path.startsWith('/public/')) return next();
  return authMiddleware(req, res, next);
}, portalAdsRouter);

// Protected routes
app.use('/api/devices', authMiddleware, devicesRouter);
// IMPORTANT: register specific /api/clients sub-routes before generic /api/clients
app.use('/api/clients/contracts', authMiddleware, contractsRouter);
app.use('/api/clients/service-options', authMiddleware, serviceOptionsRouter);
// Stable alias to avoid route collisions with /api/clients/:mikrotikId in older deployments
app.use('/api/service-options', authMiddleware, serviceOptionsRouter);
app.use('/api/clients', authMiddleware, clientsRouter);
app.use('/api/pppoe', authMiddleware, pppoeRouter);
app.use('/api/queues', authMiddleware, queuesRouter);
// IMPORTANT: register /api/vouchers/presets BEFORE /api/vouchers to avoid route collision
app.use('/api/vouchers/presets', authMiddleware, voucherPresetsRouter);
app.use('/api/vouchers', authMiddleware, vouchersRouter);
app.use('/api/billing', authMiddleware, billingRouter);
app.use('/api/invoices', authMiddleware, invoicesRouter);
app.use('/api/address-list', authMiddleware, addressListRouter);
app.use('/api/system', authMiddleware, systemRouter);
app.use('/api/backups', authMiddleware, backupRouter);
app.use('/api/auth/users', authMiddleware, usersRouter);
app.use('/api/messaging', authMiddleware, messagingRouter);
app.use('/api/onu', authMiddleware, onuRouter);
app.use('/api/genieacs', authMiddleware, genieacsRouter);
app.use('/api/vpn', authMiddleware, vpnRouter);
app.use('/api/ubiquiti', authMiddleware, ubiquitiRouter);
app.use('/api/antennas', authMiddleware, antennasRouter);

// Aliases for frontend compatibility
app.use('/api/mikrotik', authMiddleware, (req, res, next) => {
  // Forward /api/mikrotik/command to /api/system/mikrotik/command
  if (req.path === '/command' && req.method === 'POST') {
    req.url = '/mikrotik/command';
    return systemRouter(req, res, next);
  }
  next();
});
app.use('/api/accounting', authMiddleware, (req, res, next) => {
  // Forward /api/accounting/summary to /api/system/accounting/summary
  if (req.path === '/summary' && req.method === 'GET') {
    req.url = '/accounting/summary';
    return systemRouter(req, res, next);
  }
  next();
});

// Cron: billing diario 6:00 AM
cron.schedule('0 6 * * *', () => {
  console.log('[CRON] Running daily billing tasks...');
  runBillingCron(pool);
});

// Cron: recolección de señal óptica cada 15 minutos
cron.schedule('*/15 * * * *', () => {
  console.log('[CRON] Running optical signal collection...');
  runSignalCollectCron(pool);
});

// Cron: limpieza de historial de señal óptica cada día a las 3:00 AM
cron.schedule('0 3 * * *', () => {
  console.log('[CRON] Running signal history cleanup...');
  runSignalCleanupCron(pool);
});

app.listen(PORT, () => {
  console.log(`🚀 OmniSync API running on port ${PORT}`);
  
  // Auto-configure WireGuard route if wireguard container is reachable
  try {
    const wgIp = execSync(
      "getent hosts omnisync-wireguard | awk '{print $1}' | head -1",
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    if (wgIp) {
      try {
        execSync(`ip route add 10.13.13.0/24 via ${wgIp} 2>/dev/null || true`, { timeout: 5000 });
        console.log(`🔗 WireGuard route added via ${wgIp}`);
      } catch {
        console.log('ℹ️ WireGuard route already exists or not needed');
      }
    }
  } catch {
    console.log('ℹ️ WireGuard container not found, skipping route setup');
  }
});
