/**
 * MikroTik REST API Client + Native API v6 support
 * Supports RouterOS v7 REST API and v6 via native binary protocol
 */
import { Socket } from 'net';
import * as tls from 'tls';
import * as crypto from 'crypto';

interface MikroTikConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  useTls?: boolean;
}

function normalizePort(port: number | string): number {
  const normalized = typeof port === 'string' ? Number(port) : port;
  if (!Number.isFinite(normalized)) {
    throw new Error(`Puerto de MikroTik inválido: ${String(port)}`);
  }
  return normalized;
}

type NativeAuthMode = 'plain' | 'challenge-first';

async function tryNativeApiWithFallback(
  config: MikroTikConfig,
  path: string,
  method: string = 'GET',
  body?: Record<string, unknown>
): Promise<unknown> {
  const port = normalizePort(config.port);
  const tlsCandidates: boolean[] = [];

  if (typeof config.useTls === 'boolean') tlsCandidates.push(config.useTls);
  if (!tlsCandidates.includes(port === 8729)) tlsCandidates.push(port === 8729);
  if (!tlsCandidates.includes(false)) tlsCandidates.push(false);
  if (!tlsCandidates.includes(true)) tlsCandidates.push(true);

  const authModes: NativeAuthMode[] = ['plain', 'challenge-first'];

  let lastError: Error | null = null;

  for (const authMode of authModes) {
    for (const useTls of tlsCandidates) {
      try {
        return await nativeApiCommand({ ...config, port, useTls }, path, method, body, authMode, 7000);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  throw lastError || new Error('No fue posible conectar por API nativa MikroTik');
}

// ─── REST API Client ─────────────────────────────────────

export async function mikrotikRequest(
  config: MikroTikConfig,
  path: string,
  method: string = 'GET',
  body?: Record<string, unknown>
): Promise<unknown> {
  const port = normalizePort(config.port);
  const normalizedConfig: MikroTikConfig = { ...config, port };

  // If port is native API, prioritize native client with TLS/plain fallback.
  if (isNativeApiPort(port)) {
    return tryNativeApiWithFallback(normalizedConfig, path, method, body);
  }

  const useTls = normalizedConfig.useTls ?? (port === 443 || port === 8729);
  const protocol = useTls ? 'https' : 'http';
  const url = `${protocol}://${normalizedConfig.host}:${port}${path}`;
  const authString = Buffer.from(`${normalizedConfig.username}:${normalizedConfig.password}`).toString('base64');

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

// ─── Native Binary API Client (v6/v6.x/v7 API port) ─────

/**
 * Convert a REST API path to native API command
 * e.g. /rest/system/resource -> /system/resource/print
 * e.g. /rest/interface -> /interface/print
 * e.g. /rest/ip/hotspot/active -> /ip/hotspot/active/print
 */
function restPathToNativeCommand(path: string, method: string): string {
  // Strip /rest prefix
  let cmd = path.replace(/^\/rest/, '');
  
  // Map HTTP methods to API actions
  if (method === 'GET' || method === 'get') {
    // GET = print
    if (!cmd.endsWith('/print')) cmd += '/print';
  } else if (method === 'POST' || method === 'post') {
    // POST with body usually = add
    if (!cmd.endsWith('/add') && !cmd.endsWith('/set') && !cmd.endsWith('/remove')) {
      cmd += '/add';
    }
  } else if (method === 'PUT' || method === 'put' || method === 'PATCH') {
    if (!cmd.endsWith('/set')) cmd += '/set';
  } else if (method === 'DELETE' || method === 'delete') {
    if (!cmd.endsWith('/remove')) cmd += '/remove';
  }
  
  return cmd;
}

/**
 * Convert REST API body to native API attribute words
 * e.g. { name: "test", password: "123" } -> ["=name=test", "=password=123"]
 */
function bodyToApiWords(body?: Record<string, unknown>): string[] {
  if (!body) return [];
  const words: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null) {
      // Convert camelCase to kebab-case for MikroTik
      const apiKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      words.push(`=${apiKey}=${String(value)}`);
    }
  }
  return words;
}

/**
 * Execute a command via native MikroTik API protocol
 * Automatically converts REST-style paths to native commands
 */
export async function nativeApiCommand(
  config: MikroTikConfig,
  path: string,
  method: string = 'GET',
  body?: Record<string, unknown>,
  authMode: NativeAuthMode = 'plain',
  timeoutMs = 15000
): Promise<unknown> {
  const command = restPathToNativeCommand(path, method);
  const attrWords = bodyToApiWords(body);
  
  const sentences = await nativeApiExecute(config, command, attrWords, timeoutMs, authMode);
  
  // Parse response sentences into objects
  const results: Record<string, string>[] = [];
  for (const sentence of sentences) {
    if (sentence.type === '!re') {
      results.push(sentence.attrs);
    } else if (sentence.type === '!trap') {
      const msg = sentence.attrs['message'] || 'Unknown error';
      throw new Error(`MikroTik API error: ${msg}`);
    }
  }
  
  return results;
}

interface ApiSentence {
  type: string; // !re, !done, !trap, !fatal
  attrs: Record<string, string>;
}

/**
 * Low-level native API execution
 */
function nativeApiExecute(
  config: MikroTikConfig,
  command: string,
  extraWords: string[] = [],
  timeoutMs = 15000,
  authMode: NativeAuthMode = 'plain'
): Promise<ApiSentence[]> {
  return new Promise((resolve, reject) => {
    const useTls = config.useTls ?? config.port === 8729;
    let socket: Socket;
    let settled = false;
    let buffer = Buffer.alloc(0);
    let loginDone = false;
    let challengeRequested = false;
    let plainFallbackSent = false;
    const sentences: ApiSentence[] = [];

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      if (err) reject(err);
      else resolve(sentences);
    };

    const timer = setTimeout(() => finish(new Error('MikroTik API timeout')), timeoutMs);

    const sendSentence = (words: string[]) => {
      const chunks: Buffer[] = [];
      for (const word of words) {
        const wb = Buffer.from(word, 'utf-8');
        chunks.push(encodeLength(wb.length));
        chunks.push(wb);
      }
      chunks.push(Buffer.from([0])); // end of sentence
      socket.write(Buffer.concat(chunks));
    };

    const sendLogin = () => {
      if (authMode === 'challenge-first') {
        sendSentence(['/login']);
        return;
      }
      sendSentence(['/login', `=name=${config.username}`, `=password=${config.password}`]);
    };

    const sendLoginChallenge = (challenge: string) => {
      // MD5 challenge-response for older RouterOS
      const challengeBuf = Buffer.from(challenge, 'hex');
      const hash = crypto.createHash('md5');
      hash.update(Buffer.from([0]));
      hash.update(Buffer.from(config.password, 'utf-8'));
      hash.update(challengeBuf);
      const response = '00' + hash.digest('hex');
      sendSentence(['/login', `=name=${config.username}`, `=response=${response}`]);
    };

    const sendPlainLogin = () => {
      sendSentence(['/login', `=name=${config.username}`, `=password=${config.password}`]);
    };

    const sendCommand = () => {
      sendSentence([command, ...extraWords]);
    };

    const processBuffer = () => {
      while (buffer.length > 0) {
        const result = tryReadSentence();
        if (!result) break;

        const { sentence, bytesConsumed } = result;
        buffer = buffer.slice(bytesConsumed);

        if (!loginDone) {
          // Handle login response
          if (sentence.type === '!done') {
            const challenge = sentence.attrs['ret'];

            if (challenge) {
              challengeRequested = true;
              sendLoginChallenge(challenge);
              continue;
            }

            // Some routers may not return challenge when doing /login only.
            // Fall back to plain credentials once.
            if (authMode === 'challenge-first' && !plainFallbackSent && !challengeRequested) {
              plainFallbackSent = true;
              sendPlainLogin();
              continue;
            }

            // Login successful, send actual command
            loginDone = true;
            sendCommand();
          } else if (sentence.type === '!trap' || sentence.type === '!fatal') {
            const message = sentence.attrs['message'] || 'unknown';
            finish(new Error(`Login failed (${authMode}): ${message}`));
            return;
          }
        } else {
          // Command response
          if (sentence.type === '!re') {
            sentences.push(sentence);
          } else if (sentence.type === '!done') {
            finish();
            return;
          } else if (sentence.type === '!trap') {
            sentences.push(sentence);
            // Don't finish yet - wait for !done
          } else if (sentence.type === '!fatal') {
            finish(new Error(`Fatal: ${sentence.attrs['message'] || 'unknown'}`));
            return;
          }
        }
      }
    };

    const tryReadSentence = (): { sentence: ApiSentence; bytesConsumed: number } | null => {
      let offset = 0;
      const words: string[] = [];

      while (offset < buffer.length) {
        const lenResult = decodeLength(buffer, offset);
        if (!lenResult) return null; // incomplete
        
        const { length: wordLen, bytesRead } = lenResult;
        offset += bytesRead;

        if (wordLen === 0) {
          // End of sentence
          if (words.length === 0) continue;
          
          const type = words[0];
          const attrs: Record<string, string> = {};
          for (let i = 1; i < words.length; i++) {
            const w = words[i];
            if (w.startsWith('=')) {
              const eqIdx = w.indexOf('=', 1);
              if (eqIdx > 0) {
                attrs[w.substring(1, eqIdx)] = w.substring(eqIdx + 1);
              }
            }
          }
          return { sentence: { type, attrs }, bytesConsumed: offset };
        }

        if (offset + wordLen > buffer.length) return null; // incomplete
        
        words.push(buffer.slice(offset, offset + wordLen).toString('utf-8'));
        offset += wordLen;
      }

      return null; // incomplete
    };

    const onConnect = () => {
      sendLogin();
    };

    const onData = (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      processBuffer();
    };

    const onError = (err: Error) => {
      finish(err);
    };

    if (useTls) {
      socket = tls.connect({ host: config.host, port: config.port, rejectUnauthorized: false }, onConnect);
    } else {
      socket = new Socket();
      socket.connect(config.port, config.host, onConnect);
    }

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('timeout', () => {
      finish(new Error(`MikroTik API socket timeout (${authMode})`));
    });
    socket.on('close', () => {
      if (!settled) finish(new Error('Connection closed'));
    });
    socket.setTimeout(timeoutMs);
  });
}

// ─── Encoding/Decoding helpers ───────────────────────────

/** Encode MikroTik API word length prefix */
function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) return Buffer.from([0x80 | (len >> 8), len & 0xff]);
  if (len < 0x200000) return Buffer.from([0xc0 | (len >> 16), (len >> 8) & 0xff, len & 0xff]);
  if (len < 0x10000000) return Buffer.from([0xe0 | (len >> 24), (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  return Buffer.from([0xf0, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

/** Decode MikroTik API word length prefix */
function decodeLength(buf: Buffer, offset: number): { length: number; bytesRead: number } | null {
  if (offset >= buf.length) return null;
  
  const b = buf[offset];
  
  if ((b & 0x80) === 0) {
    return { length: b, bytesRead: 1 };
  }
  
  if ((b & 0xc0) === 0x80) {
    if (offset + 1 >= buf.length) return null;
    return { length: ((b & 0x3f) << 8) | buf[offset + 1], bytesRead: 2 };
  }
  
  if ((b & 0xe0) === 0xc0) {
    if (offset + 2 >= buf.length) return null;
    return { length: ((b & 0x1f) << 16) | (buf[offset + 1] << 8) | buf[offset + 2], bytesRead: 3 };
  }
  
  if ((b & 0xf0) === 0xe0) {
    if (offset + 3 >= buf.length) return null;
    return { length: ((b & 0x0f) << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3], bytesRead: 4 };
  }
  
  if (offset + 4 >= buf.length) return null;
  return { length: (buf[offset + 1] << 24) | (buf[offset + 2] << 16) | (buf[offset + 3] << 8) | buf[offset + 4], bytesRead: 5 };
}

// ─── Utility functions ──────────────────────────────────

/**
 * Test MikroTik native API login (v6 protocol on ports 8728/8729/8730+)
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
      const words = [`/login`, `=name=${username}`, `=password=${password}`];
      const chunks: Buffer[] = [];
      for (const word of words) {
        const wb = Buffer.from(word, 'utf-8');
        chunks.push(encodeLength(wb.length));
        chunks.push(wb);
      }
      chunks.push(Buffer.from([0]));
      socket.write(Buffer.concat(chunks));
    };

    const onData = (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
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

/** Check if a port is likely a native MikroTik API port */
export function isNativeApiPort(port: number | string): boolean {
  const normalizedPort = typeof port === 'string' ? Number(port) : port;
  return Number.isFinite(normalizedPort)
    && (normalizedPort === 8728 || normalizedPort === 8729 || (normalizedPort >= 8730 && normalizedPort <= 8799));
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

  const port = normalizePort(rows[0].port);

  return {
    host: rows[0].host,
    port,
    username: rows[0].username,
    password: rows[0].password,
  };
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
  // If native port, use native API directly
  if (isNativeApiPort(config.port)) {
    const data = await tryNativeApiWithFallback(config, path, method, body);
    return { data, usedConfig: { protocol: 'native-api', port: normalizePort(config.port) } };
  }

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
