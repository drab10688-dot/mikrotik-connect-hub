import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Pool } from 'pg';
import cron from 'node-cron';
import { authRouter } from './routes/auth';
import { devicesRouter } from './routes/devices';
import { clientsRouter } from './routes/clients';
import { pppoeRouter } from './routes/pppoe';
import { hotspotRouter } from './routes/hotspot';
import { queuesRouter } from './routes/queues';
import { vouchersRouter } from './routes/vouchers';
import { billingRouter } from './routes/billing';
import { invoicesRouter } from './routes/invoices';
import { addressListRouter } from './routes/address-list';
import { addressListRouter } from './routes/address-list';
import { systemRouter } from './routes/system';
import { backupRouter } from './routes/backup';
import { authMiddleware } from './middleware/auth';
import { runBillingCron } from './cron/billing';

const app = express();
const PORT = process.env.PORT || 3000;

// Database pool
export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'omnisync',
  user: process.env.DB_USER || 'omnisync',
  password: process.env.DB_PASSWORD || 'changeme_postgres',
  max: 20,
  idleTimeoutMillis: 30000,
});

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

// Protected routes
app.use('/api/devices', authMiddleware, devicesRouter);
app.use('/api/clients', authMiddleware, clientsRouter);
app.use('/api/pppoe', authMiddleware, pppoeRouter);
app.use('/api/hotspot', authMiddleware, hotspotRouter);
app.use('/api/queues', authMiddleware, queuesRouter);
app.use('/api/vouchers', authMiddleware, vouchersRouter);
app.use('/api/billing', authMiddleware, billingRouter);
app.use('/api/invoices', authMiddleware, invoicesRouter);
app.use('/api/address-list', authMiddleware, addressListRouter);
app.use('/api/system', authMiddleware, systemRouter);
app.use('/api/backups', authMiddleware, backupRouter);

// Cron: billing diario 6:00 AM
cron.schedule('0 6 * * *', () => {
  console.log('[CRON] Running daily billing tasks...');
  runBillingCron(pool);
});

app.listen(PORT, () => {
  console.log(`🚀 OmniSync API running on port ${PORT}`);
});
