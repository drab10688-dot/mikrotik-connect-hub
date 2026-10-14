import { pool } from './db';
import { mikrotikRequest, getDeviceConfig } from './mikrotik';

type MikroTikConfig = Parameters<typeof mikrotikRequest>[0];
import { sshRun } from './cpe-ssh';
import { HEALTH_CMD } from './cpe-health';
import { notifyTelegram } from './net-monitor';
import { ensureApRoute, apLoginFor, savedApsOf } from '../routes/netaccess';

/**
 * Monitor de puertos (cada 5 min): puertos Ethernet de la MikroTik de cada
 * sede y de los APs guardados en el mapa (MikroTik por API, Ubiquiti por SSH).
 * Detecta lo que limita a los clientes sin que nadie lo note:
 *  - slow: puerto Gigabit enlazado a 100/10 Mbps (cable de 4 hilos, conector,
 *    inyector PoE o puerto del otro lado de 10/100);
 *  - half: half-duplex;
 *  - saturated: tráfico ≥ 85 % de la velocidad del enlace.
 * Solo lee. Avisa por Telegram si el problema sigue en 2 revisiones (10 min),
 * una vez, y otra al normalizarse.
 */

export type PortProblem = 'slow' | 'half' | 'saturated';
const STREAK_PORT = 2;
const SATURATION = 0.85;

export interface PortReading {
  kind: 'router' | 'ap';
  device: string;
  ip: string;
  port: string;
  rate_mbps: number | null;
  full: boolean | null;
  gigabit: boolean | null;
  rx_bps: number | null;
  tx_bps: number | null;
  problem: PortProblem | null;
  detail: string | null;
}

const asArray = (d: unknown): any[] => (Array.isArray(d) ? d : d ? [d] : []);
const truthy = (v: unknown) => v === true || v === 'true' || v === 'yes';

/** "100Mbps" / "1Gbps" / "10G-baseSR" -> Mbps */
function rateMbps(v: unknown): number | null {
  const m = String(v ?? '').match(/(\d+(?:\.\d+)?)\s*([GM])/i);
  return m ? Math.round(Number(m[1]) * (m[2].toUpperCase() === 'G' ? 1000 : 1)) : null;
}

function judge(r: Omit<PortReading, 'problem' | 'detail'>): { problem: PortProblem | null; detail: string | null } {
  const use = r.rate_mbps && (r.rx_bps != null || r.tx_bps != null)
    ? Math.max(r.rx_bps || 0, r.tx_bps || 0) / 1e6 / r.rate_mbps
    : null;
  if (r.gigabit && r.rate_mbps != null && r.rate_mbps <= 100) {
    const extra = use != null && use >= SATURATION ? ` y al ${Math.round(use * 100)} % de uso (topado)` : '';
    return { problem: 'slow', detail: `${r.port} a ${r.rate_mbps} Mbps aunque es Gigabit${extra}: revisar cable (8 hilos), conectores, inyector PoE o el puerto del otro lado` };
  }
  if (r.full === false) return { problem: 'half', detail: `${r.port} en half-duplex: revisar cable o la negociación del otro lado` };
  if (use != null && use >= SATURATION) {
    return { problem: 'saturated', detail: `${r.port} al ${Math.round(use * 100)} % (${Math.round(Math.max(r.rx_bps || 0, r.tx_bps || 0) / 1e6)} de ${r.rate_mbps} Mbps): enlace topado` };
  }
  return { problem: null, detail: null };
}

/** Puertos Ethernet con enlace de una MikroTik (router de sede o AP) por su API. */
async function readMikrotikPorts(cfg: MikroTikConfig, kind: 'router' | 'ap', device: string, ip: string): Promise<PortReading[]> {
  const [ifs, eths] = await Promise.all([
    mikrotikRequest(cfg, '/rest/interface'),
    mikrotikRequest(cfg, '/rest/interface/ethernet').catch(() => []),
  ]);
  const up = asArray(ifs).filter((i: any) => i.type === 'ether' && truthy(i.running) && !truthy(i.disabled));
  if (!up.length) return [];
  const names = up.map((i: any) => String(i.name));
  const [mon, traffic] = await Promise.all([
    mikrotikRequest(cfg, '/rest/interface/ethernet/monitor', 'POST', { numbers: names.join(','), once: '' }).catch(() => []),
    mikrotikRequest(cfg, '/rest/interface/monitor-traffic', 'POST', { interface: names.join(','), once: '' }).catch(() => []),
  ]);
  const by = (rows: unknown) => new Map<string, any>(asArray(rows).map((r: any) => [String(r.name), r]));
  const ethBy = by(eths), monBy = by(mon), trBy = by(traffic);
  return names.map((name) => {
    const e = ethBy.get(name) || {};
    const m = monBy.get(name) || {};
    const t = trBy.get(name) || {};
    const adv = String(e.advertise || '');
    const base = {
      kind, device, ip, port: name,
      rate_mbps: rateMbps(m.rate),
      full: m['full-duplex'] !== undefined ? truthy(m['full-duplex']) : null,
      // Gigabit si lo anuncia (v6 "1000M-full", v7 "1G-baseT-full") o si ya enlaza a ≥1G
      gigabit: adv ? /1000M|[125]\.?5?G|10G/i.test(adv) : null,
      rx_bps: t['rx-bits-per-second'] != null ? Number(t['rx-bits-per-second']) : null,
      tx_bps: t['tx-bits-per-second'] != null ? Number(t['tx-bits-per-second']) : null,
    };
    return { ...base, ...judge(base) };
  });
}

