import { parseUptime } from './ap-signal';
import type { CpeBrand } from './cpe-ssh';

/**
 * Salud del lado del cliente leída en su antena (solo lectura):
 * puerto LAN conectado o no, velocidad y dúplex, caídas del enlace y tiempo
 * encendida. Sirve para separar fallas de cable/conector/fuente de las de
 * señal: un LAN a 10 Mbps o en half-duplex casi siempre es cable o conector
 * dañado; muchas caídas, conector flojo; poco tiempo encendida, fuente o PoE.
 */
export interface CpeHealth {
  lan_iface: string | null;
  lan_up: boolean | null;
  lan_mbps: number | null;
  lan_full: boolean | null;
  /** Veces que se cayó el enlace LAN desde que encendió. */
  lan_downs: number | null;
  uptime_s: number | null;
}

const EMPTY: CpeHealth = { lan_iface: null, lan_up: null, lan_mbps: null, lan_full: null, lan_downs: null, uptime_s: null };

const truthy = (v: unknown) => v === true || v === 'true' || v === 'yes';
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "100Mbps" / "1Gbps" / "10M" -> Mbps */
export function rateToMbps(v: unknown): number | null {
  const m = String(v ?? '').match(/(\d+(?:\.\d+)?)\s*([GM])/i);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2].toUpperCase() === 'G' ? 1000 : 1));
}

type ApiFn = (path: string, method?: string, body?: Record<string, unknown>) => Promise<any>;

/** MikroTik por API nativa. */
export async function readMikrotikHealthApi(call: ApiFn): Promise<CpeHealth> {
  const [ifs, res] = await Promise.all([
    call('/rest/interface').catch(() => []),
    call('/rest/system/resource').catch(() => null),
  ]);
  const ethers = (Array.isArray(ifs) ? ifs : [])
    .filter((i: any) => i.type === 'ether' && !truthy(i.disabled));
  // El LAN del cliente: el puerto con enlace; si ninguno, el primero (ether1)
  const eth = ethers.find((i: any) => truthy(i.running)) || ethers[0];
  const resource = Array.isArray(res) ? res[0] : res;
  const h: CpeHealth = { ...EMPTY, uptime_s: parseUptime(resource?.uptime) };
  if (!eth) return h;
  h.lan_iface = String(eth.name);
  h.lan_up = truthy(eth.running);
  h.lan_downs = num(eth['link-downs']);
  if (h.lan_up) {
    const mon = await call('/rest/interface/ethernet/monitor', 'POST', { numbers: eth.name, once: '' }).catch(() => null);
    const m = Array.isArray(mon) ? mon[0] : mon;
    if (m) {
      if (m.status) h.lan_up = m.status === 'link-ok';
      h.lan_mbps = rateToMbps(m.rate);
      if (m['full-duplex'] !== undefined) h.lan_full = truthy(m['full-duplex']);
    }
  }
  return h;
}

/**
 * Comandos SSH (solo lectura). Imprimen líneas "ETH|..." y "UP|...".
 * MikroTik: `monitor ... as-value` puede faltar en versiones viejas; se ignora.
 */
export const HEALTH_CMD: Record<CpeBrand, string> = {
  mikrotik:
    ':foreach i in=[/interface find type="ether" disabled=no] do={ ' +
    ':local n [/interface get $i name]; :local r [/interface get $i running]; :local d [/interface get $i link-downs]; ' +
    ':local st ""; :local rt ""; :local fd ""; ' +
    ':if ($r) do={ :do { :local m [/interface ethernet monitor $n once as-value]; :set st ($m->"status"); :set rt ($m->"rate"); :set fd ($m->"full-duplex") } on-error={} }; ' +
    ':put ("ETH|" . $n . "|" . $r . "|" . $d . "|" . $st . "|" . $rt . "|" . $fd) }; ' +
    ':put ("UP|" . [/system resource get uptime])',
  ubiquiti:
    'for i in eth0 eth1; do [ -d /sys/class/net/$i ] || continue; ' +
    'c=$(cat /sys/class/net/$i/carrier 2>/dev/null); s=$(cat /sys/class/net/$i/speed 2>/dev/null); ' +
    'd=$(cat /sys/class/net/$i/duplex 2>/dev/null); k=$(cat /sys/class/net/$i/carrier_changes 2>/dev/null); ' +
    'echo "ETH|$i|$c|$s|$d|$k"; done; echo "UP|$(cut -d. -f1 /proc/uptime)"',
};

export function parseHealthSsh(brand: CpeBrand, out: string): CpeHealth {
  const lines = out.split(/\r?\n/).map((l) => l.trim());
  const up = lines.find((l) => l.startsWith('UP|'));
  const h: CpeHealth = { ...EMPTY, uptime_s: up ? parseUptime(up.slice(3)) : null };
  const ports = lines.filter((l) => l.startsWith('ETH|')).map((l) => l.split('|'));
  if (!ports.length) return h;

  if (brand === 'mikrotik') {
    // ETH|name|running|link-downs|status|rate|full-duplex
    const p = ports.find((x) => truthy(x[2])) || ports[0];
    h.lan_iface = p[1] || null;
    h.lan_up = p[4] ? p[4] === 'link-ok' : truthy(p[2]);
    h.lan_downs = num(p[3]);
    h.lan_mbps = rateToMbps(p[5]);
    h.lan_full = p[6] ? truthy(p[6]) : null;
    return h;
  }

  // Ubiquiti: ETH|iface|carrier|speed|duplex|carrier_changes
  const p = ports.find((x) => x[2] === '1') || ports[0];
  h.lan_iface = p[1] || null;
  h.lan_up = p[2] === '1' ? true : p[2] === '0' ? false : null;
  const speed = num(p[3]);
  h.lan_mbps = h.lan_up && speed && speed > 0 ? speed : null;
  h.lan_full = h.lan_up && p[4] ? p[4] === 'full' : null;
  // carrier_changes cuenta subidas y caídas: las caídas son la mitad
  const changes = num(p[5]);
  h.lan_downs = changes === null ? null : Math.floor(changes / 2);
  return h;
}

/** Texto del problema más probable (null = LAN sana o sin datos). */
export function lanProblem(h: Pick<CpeHealth, 'lan_up' | 'lan_mbps' | 'lan_full'>): string | null {
  if (h.lan_up === false) return 'LAN desconectada: router del cliente apagado o cable desconectado';
  if (h.lan_up && h.lan_full === false) return 'LAN en half-duplex: revisar cable o conector';
  if (h.lan_up && h.lan_mbps !== null && h.lan_mbps < 100) return `LAN a ${h.lan_mbps} Mbps: revisar cable o conector`;
  return null;
}
