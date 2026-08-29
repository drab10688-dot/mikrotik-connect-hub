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
async function readUbiquiti(target: ApTarget): Promise<ApClient[]> {
  const login = await request(target, '/login.cgi', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: 'AIROS_SESSIONID=0000000000000000000000000000000',
      Referer: `${target.protocol}://${target.ip}/login.cgi`,
    },
    body: new URLSearchParams({
      username: target.username || 'ubnt',
      password: target.password || 'ubnt',
      uri: '/status.cgi',
    }).toString(),
  }).catch((e) => { throw new Error(`No se pudo iniciar sesión en airOS: ${e.message}`); });

  const setCookie = ([] as string[]).concat((login.headers['set-cookie'] as any) || []);
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ') || 'AIROS_SESSIONID=0000000000000000000000000000000';

  const res = await request(target, '/status.cgi', { headers: { Cookie: cookie } });
  if (res.status >= 400) throw new Error(`airOS respondió HTTP ${res.status} (revisa usuario/contraseña)`);

  let data: any;
  try { data = JSON.parse(res.body); } catch { throw new Error('airOS no devolvió JSON (credenciales inválidas)'); }

  const stations: any[] = data?.wireless?.sta || [];
  return stations.map((s) =>
    finalize({
      mac: s.mac || null,
      name: s.name || s.hostname || s.lastip || null,
      signal: num(s.signal),
      noise: num(s.noisefloor ?? data?.wireless?.noisef),
      snr: num(s.signal != null && data?.wireless?.noisef != null ? s.signal - data.wireless.noisef : null),
      ccq: num(s.airmax?.quality ?? s.ccq),
      tx_rate: s.tx ? `${s.tx} Mbps` : null,
      rx_rate: s.rx ? `${s.rx} Mbps` : null,
      tx_bytes: num(s.stats?.tx_bytes),
      rx_bytes: num(s.stats?.rx_bytes),
      uptime: s.uptime ? `${s.uptime}s` : null,
      distance: s.distance ? `${s.distance} m` : null,
    })
  );
}

export async function readApClients(target: ApTarget): Promise<ApClient[]> {
  switch (target.brand) {
    case 'ubiquiti':
      return readUbiquiti(target);
    case 'mikrotik':
      return readMikrotik(target);
    default:
      // Intenta ambos: muchos CPEs OEM usan una u otra API.
      try {
        return await readMikrotik(target);
      } catch {
        return readUbiquiti(target);
      }
  }
}
