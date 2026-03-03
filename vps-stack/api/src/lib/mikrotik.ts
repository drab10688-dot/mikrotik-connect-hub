/**
 * MikroTik REST API Client
 * Supports RouterOS v7 REST API and v6 via API bridge
 * Handles both HTTPS (443) and HTTP (80/8728) connections
 */

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
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
  options.signal = controller.signal;

  // For self-signed certs on MikroTik
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
    // Some endpoints return empty or non-json
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
 * Try multiple connection strategies for MikroTik
 * 1) HTTPS on configured port
 * 2) HTTP on configured port (if not 443)
 * 3) HTTP on port 80
 */
export async function mikrotikRequestWithFallback(
  config: MikroTikConfig,
  path: string,
  method: string = 'GET',
  body?: Record<string, unknown>
): Promise<{ data: unknown; usedConfig: { protocol: string; port: number } }> {
  const strategies: Array<{ useTls: boolean; port: number; label: string }> = [];

  // Primary: configured port with auto-TLS detection
  const primaryTls = config.port === 443 || config.port === 8729;
  strategies.push({ useTls: primaryTls, port: config.port, label: `${primaryTls ? 'HTTPS' : 'HTTP'}:${config.port}` });

  // If primary is HTTPS, also try HTTP on same port
  if (primaryTls) {
    strategies.push({ useTls: false, port: config.port, label: `HTTP:${config.port}` });
  }

  // Try HTTP on port 80 if not already tried
  if (config.port !== 80) {
    strategies.push({ useTls: false, port: 80, label: 'HTTP:80' });
  }

  let lastError: Error | null = null;

  for (const strategy of strategies) {
    try {
      const data = await mikrotikRequest(
        { ...config, port: strategy.port, useTls: strategy.useTls },
        path,
        method,
        body
      );
      return {
        data,
        usedConfig: { protocol: strategy.useTls ? 'https' : 'http', port: strategy.port },
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // If credentials error, don't try other strategies
      const msg = lastError.message.toLowerCase();
      if (msg.includes('401') || msg.includes('403')) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error('Todas las estrategias de conexión fallaron');
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