/** AP Ubiquiti por SSH: velocidad y dúplex del puerto (sin uso; airMAX M suele ser 10/100). */
async function readUbiquitiPorts(login: { username: string; password: string; port: number }, device: string, ip: string): Promise<PortReading[]> {
  const out = await sshRun(ip, login, HEALTH_CMD.ubiquiti, 15_000);
  return out.split(/\r?\n/).filter((l) => l.startsWith('ETH|')).map((l) => {
    const [, iface, carrier, speed, duplex] = l.split('|');
    if (carrier !== '1') return null;
    const base = {
      kind: 'ap' as const, device, ip, port: iface,
      rate_mbps: Number(speed) > 0 ? Number(speed) : null,
      full: duplex ? duplex === 'full' : null,
      gigabit: null, rx_bps: null, tx_bps: null,
    };
    return { ...base, ...judge(base) };
  }).filter(Boolean) as PortReading[];
}

async function readSede(d: any): Promise<PortReading[]> {
  const out: PortReading[] = [];
  try {
    const cfg = await getDeviceConfig(pool, d.id);
    out.push(...await readMikrotikPorts(cfg, 'router', String(d.name), String(d.host)));
  } catch { /* el monitor de ping ya avisa si el router no responde */ }

  // APs guardados de ESTA sede (los sin sede podrían desviar la ruta a otro túnel)
  const aps = (await savedApsOf(d.tenant_id, d.id)).filter((a: any) => a.mikrotik_id === d.id);
  for (const ap of aps) {
    const login = apLoginFor(d.tenant_id, ap.ip) || (ap.username ? { username: ap.username, password: ap.password || '', sshPort: ap.ssh_port || 22 } : null);
    if (!login) continue;
    const name = String(ap.name || ap.ip);
    try {
      await ensureApRoute(d.id, d.tenant_id, ap.ip);
      if (ap.brand === 'mikrotik') {
        out.push(...await readMikrotikPorts({ host: ap.ip, port: 8728, username: login.username, password: login.password || '' }, 'ap', name, ap.ip));
      } else if (ap.brand === 'ubiquiti') {
        out.push(...await readUbiquitiPorts({ username: login.username, password: login.password || '', port: (login as any).sshPort || 22 }, name, ap.ip));
      }
    } catch { /* AP sin acceso por API/SSH: no se puede revisar su puerto */ }
  }
  return out;
}

const PROBLEM_ICON: Record<PortProblem, string> = { slow: '🟠', half: '🟠', saturated: '🔴' };

let running = false;

export async function runPortMonitor(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { rows: sedes } = await pool.query(
      `SELECT d.id, d.name, d.host, d.tenant_id, t.name AS tenant_name
         FROM mikrotik_devices d LEFT JOIN tenants t ON t.id = d.tenant_id
        WHERE d.status = 'active'::device_status AND COALESCE(t.is_active, true) = true AND COALESCE(t.enable_mikrotik, true) = true`
    );
    let next = 0;
    const worker = async () => {
      while (next < sedes.length) {
        const d = sedes[next++];
        const readings = await readSede(d).catch(() => [] as PortReading[]);
        for (const r of readings) {
          const { rows } = await pool.query(
            `SELECT problem, streak, alerted FROM net_port_state WHERE mikrotik_id = $1 AND ip = $2 AND port = $3`,
            [d.id, r.ip, r.port]
          );
          const prev = rows[0];
          const streak = prev && (prev.problem ?? null) === r.problem ? Number(prev.streak) + 1 : 1;
          let alerted: string | null = prev?.alerted ?? null;
          const isp = String(d.tenant_name || '').trim();
          const where = `<b>${r.device}</b> (${r.ip})${r.kind === 'ap' ? ` · AP de ${d.name}` : ''}${isp ? ` · ${isp}` : ''}`;
          if (streak === STREAK_PORT && r.problem && alerted !== r.problem) {
            await notifyTelegram(d.tenant_id, `${PROBLEM_ICON[r.problem]} ${where}: ${r.detail}`);
            alerted = r.problem;
          } else if (streak === STREAK_PORT && !r.problem && alerted) {
            await notifyTelegram(d.tenant_id, `🟢 ${where}: ${r.port} normal otra vez${r.rate_mbps ? ` (${r.rate_mbps} Mbps)` : ''}.`);
            alerted = null;
          }
          await pool.query(
            `INSERT INTO net_port_state (mikrotik_id, kind, device, ip, port, rate_mbps, full_duplex, gigabit, rx_bps, tx_bps, problem, detail, streak, alerted, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
             ON CONFLICT (mikrotik_id, ip, port) DO UPDATE SET kind = $2, device = $3, rate_mbps = $6, full_duplex = $7, gigabit = $8,
               rx_bps = $9, tx_bps = $10, problem = $11, detail = $12, streak = $13, alerted = $14, updated_at = now()`,
            [d.id, r.kind, r.device, r.ip, r.port, r.rate_mbps, r.full, r.gigabit, r.rx_bps, r.tx_bps, r.problem, r.detail, streak, alerted]
          ).catch((e) => console.warn(`[PUERTOS] ${d.name}: ${e.message}`));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, sedes.length) }, worker));
    // Puertos que ya no tienen enlace o equipos quitados: fuera tras 1 día
    await pool.query(`DELETE FROM net_port_state WHERE updated_at < now() - interval '1 day'`).catch(() => undefined);
  } finally {
    running = false;
  }
}
