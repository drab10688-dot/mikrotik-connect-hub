/**
 * MikroTik REST API Client
 * Supports RouterOS v7 REST API and v6 via API bridge
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
  const timeout = setTimeout(() => controller.abort(), 10000);
  options.signal = controller.signal;

  try {
    const response = await fetch(url, options);
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MikroTik HTTP ${response.status}: ${text}`);
    }

    return await response.json();
  } catch (error: unknown) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('MikroTik connection timeout');
    }
    throw error;
  }
}

export async function getDeviceConfig(pool: any, mikrotikId: string): Promise<MikroTikConfig> {
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
