import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import crypto from 'crypto';
import { pool } from './db';

/**
 * Consumo de recursos del servidor, en general y por ISP (panel del super admin).
 *
 * El contenedor de la API ve el /proc del host para CPU, carga y memoria, y
 * el disco del host a través de su overlay. El tráfico de red y de los túneles
 * L2TP se lee dentro de omnisync-l2tp (red del host). `docker stats` da el
 * consumo por contenedor; los escritorios remotos (omnisync-ub-<sha1 del
 * usuario>) se atribuyen al ISP de su usuario.
 *
 * Todo se calcula a lo sumo cada 10 s, aunque varios paneles pidan a la vez.
 */

const L2TP = process.env.L2TP_CONTAINER || 'omnisync-l2tp';
const CACHE_MS = 10_000;

function run(cmd: string, args: string[], timeout = 15000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout || '')));
  });
}

// ─── CPU (delta entre lecturas de /proc/stat) ──────────────
type CpuSample = { idle: number; total: number };
let lastCpu: CpuSample | null = null;

async function cpuSample(): Promise<CpuSample | null> {
  const line = (await readFile('/proc/stat', 'utf8').catch(() => '')).split('\n')[0] || '';
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  if (n.length < 4 || n.some((v) => !Number.isFinite(v))) return null;
  const idle = n[3] + (n[4] || 0);
  return { idle, total: n.reduce((a, b) => a + b, 0) };
}

async function cpuPercent(): Promise<number | null> {
  let prev = lastCpu;
  if (!prev) {
    prev = await cpuSample();
    await new Promise((r) => setTimeout(r, 400));
  }
  const now = await cpuSample();
  if (!prev || !now) return null;
  lastCpu = now;
  const dt = now.total - prev.total;
  return dt > 0 ? Math.round((1 - (now.idle - prev.idle) / dt) * 1000) / 10 : null;
}

// ─── Memoria, carga, disco, uptime ─────────────────────────
async function memory() {
  const txt = await readFile('/proc/meminfo', 'utf8').catch(() => '');
  const kb = (k: string) => Number(txt.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] || 0) * 1024;
  const total = kb('MemTotal');
  const available = kb('MemAvailable');
  const swapTotal = kb('SwapTotal');
  return { total, used: Math.max(0, total - available), swap_total: swapTotal, swap_used: Math.max(0, swapTotal - kb('SwapFree')) };
}

async function disk() {
  const line = (await run('df', ['-P', '-B1', '/'])).trim().split('\n').pop() || '';
  const p = line.split(/\s+/);
  return { total: Number(p[1]) || 0, used: Number(p[2]) || 0 };
}

// ─── Red del host y túneles (dentro de omnisync-l2tp) ──────
type Counters = Map<string, { rx: number; tx: number }>;
let lastNet: { at: number; counters: Counters } | null = null;

function parseNetDev(txt: string): Counters {
  const out: Counters = new Map();
  for (const line of txt.split('\n').slice(2)) {
    const m = line.match(/^\s*([^:]+):\s*(.*)$/);
    if (!m) continue;
    const f = m[2].trim().split(/\s+/).map(Number);
    out.set(m[1].trim(), { rx: f[0] || 0, tx: f[8] || 0 });
  }
  return out;
}

async function hostNetwork() {
  const out = await run('docker', ['exec', L2TP, 'sh', '-c',
    `cat /proc/net/dev; echo ===; ip -o -4 addr show | awk '/ peer /{print $2, $6}'; echo ===; ip route show default | awk '{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}'`]);
  const [dev = '', peers = '', wan = ''] = out.split('===\n');
  const counters = parseNetDev(dev);
  const now = Date.now();
  const prev = lastNet;
  lastNet = { at: now, counters };
  const secs = prev ? (now - prev.at) / 1000 : 0;
  const rate = (name: string) => {
    const c = counters.get(name);
    const p = prev?.counters.get(name);
    if (!c || !p || secs <= 0 || c.rx < p.rx || c.tx < p.tx) return { rx_bps: null, tx_bps: null };
    return { rx_bps: Math.round(((c.rx - p.rx) * 8) / secs), tx_bps: Math.round(((c.tx - p.tx) * 8) / secs) };
  };
  // "ppp1 192.168.42.11/32" -> peer 192.168.42.11 en ppp1
  const ifByPeer = new Map<string, string>();
  for (const line of peers.split('\n')) {
    const [ifc, peer] = line.trim().split(/\s+/);
    if (ifc && peer) ifByPeer.set(peer.split('/')[0], ifc);
  }
  const wanIf = wan.trim();
  const wanCounters = counters.get(wanIf);
  return {
    wan: wanIf ? { iface: wanIf, rx_bytes: wanCounters?.rx ?? null, tx_bytes: wanCounters?.tx ?? null, ...rate(wanIf) } : null,
    tunnel: (peerIp: string) => {
      const ifc = ifByPeer.get(peerIp);
      if (!ifc) return null;
      const c = counters.get(ifc);
      return { iface: ifc, rx_bytes: c?.rx ?? 0, tx_bytes: c?.tx ?? 0, ...rate(ifc) };
    },
  };
}

// ─── Contenedores ──────────────────────────────────────────
const UNITS: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 };
function bytes(v: string): number {
  const m = String(v).trim().match(/^([\d.]+)\s*([A-Za-z]+)$/);
  return m ? Math.round(Number(m[1]) * (UNITS[m[2].toUpperCase()] || 1)) : 0;
}

