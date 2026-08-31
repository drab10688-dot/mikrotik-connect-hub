import http from 'http';
import https from 'https';

/**
 * Lectura de calidad de señal directamente desde cada AP (MikroTik, Ubiquiti airOS,
 * y equipos con API compatible), útil cuando los APs están detrás del router por
 * cable y el MikroTik principal no ve a los clientes wireless.
 */

export interface ApTarget {
  ip: string;
  brand: string;
  port: number;
  protocol: 'http' | 'https';
  username?: string | null;
  password?: string | null;
}

export interface ApClient {
  mac: string | null;
  name: string | null;
  signal: number | null;      // dBm
  noise: number | null;       // dBm
  snr: number | null;         // dB
  ccq: number | null;         // %
  tx_rate: string | null;
  rx_rate: string | null;
  tx_bytes: number | null;
  rx_bytes: number | null;
  uptime: string | null;
  distance: string | null;
  quality: 'excelente' | 'buena' | 'regular' | 'mala' | 'desconocida';
}

interface RawResponse {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

function endpoint(target: Pick<ApTarget, 'ip' | 'port' | 'protocol'>): string {
  return `${target.protocol}://${target.ip}:${target.port}`;
}

function isTransportError(message: string): boolean {
  return /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|tiempo de espera|socket hang up|ECONNRESET|TLS|SSL|wrong version/i.test(message);
}

function request(
  target: Pick<ApTarget, 'ip' | 'port' | 'protocol'>,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number } = {}
): Promise<RawResponse> {
  const client = target.protocol === 'https' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        host: target.ip,
        port: target.port,
        path,
        method: options.method || 'GET',
        headers: options.headers,
        rejectUnauthorized: false,
        timeout: options.timeout ?? 8000,
      } as any,
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () =>
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers })
        );
      }
    );
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado')));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function num(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function signalQuality(signal: number | null, snr: number | null): ApClient['quality'] {
  if (signal === null && snr === null) return 'desconocida';
  const s = signal ?? -100;
  const n = snr ?? 0;
  if (s >= -65 && n >= 25) return 'excelente';
  if (s >= -75 && n >= 18) return 'buena';
  if (s >= -83) return 'regular';
  return 'mala';
}

function finalize(partial: Partial<ApClient>): ApClient {
  const signal = partial.signal ?? null;
  const snr = partial.snr ?? (signal !== null && partial.noise != null ? Math.round(signal - partial.noise) : null);
  return {
    mac: partial.mac ?? null,
    name: partial.name ?? null,
    signal,
    noise: partial.noise ?? null,
    snr,
    ccq: partial.ccq ?? null,
    tx_rate: partial.tx_rate ?? null,
    rx_rate: partial.rx_rate ?? null,
    tx_bytes: partial.tx_bytes ?? null,
    rx_bytes: partial.rx_bytes ?? null,
    uptime: partial.uptime ?? null,
    distance: partial.distance ?? null,
    quality: signalQuality(signal, snr),
  };
}

// ── MikroTik (RouterOS v7 REST: wireless o wifi) ─────────────────
async function readMikrotik(target: ApTarget): Promise<ApClient[]> {
  const auth = 'Basic ' + Buffer.from(`${target.username || 'admin'}:${target.password || ''}`).toString('base64');
  const paths = [
    '/rest/interface/wireless/registration-table',
    '/rest/interface/wifi/registration-table',
    '/rest/interface/wifiwave2/registration-table',
  ];

  let lastError = 'El AP no respondió';
  for (const path of paths) {
    try {
      const res = await request(target, path, { headers: { Authorization: auth, Accept: 'application/json' } });
      if (res.status === 401) throw new Error('Credenciales inválidas en el AP');
      if (res.status >= 400) { lastError = `HTTP ${res.status} en ${path}`; continue; }
      const parsed = JSON.parse(res.body);
      if (!Array.isArray(parsed)) { lastError = 'Respuesta inesperada del AP'; continue; }
      return parsed.map((r: any) => {
        const [txBytes, rxBytes] = String(r.bytes || '0,0').split(',');
        const [txRate, rxRate] = String(r['tx-rate'] ? `${r['tx-rate']},${r['rx-rate'] || ''}` : r.rate || ',').split(',');
        return finalize({
          mac: r['mac-address'] || null,
          name: r.comment || r['last-ip'] || r.interface || null,
          signal: num(r['signal-strength'] ?? r.signal),
          noise: num(r['noise-floor']),
          snr: num(r['signal-to-noise']),
          ccq: num(r['tx-ccq'] ?? r.ccq),
          tx_rate: txRate || null,
          rx_rate: rxRate || null,
          tx_bytes: num(txBytes),
          rx_bytes: num(rxBytes),
          uptime: r.uptime || null,
          distance: r.distance || null,
        });
      });
    } catch (error: any) {
      lastError = error.message;
    }
  }
  throw new Error(lastError);
}

