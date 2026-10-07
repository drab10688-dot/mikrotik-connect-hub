import { execFile } from 'child_process';
import { pool } from './db';
import { mikrotikRequest, getDeviceConfig } from './mikrotik';

/**
 * Monitor de red por MikroTik (cada minuto):
 *  - VPN: ping del VPS al router por su túnel (¿está vivo y llegable?).
 *  - Internet: ping desde el propio router a 8.8.8.8 (por su API): el
 *    internet real de la sede, separado de la latencia hasta el VPS.
 * Estado: ok | high (ping alto) | loss (pérdida) | no_internet | down.
 *
 * Alertas por Telegram por ISP (y del super admin, que recibe todas): solo
 * cuando un estado se mantiene STREAK_ALERT mediciones seguidas, una vez, y
 * otra al normalizarse. El umbral de ping alto se aplica al ping a internet:
 * la latencia VPS↔router depende de dónde está el VPS, no de la sede.
 */

const L2TP = process.env.L2TP_CONTAINER || 'omnisync-l2tp';
const INET_TARGET = process.env.MONITOR_PING_TARGET || '8.8.8.8';
export const STREAK_ALERT = 3;
const KEEP_DAYS = 7;

export type NetStatus = 'ok' | 'high' | 'loss' | 'no_internet' | 'down';

export const STATUS_LABEL: Record<NetStatus, string> = {
  ok: 'En línea',
  high: 'Ping alto',
  loss: 'Pérdida de paquetes',
  no_internet: 'Sin internet',
  down: 'No responde',
};

interface PingResult { rtt: number | null; loss: number }

// ─── Ping VPS → routers (todos a la vez, dentro de omnisync-l2tp) ──────
function pingFromVps(hosts: string[]): Promise<Map<string, PingResult>> {
  const safe = [...new Set(hosts.filter((h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h)))];
  const out = new Map<string, PingResult>();
  if (!safe.length) return Promise.resolve(out);
  const script = 'for h in "$@"; do ( r=$(ping -c 3 -W 2 "$h" 2>&1 | tail -2 | tr "\\n" " "); echo "$h|$r" ) & done; wait';
  return new Promise((resolve) => {
    execFile('docker', ['exec', L2TP, 'sh', '-c', script, 'sh', ...safe], { timeout: 30_000 }, (_err, stdout) => {
      for (const line of String(stdout || '').split('\n')) {
        const [host, rest = ''] = line.split('|');
        if (!host) continue;
        // busybox: "3 packets transmitted, 2 packets received, 33% packet loss round-trip min/avg/max = 1/2/3 ms"
        const loss = Number(rest.match(/(\d+(?:\.\d+)?)% packet loss/)?.[1] ?? 100);
        const avg = rest.match(/=\s*[\d.]+\/([\d.]+)\//)?.[1];
        out.set(host.trim(), { loss: Math.round(loss), rtt: avg ? Number(avg) : null });
      }
      for (const h of safe) if (!out.has(h)) out.set(h, { loss: 100, rtt: null });
      resolve(out);
    });
  });
}

/** "12ms", "12ms345us", "1s20ms" -> ms */
function durationMs(v: unknown): number | null {
  const s = String(v ?? '');
  if (!s) return null;
  let ms = 0;
  let hit = false;
  for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)(us|ms|s)/g)) {
    hit = true;
    ms += Number(n) * (u === 's' ? 1000 : u === 'ms' ? 1 : 0.001);
  }
  return hit ? Math.round(ms * 10) / 10 : null;
}

// ─── Ping del router a internet (por su API) ───────────────────────────
async function pingFromRouter(mikrotikId: string): Promise<PingResult | null> {
  try {
    const config = await getDeviceConfig(pool, mikrotikId);
    const rows = await mikrotikRequest(config, '/rest/ping', 'POST', { address: INET_TARGET, count: '3' });
    const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean) as any[];
    if (!list.length) return null;
    const last = list[list.length - 1];
    // Cada fila trae los totales acumulados (sent/received/packet-loss/avg-rtt)
    let loss = Number(last['packet-loss']);
    if (!Number.isFinite(loss)) {
      const replies = list.filter((r) => r.time && r.status !== 'timeout').length;
      loss = Math.round(((list.length - replies) / list.length) * 100);
    }
    let rtt = durationMs(last['avg-rtt']);
    if (rtt === null) {
      const times = list.map((r) => durationMs(r.time)).filter((t): t is number => t !== null);
      rtt = times.length ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10 : null;
    }
    return { rtt: loss >= 100 ? null : rtt, loss };
  } catch {
    return null; // API sin respuesta: se juzga solo con el ping de la VPN
  }
}

// ─── Ajustes y Telegram ────────────────────────────────────────────────
export interface MonitorSettings {
  tenant_id: string | null;
  enabled: boolean;
  telegram_token: string | null;
  telegram_chat: string | null;
  rtt_ms: number;
  loss_pct: number;
}

const DEFAULTS = { rtt_ms: 150, loss_pct: 20 };

async function loadAllSettings(): Promise<MonitorSettings[]> {
  const { rows } = await pool.query(`SELECT * FROM monitor_settings`).catch(() => ({ rows: [] as any[] }));
  return rows;
}

export async function sendTelegram(token: string, chat: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) throw new Error(data?.description || `Telegram respondió ${res.status}`);
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

