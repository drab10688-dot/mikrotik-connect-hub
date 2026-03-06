import { Pool } from 'pg';

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'omnisync',
  user: process.env.DB_USER || 'omnisync',
  password: process.env.DB_PASSWORD || 'changeme_postgres',
  max: 20,
  idleTimeoutMillis: 30000,
});
