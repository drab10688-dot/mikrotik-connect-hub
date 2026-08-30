/**
 * Escritorio remoto (Chromium + KasmVNC) DEDICADO POR ISP.
 *
 * Cada tenant recibe:
 *   - su propio contenedor  omnisync-browser-<slug>
 *   - su propio puerto HTTPS en Nginx (8100..8129)
 *   - un bloque server generado dinámicamente en /etc/nginx/conf.d
 *
 * Así dos ISP nunca comparten ventana, cookies ni historial.
 */
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { pool } from './db';

const IMAGE = process.env.BROWSER_IMAGE || 'lscr.io/linuxserver/chromium:latest';
const NETWORK = process.env.BROWSER_NETWORK || 'omnisync-browser-net';
const NGINX_CONTAINER = process.env.NGINX_CONTAINER || 'omnisync-nginx';
const DYN_DIR = process.env.NGINX_DYN_DIR || '/opt/omnisync/nginx-dyn';
const PORT_MIN = Number(process.env.BROWSER_PORT_MIN || 8100);
const PORT_MAX = Number(process.env.BROWSER_PORT_MAX || 8129);
const TZ = process.env.TZ || 'America/Bogota';

export interface TenantBrowser {
  tenantId: string | null;
  slug: string;
  container: string;
  port: number;
  running: boolean;
}

export function docker(args: string[], timeout = 30000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile('docker', args, { timeout }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: (stdout || '').trim(), err: (stderr || error?.message || '').trim() });
    });
  });
}

let columnReady = false;
async function ensureColumn() {
  if (columnReady) return;
  await pool
    .query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS browser_port INTEGER`)
    .catch((e: any) => console.warn('[BROWSER] schema:', e.message));
  columnReady = true;
}

/** Reserva (o devuelve) el puerto dedicado del ISP. */
async function reservePort(tenantId: string): Promise<{ port: number; slug: string }> {
  await ensureColumn();
  const { rows } = await pool.query(`SELECT slug, browser_port FROM tenants WHERE id = $1`, [tenantId]);
  if (!rows[0]) throw new Error('ISP no encontrado');
  const slug = String(rows[0].slug || tenantId).slice(0, 40);
  if (rows[0].browser_port) return { port: Number(rows[0].browser_port), slug };

  const used = await pool.query(`SELECT browser_port FROM tenants WHERE browser_port IS NOT NULL`);
  const taken = new Set<number>(used.rows.map((r: any) => Number(r.browser_port)));
  let port = 0;
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (!taken.has(p)) {
      port = p;
      break;
    }
  }
  if (!port) throw new Error('No hay puertos disponibles para nuevos escritorios remotos');
  await pool.query(`UPDATE tenants SET browser_port = $2 WHERE id = $1`, [tenantId, port]);
  return { port, slug };
}

function nginxConf(port: number, container: string): string {
  return `# Escritorio remoto dedicado — ${container}
server {
    listen ${port} ssl;
    http2 on;
    server_name _;

    ssl_certificate     /etc/nginx/certs/remote.crt;
    ssl_certificate_key /etc/nginx/certs/remote.key;

    location = /authz {
        internal;
        resolver 127.0.0.11 valid=30s;
        proxy_pass http://api:3000/api/browser-authz;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header X-Browser-Port "${port}";
        proxy_set_header Cookie $http_cookie;
    }

    location / {
        auth_request /authz;
        resolver 127.0.0.11 valid=30s;
        set $rb http://${container}:3000;
        proxy_pass $rb;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_socket_keepalive on;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
`;
}

async function writeNginxConf(slug: string, port: number, container: string) {
  const file = path.join(DYN_DIR, `browser-${slug}.conf`);
  const body = nginxConf(port, container);
  let current = '';
  try {
    current = await fs.readFile(file, 'utf8');
  } catch {
    /* no existe */
  }
  if (current === body) return;
  await fs.mkdir(DYN_DIR, { recursive: true });
  await fs.writeFile(file, body, 'utf8');
  const test = await docker(['exec', NGINX_CONTAINER, 'nginx', '-t'], 15000);
  if (!test.ok) {
    await fs.unlink(file).catch(() => undefined);
    throw new Error(`Nginx rechazó la configuración del escritorio: ${test.err}`);
  }
  await docker(['exec', NGINX_CONTAINER, 'nginx', '-s', 'reload'], 15000);
}

async function containerStatus(name: string): Promise<string> {
  const r = await docker(['inspect', '--format', '{{.State.Status}}', name], 8000);
  return r.ok ? r.out : 'missing';
}

async function createContainer(name: string) {
  const args = [
    'run', '-d',
    '--name', name,
    '--restart', 'unless-stopped',
    '--network', NETWORK,
    '--shm-size', '1gb',
    '--security-opt', 'seccomp=unconfined',
    '--dns', '127.0.0.1',
    '--tmpfs', '/config/.config/chromium:mode=1777,size=512m',
    '--tmpfs', '/config/.cache:mode=1777,size=256m',
    '-e', 'PUID=1000',
    '-e', 'PGID=1000',
    '-e', `TZ=${TZ}`,
    '-e',
    'CHROME_CLI=--incognito --disable-sync --no-first-run --no-default-browser-check --password-store=basic --disable-features=Translate,AutofillServerCommunication about:blank',
    IMAGE,
  ];
  const run = await docker(args, 120000);
  if (!run.ok) throw new Error(`No se pudo crear el escritorio del ISP: ${run.err}`);
}

/**
 * Garantiza contenedor + puerto + ruta Nginx del ISP y devuelve sus datos.
 * Si el usuario no tiene tenant (instalación de un solo ISP) usa el navegador global.
 */
export async function ensureTenantBrowser(tenantId: string | null | undefined): Promise<TenantBrowser> {
  if (!tenantId) {
    const container = process.env.BROWSER_CONTAINER || 'omnisync-browser';
    const status = await containerStatus(container);
    return { tenantId: null, slug: 'global', container, port: 8081, running: status === 'running' };
  }

  const { port, slug } = await reservePort(tenantId);
  const container = `omnisync-browser-${slug}`;

  let status = await containerStatus(container);
  if (status === 'missing') {
    await createContainer(container);
    status = await containerStatus(container);
  } else if (status !== 'running') {
    await docker(['start', container], 60000);
    status = await containerStatus(container);
  }

  await writeNginxConf(slug, port, container);

  return { tenantId, slug, container, port, running: status === 'running' };
}

/** Comprueba que el puerto solicitado pertenece realmente al ISP del token. */
export async function tenantOwnsPort(tenantId: string | null | undefined, port: number): Promise<boolean> {
  if (!port || port === 8081 || port === 8082) return true; // escritorios globales
  if (!tenantId) return false;
  await ensureColumn();
  const { rows } = await pool.query(`SELECT 1 FROM tenants WHERE id = $1 AND browser_port = $2`, [tenantId, port]);
  return !!rows[0];
}

/** Elimina el escritorio de un ISP (al borrarlo o desactivarlo). */
export async function removeTenantBrowser(slug: string) {
  const container = `omnisync-browser-${slug}`;
  await docker(['rm', '-f', container], 60000);
  await fs.unlink(path.join(DYN_DIR, `browser-${slug}.conf`)).catch(() => undefined);
  await docker(['exec', NGINX_CONTAINER, 'nginx', '-s', 'reload'], 15000);
}