function fmtSince(since: Date): string {
  const min = Math.max(1, Math.round((Date.now() - since.getTime()) / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

// ─── Ciclo ─────────────────────────────────────────────────────────────
let running = false;
let lastPrune = 0;

function judge(vpn: PingResult, inet: PingResult | null, s: { rtt_ms: number; loss_pct: number }): NetStatus {
  if (vpn.loss >= 100) return 'down';
  if (inet && inet.loss >= 100) return 'no_internet';
  if (vpn.loss >= s.loss_pct || (inet && inet.loss >= s.loss_pct)) return 'loss';
  if (inet?.rtt != null && inet.rtt > s.rtt_ms) return 'high';
  return 'ok';
}

function alertText(status: NetStatus, prev: string | null, name: string, isp: string, vpn: PingResult, inet: PingResult | null, since: Date, s: { rtt_ms: number }) {
  const who = `<b>${esc(name)}</b>${isp ? ` (${esc(isp)})` : ''}`;
  const ping = [vpn.rtt != null ? `VPN ${Math.round(vpn.rtt)} ms` : null, inet?.rtt != null ? `internet ${Math.round(inet.rtt)} ms` : null,
    inet && inet.loss ? `pérdida ${inet.loss}%` : vpn.loss ? `pérdida ${vpn.loss}%` : null].filter(Boolean).join(' · ');
  switch (status) {
    case 'down': return `🔴 ${who} no responde desde hace ${fmtSince(since)}.`;
    case 'no_internet': return `🔴 ${who} sin internet: el router responde pero no llega a ${INET_TARGET} (${fmtSince(since)}).`;
    case 'loss': return `🟠 ${who} con pérdida de paquetes. ${ping}`;
    case 'high': return `🟠 ${who} con ping alto a internet: ${Math.round(inet?.rtt || 0)} ms (umbral ${s.rtt_ms}). ${ping}`;
    case 'ok': return `🟢 ${who} normal otra vez${prev ? ` (estuvo "${STATUS_LABEL[prev as NetStatus] || prev}")` : ''}. ${ping}`;
  }
}

export async function runNetMonitor(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { rows: devices } = await pool.query(
      `SELECT d.id, d.name, d.host, d.tenant_id, t.name AS tenant_name
         FROM mikrotik_devices d LEFT JOIN tenants t ON t.id = d.tenant_id
        WHERE d.host IS NOT NULL AND d.status = 'active'::device_status AND COALESCE(t.is_active, true) = true AND COALESCE(t.enable_mikrotik, true) = true`
    );
    if (!devices.length) return;
    const settings = await loadAllSettings();
    const global = settings.find((s) => !s.tenant_id);
    const thresholds = (tenantId: string | null) => {
      const s = settings.find((x) => x.tenant_id === tenantId) || global;
      return { rtt_ms: s?.rtt_ms || DEFAULTS.rtt_ms, loss_pct: s?.loss_pct || DEFAULTS.loss_pct };
    };

    const vpnPings = await pingFromVps(devices.map((d: any) => String(d.host)));
    const { rows: stateRows } = await pool.query(`SELECT * FROM net_monitor_state`);
    const states = new Map<string, any>(stateRows.map((r: any) => [r.mikrotik_id, r]));

    let next = 0;
    const worker = async () => {
      while (next < devices.length) {
        const d = devices[next++];
        try {
          const vpn = vpnPings.get(String(d.host)) || { loss: 100, rtt: null };
          const inet = vpn.loss < 100 ? await pingFromRouter(d.id) : null;
          const th = thresholds(d.tenant_id);
          const status = judge(vpn, inet, th);
          await pool.query(
            `INSERT INTO net_monitor_samples (mikrotik_id, vpn_rtt, vpn_loss, inet_rtt, inet_loss, status) VALUES ($1,$2,$3,$4,$5,$6)`,
            [d.id, vpn.rtt, vpn.loss, inet?.rtt ?? null, inet?.loss ?? null, status]
          );

          // Racha del estado actual
          const prev = states.get(d.id);
          const same = prev && prev.status === status;
          const streak = same ? Number(prev.streak) + 1 : 1;
          const since = same ? new Date(prev.since) : new Date();
          let alerted: string | null = prev?.alerted_status ?? null;

          // Avisar al mantenerse STREAK_ALERT mediciones. "ok" solo avisa si antes se alertó un problema.
          const shouldAlert = streak === STREAK_ALERT && status !== (alerted ?? 'ok') && (status !== 'ok' || alerted !== null);
          if (shouldAlert) {
            const text = alertText(status, alerted, String(d.name), String(d.tenant_name || '').trim(), vpn, inet, since, th);
            const targets = settings.filter((s) => s.enabled && s.telegram_token && s.telegram_chat && (s.tenant_id === d.tenant_id || !s.tenant_id));
            for (const t of targets) {
              await sendTelegram(t.telegram_token!, t.telegram_chat!, text).catch((e) => console.warn(`[MONITOR] Telegram: ${e.message}`));
            }
            alerted = status === 'ok' ? null : status;
          }
          await pool.query(
            `INSERT INTO net_monitor_state (mikrotik_id, status, streak, since, alerted_status, alerted_at, updated_at)
             VALUES ($1,$2,$3,$4,$5, CASE WHEN $6 THEN now() END, now())
             ON CONFLICT (mikrotik_id) DO UPDATE SET status = $2, streak = $3, since = $4, alerted_status = $5,
               alerted_at = CASE WHEN $6 THEN now() ELSE net_monitor_state.alerted_at END, updated_at = now()`,
            [d.id, status, streak, since, alerted, shouldAlert]
          );
        } catch (e: any) {
          console.warn(`[MONITOR] ${d.name}: ${e.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, devices.length) }, worker));

    if (Date.now() - lastPrune > 3600_000) {
      lastPrune = Date.now();
      await pool.query(`DELETE FROM net_monitor_samples WHERE at < now() - interval '${KEEP_DAYS} days'`).catch(() => undefined);
    }
  } finally {
    running = false;
  }
}