async function containers() {
  const out = await run('docker', ['stats', '--no-stream', '--format', '{{json .}}'], 20000);
  return out.split('\n').filter(Boolean).flatMap((line) => {
    try {
      const s = JSON.parse(line);
      const [netIn = '0B', netOut = '0B'] = String(s.NetIO || '').split('/').map((x: string) => x.trim());
      return [{
        name: String(s.Name),
        cpu: Number(String(s.CPUPerc).replace('%', '')) || 0,
        mem: bytes(String(s.MemUsage || '').split('/')[0] || '0B'),
        mem_percent: Number(String(s.MemPerc).replace('%', '')) || 0,
        net_rx: bytes(netIn),
        net_tx: bytes(netOut),
      }];
    } catch {
      return [];
    }
  }).sort((a, b) => b.cpu - a.cpu || b.mem - a.mem);
}

// ─── Resumen ───────────────────────────────────────────────
let cache: { at: number; data: any } | null = null;
let inflight: Promise<any> | null = null;

async function build() {
  const [cpu, mem, dsk, uptimeTxt, loadTxt, net, ctrs, tenantsRes, peersRes, onusRes, routersRes, usersRes, cpeRes] = await Promise.all([
    cpuPercent(),
    memory(),
    disk(),
    readFile('/proc/uptime', 'utf8').catch(() => ''),
    readFile('/proc/loadavg', 'utf8').catch(() => ''),
    hostNetwork(),
    containers(),
    pool.query(`SELECT id, name, slug, onu_limit, COALESCE(is_active, true) AS is_active FROM tenants ORDER BY name`),
    pool.query(`SELECT tenant_id, name, tunnel_ip, COALESCE(is_active, true) AS is_active FROM tenant_vpn_peers`),
    pool.query(`SELECT tenant_id, status, count(*)::int AS n FROM acs_device_owners GROUP BY tenant_id, status`),
    pool.query(`SELECT tenant_id, count(*)::int AS n FROM mikrotik_devices GROUP BY tenant_id`),
    pool.query(`SELECT id, tenant_id FROM users`),
    pool.query(`SELECT d.tenant_id, count(*)::int AS n FROM cpe_devices c JOIN mikrotik_devices d ON d.id = c.mikrotik_id GROUP BY d.tenant_id`).catch(() => ({ rows: [] as any[] })),
  ]);

  // Escritorio remoto -> usuario -> ISP (mismo nombre que user-browser.ts)
  const tenantByContainer = new Map<string, string | null>();
  for (const u of usersRes.rows) {
    const id = crypto.createHash('sha1').update(String(u.id)).digest('hex').slice(0, 10);
    tenantByContainer.set(`omnisync-ub-${id}`, u.tenant_id || null);
  }

  const load = loadTxt.trim().split(/\s+/).slice(0, 3).map(Number);
  const tenants = tenantsRes.rows.map((t: any) => {
    const peers = peersRes.rows.filter((p: any) => p.tenant_id === t.id);
    const tunnels = peers.map((p: any) => ({
      name: p.name,
      tunnel_ip: p.tunnel_ip,
      active: p.is_active,
      link: p.tunnel_ip ? net.tunnel(String(p.tunnel_ip)) : null,
    }));
    const desktops = ctrs.filter((c) => c.name.startsWith('omnisync-ub-') && tenantByContainer.get(c.name) === t.id);
    const onus = onusRes.rows.filter((r: any) => r.tenant_id === t.id);
    const sum = (k: 'rx_bytes' | 'tx_bytes' | 'rx_bps' | 'tx_bps') =>
      tunnels.reduce((a: number, x: any) => a + (Number(x.link?.[k]) || 0), 0);
    return {
      id: t.id,
      name: String(t.name).trim(),
      slug: t.slug,
      is_active: t.is_active,
      onus: onus.filter((r: any) => r.status === 'active').reduce((a: number, r: any) => a + r.n, 0),
      onus_blocked: onus.filter((r: any) => r.status !== 'active').reduce((a: number, r: any) => a + r.n, 0),
      onu_limit: t.onu_limit === null ? null : Number(t.onu_limit),
      routers: routersRes.rows.find((r: any) => r.tenant_id === t.id)?.n || 0,
      cpes: cpeRes.rows.find((r: any) => r.tenant_id === t.id)?.n || 0,
      users: usersRes.rows.filter((u: any) => u.tenant_id === t.id).length,
      vpn_total: peers.length,
      vpn_connected: tunnels.filter((x: any) => x.link).length,
      tunnels,
      traffic: { rx_bytes: sum('rx_bytes'), tx_bytes: sum('tx_bytes'), rx_bps: sum('rx_bps'), tx_bps: sum('tx_bps') },
      desktops: {
        count: desktops.length,
        cpu: Math.round(desktops.reduce((a, c) => a + c.cpu, 0) * 10) / 10,
        mem: desktops.reduce((a, c) => a + c.mem, 0),
      },
    };
  });

  return {
    at: new Date().toISOString(),
    host: {
      cpu_percent: cpu,
      cores: (await readFile('/proc/cpuinfo', 'utf8').catch(() => '')).split('\n').filter((l) => /^processor\s*:/.test(l)).length || null,
      load: load.every(Number.isFinite) ? load : null,
      uptime_s: Math.round(Number(uptimeTxt.split(' ')[0]) || 0),
      memory: mem,
      disk: dsk,
      network: net.wan,
    },
    containers: ctrs.map((c) => ({
      ...c,
      tenant_id: c.name.startsWith('omnisync-ub-') ? tenantByContainer.get(c.name) ?? null : undefined,
    })),
    tenants,
  };
}

export async function serverResources(): Promise<any> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (inflight) return inflight;
  inflight = build()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