// ── Ubiquiti airOS (login.cgi + status.cgi) ──────────────────────
function mergeCookies(prev: string, res: RawResponse): string {
  const jar = new Map<string, string>();
  for (const part of prev.split('; ').filter(Boolean)) {
    const [k, ...v] = part.split('=');
    jar.set(k, v.join('='));
  }
  const setCookie = ([] as string[]).concat((res.headers['set-cookie'] as any) || []);
  for (const c of setCookie) {
    const [k, ...v] = c.split(';')[0].split('=');
    if (k) jar.set(k.trim(), v.join('='));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function parseUbiquitiStatus(data: any): ApClient[] {
  const noise = num(data?.wireless?.noisef);
  const stations: any[] = data?.wireless?.sta || data?.sta || [];
  return stations.map((s: any) => {
    const signal = num(s.signal);
    return finalize({
      mac: s.mac || null,
      name: s.name || s.hostname || s.lastip || null,
      signal,
      noise: num(s.noisefloor ?? noise),
      snr: num(s.snr ?? (signal !== null && noise !== null ? signal - noise : null)),
      ccq: num(s.airmax?.quality ?? s.ccq),
      tx_rate: s.tx ? `${s.tx} Mbps` : null,
      rx_rate: s.rx ? `${s.rx} Mbps` : null,
      tx_bytes: num(s.stats?.tx_bytes),
      rx_bytes: num(s.stats?.rx_bytes),
      uptime: s.uptime ? `${s.uptime}s` : null,
      distance: s.distance ? `${s.distance} m` : null,
    });
  });
}

async function readUbiquiti(target: ApTarget): Promise<ApClient[]> {
  const username = target.username || 'ubnt';
  const password = target.password || '';
  const origin = endpoint(target);
  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  };

  // 1) Sesión inicial: airOS exige una cookie AIROS_SESSIONID previa al login.
  let cookie = '';
  let csrfToken = '';
  try {
    const seed = await request(target, '/login.cgi', { headers: commonHeaders });
    cookie = mergeCookies('', seed);
    csrfToken = seed.body.match(/(?:csrf_token|csrfToken)["']?\s*(?:value=|:|=)\s*["']([^"']+)/i)?.[1] || '';
  } catch (error: any) {
    if (isTransportError(error?.message || '')) {
      throw new Error(`No conecta con airOS en ${endpoint(target)}: ${error.message}`);
    }
    // Algunos modelos no exponen /login.cgi por GET.
  }
  if (!cookie.includes('AIROS_SESSIONID')) {
    cookie = [cookie, 'AIROS_SESSIONID=' + '0'.repeat(32)].filter(Boolean).join('; ');
  }

  // 2) Login clásico (airOS 5/6/8)
  const login = await request(target, '/login.cgi', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
      Referer: `${origin}/login.cgi`,
      Origin: origin,
      'User-Agent': commonHeaders['User-Agent'],
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: new URLSearchParams({ username, password, uri: '/index.cgi', ...(csrfToken ? { csrf_token: csrfToken } : {}) }).toString(),
  }).catch((e) => { throw new Error(`No se pudo iniciar sesión en airOS en ${endpoint(target)}: ${e.message}`); });
  cookie = mergeCookies(cookie, login);

  if (login.status === 401 || login.status === 403) {
    throw new Error(`airOS rechazó las credenciales en ${endpoint(target)}`);
  }
  if (login.status >= 400) {
    throw new Error(`airOS respondió HTTP ${login.status} al iniciar sesión en ${endpoint(target)}`);
  }

  // 3) Lectura de estado; si devuelve HTML el login no fue aceptado.
  const paths = ['/status.cgi', '/sta.cgi', '/iflist.cgi?ifname=ath0'];
  let lastError = 'airOS no devolvió datos';
  for (const path of paths) {
    try {
      const res = await request(target, path, {
        headers: {
          Cookie: cookie,
          Referer: `${origin}/index.cgi`,
          Accept: 'application/json',
          'User-Agent': commonHeaders['User-Agent'],
          'X-Requested-With': 'XMLHttpRequest',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
      });
      if (res.status === 401 || res.status === 403) { lastError = 'Credenciales rechazadas por el AP'; continue; }
      if (res.status >= 400) { lastError = `airOS respondió HTTP ${res.status}`; continue; }
      const body = res.body.trim();
      if (!body.startsWith('{') && !body.startsWith('[')) {
        lastError = 'El AP devolvió su página de login (usuario o contraseña incorrectos)';
        continue;
      }
      const data = JSON.parse(body);
      const clients = parseUbiquitiStatus(data);
      if (clients.length || data?.wireless) return clients;
      lastError = 'El AP no reporta clientes wireless';
    } catch (error: any) {
      lastError = error?.message || String(error);
    }
  }
  throw new Error(lastError);
}

async function readOne(target: ApTarget): Promise<ApClient[]> {
  switch (target.brand) {
    case 'ubiquiti':
      return readUbiquiti(target);
    case 'mikrotik':
      return readMikrotik(target);
    default:
      try {
        return await readMikrotik(target);
      } catch {
        return readUbiquiti(target);
      }
  }
}

export async function readApClients(target: ApTarget): Promise<ApClient[]> {
  // Prueba el transporte configurado y luego los habituales: muchos APs
  // responden la API sólo por HTTP aunque su panel esté en HTTPS.
  const seen = new Set<string>();
  const transports: Array<{ port: number; protocol: 'http' | 'https' }> = [];
  const push = (port: number, protocol: 'http' | 'https') => {
    const key = `${protocol}:${port}`;
    if (seen.has(key)) return;
    seen.add(key);
    transports.push({ port, protocol });
  };
  push(target.port, target.protocol);
  push(80, 'http');
  push(443, 'https');
  push(8080, 'http');

  let configuredError = '';
  const attempts: string[] = [];
  for (const t of transports) {
    try {
      return await readOne({ ...target, ...t });
    } catch (error: any) {
      const message = error?.message || String(error);
      attempts.push(`${t.protocol}:${t.port} — ${message}`);
      if (t.port === target.port && t.protocol === target.protocol) configuredError = message;

      // Si el puerto elegido sí respondió pero rechazó la sesión o sus datos,
      // no ocultar ese diagnóstico probando después un 8080 que está cerrado.
      if (!isTransportError(message)) throw new Error(message);
    }
  }
  throw new Error(
    configuredError
      ? `${configuredError}. Intentos: ${attempts.join('; ')}`
      : `El AP no respondió. Intentos: ${attempts.join('; ')}`
  );
}

