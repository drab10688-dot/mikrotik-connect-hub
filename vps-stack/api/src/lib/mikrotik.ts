/**
 * MikroTik REST API Client + Native API v6 support
 * Supports RouterOS v7 REST API and v6 via native binary protocol
 */
import { Socket } from 'net';
import * as tls from 'tls';

interface MikroTikConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  useTls?: boolean;
}

export async function mikrotikRequest(
  config: MikroTikConfig,
  path: string,
  method: string = 'GET',
  body?: Record<string, unknown>
): Promise<unknown> {
  const useTls = config.useTls ?? (config.port === 443 || config.port === 8729);
  const protocol = useTls ? 'https' : 'http';
  const url = `${protocol}://${config.host}:${config.port}${path}`;
  const authString = Buffer.from(`${config.username}:${config.password}`).toString('base64');

  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Basic ${authString}`,
      'Content-Type': 'application/json',
    },
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  options.signal = controller.signal;

  if (useTls && typeof (globalThis as any).process !== 'undefined') {
    (options as any).agent = new (require('https').Agent)({ rejectUnauthorized: false });
  }

  try {
    const response = await fetch(url, options);
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MikroTik HTTP ${response.status}: ${text}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      return await response.json();
    }
    const text = await response.text();
    try { return JSON.parse(text); } catch { return text; }
  } catch (error: unknown) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('MikroTik connection timeout (15s)');
    }
    throw error;
  }
}

/**
 * Try multiple connection strategies for MikroTik REST API
 */
export async function mikrotikRequestWithFallback(
  config: MikroTikConfig,
  path: string,
  method: string = 'GET',
  body?: Record<string, unknown>
): Promise<{ data: unknown; usedConfig: { protocol: string; port: number } }> {
  const strategies: Array<{ useTls: boolean; port: number; label: string }> = [];

  strategies.push({ useTls: true, port: config.port, label: `HTTPS:${config.port}` });
  strategies.push({ useTls: false, port: config.port, label: `HTTP:${config.port}` });

  const fallbackPorts = [443, 80, 8728, 8729];
  for (const port of fallbackPorts) {
    if (port === config.port) continue;
    const t = port === 443 || port === 8729;
    strategies.push({ useTls: t, port, label: `${t ? 'HTTPS' : 'HTTP'}:${port}` });
  }

  let lastError: Error | null = null;

  for (const strategy of strategies) {
    try {
      const data = await mikrotikRequest(
        { ...config, port: strategy.port, useTls: strategy.useTls },
        path, method, body
      );
      return {
        data,
        usedConfig: { protocol: strategy.useTls ? 'https' : 'http', port: strategy.port },
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const msg = lastError.message.toLowerCase();
      if (msg.includes('401') || msg.includes('403')) throw lastError;
    }
  }

  throw lastError || new Error('Todas las estrategias de conexión fallaron');
}

/**
 * Test MikroTik native API login (v6 protocol on ports 8728/8729/8730+)
 * Returns true if login succeeds, throws on failure
 */
export function testNativeApiLogin(
  host: string,
  port: number,
  username: string,
  password: string,
  timeoutMs = 10000
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const useTls = port === 8729;
    let socket: Socket;
    let settled = false;
    let buffer = Buffer.alloc(0);

    const finish = (result: { success: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => finish({ success: false, error: 'Timeout de conexión API nativa' }), timeoutMs);

    const onConnect = () => {
      // Send login command: /login\0=name=user\0=password=pass\0\0
      const words = [`/login`, `=name=${username}`, `=password=${password}`];
      const chunks: Buffer[] = [];
      for (const word of words) {
        const wb = Buffer.from(word, 'utf-8');
        chunks.push(encodeLength(wb.length));
        chunks.push(wb);
      }
      chunks.push(Buffer.from([0])); // end of sentence
      socket.write(Buffer.concat(chunks));
    };

    const onData = (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      // Look for !done or !trap in the response
      const str = buffer.toString('utf-8');
      if (str.includes('!done')) {
        clearTimeout(timer);
        finish({ success: true });
      } else if (str.includes('!trap')) {
        clearTimeout(timer);
        const msgMatch = str.match(/=message=([^\x00]+)/);
        finish({ success: false, error: msgMatch ? msgMatch[1] : 'Login rechazado por el router' });
      }
    };

    const onError = (err: Error) => {
      clearTimeout(timer);
      finish({ success: false, error: err.message });
    };

    if (useTls) {
      socket = tls.connect({ host, port, rejectUnauthorized: false }, onConnect);
    } else {
      socket = new Socket();
      socket.connect(port, host, onConnect);
    }

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('timeout', () => { clearTimeout(timer); finish({ success: false, error: 'Socket timeout' }); });
    socket.setTimeout(timeoutMs);
  });
}

/** Encode MikroTik API word length prefix */
function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) return Buffer.from([0x80 | (len >> 8), len & 0xff]);
  if (len < 0x200000) return Buffer.from([0xc0 | (len >> 16), (len >> 8) & 0xff, len & 0xff]);
  if (len < 0x10000000) return Buffer.from([0xe0 | (len >> 24), (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  return Buffer.from([0xf0, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

/** Check if a port is likely a native MikroTik API port */
export function isNativeApiPort(port: number): boolean {
  return port === 8728 || port === 8729 || (port >= 8730 && port <= 8799);
}

function normalizeStringParam(value: string | string[] | undefined, paramName: string): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  throw new Error(`Parámetro inválido: ${paramName}`);
}

export async function getDeviceConfig(pool: any, mikrotikIdParam: string | string[]): Promise<MikroTikConfig> {
  const mikrotikId = normalizeStringParam(mikrotikIdParam, 'mikrotikId');

  const { rows } = await pool.query(
    'SELECT host, port, username, password FROM mikrotik_devices WHERE id = $1',
    [mikrotikId]
  );

  if (!rows[0]) throw new Error('Dispositivo no encontrado');

  return {
    host: rows[0].host,
    port: rows[0].port,
    username: rows[0].username,
    password: rows[0].password,
  };
}
