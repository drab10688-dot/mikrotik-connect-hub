import { pool } from './db';

/**
 * Redes de ONUs/LAN que cada ISP declara en su VPN.
 *
 * Son la base del aislamiento multi-ISP: las rutas del VPS, el escritorio
 * remoto y el acceso web a ONUs sólo alcanzan las redes del ISP dueño. Por eso
 * se validan con reglas estrictas:
 *  - Sólo rangos privados (10/8, 172.16/12, 192.168/16, 100.64/10).
 *  - Máscara mínima /24 (configurable con ONU_NET_MIN_PREFIX): un /16 tapa las
 *    redes de otros ISP y de los otros routers del mismo ISP.
 *  - Sin solapes con ninguna otra VPN (de otro ISP o de otro router del mismo).
 *  - Se permiten varias redes separadas por coma o espacio.
 */

export const ONU_NET_MIN_PREFIX = Math.min(
  30,
  Math.max(8, Number(process.env.ONU_NET_MIN_PREFIX || 24) || 24),
);

const RESERVED = [
  process.env.L2TP_TUNNEL_NET || '192.168.42.0/24',
  process.env.BROWSER_SUBNET || '172.31.42.0/24',
];

export interface Cidr {
  net: number;
  prefix: number;
  text: string;
}

function ipToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function mask(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** Convierte "a.b.c.d/nn" (o una IP suelta = /32) a CIDR normalizado. */
export function parseCidr(raw: string): Cidr | null {
  const [ip, p] = raw.trim().split('/');
  const n = ipToInt(ip);
  const prefix = p === undefined ? 32 : Number(p);
  if (n === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const net = (n & mask(prefix)) >>> 0;
  return { net, prefix, text: `${intToIp(net)}/${prefix}` };
}

export function overlaps(a: Cidr, b: Cidr): boolean {
  const p = Math.min(a.prefix, b.prefix);
  return ((a.net & mask(p)) >>> 0) === ((b.net & mask(p)) >>> 0);
}

export function ipInCidr(ip: string, c: Cidr): boolean {
  const n = ipToInt(ip);
  return n !== null && ((n & mask(c.prefix)) >>> 0) === c.net;
}

const PRIVATE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10'].map((s) => parseCidr(s)!);

function isPrivate(c: Cidr): boolean {
  return PRIVATE.some((p) => c.prefix >= p.prefix && overlaps(c, p));
}

/** Lista cruda "a, b c" -> textos sin vacíos. */
export function splitNetworks(value: unknown): string[] {
  return String(value ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Valida y normaliza las redes declaradas. Devuelve el texto listo para
 * guardar ("192.168.20.0/24,192.168.21.0/24") o un error legible.
 */
export function validateOnuNetworks(value: unknown): { ok: true; nets: Cidr[]; text: string } | { ok: false; error: string } {
  const items = splitNetworks(value);
  if (!items.length) return { ok: false, error: 'Indica al menos una red de ONUs/LAN (ejemplo: 192.168.20.0/24).' };
  if (items.length > 64) return { ok: false, error: 'Máximo 64 redes por router.' };

  const nets: Cidr[] = [];
  for (const item of items) {
    if (!item.includes('/')) {
      return { ok: false, error: `"${item}" no tiene máscara. Escríbela como red, por ejemplo ${item}/24.` };
    }
    const c = parseCidr(item);
    if (!c) return { ok: false, error: `"${item}" no es una red válida.` };
    if (c.prefix < ONU_NET_MIN_PREFIX) {
      return {
        ok: false,
        error: `La red ${item} es demasiado grande. Usa máscara /${ONU_NET_MIN_PREFIX} o menor (puedes agregar varias redes separadas por coma).`,
      };
    }
    if (!isPrivate(c)) return { ok: false, error: `La red ${item} no es privada (usa 10.x, 172.16-31.x, 192.168.x o 100.64-127.x).` };
    for (const r of RESERVED) {
      const rc = parseCidr(r);
      if (rc && overlaps(c, rc)) return { ok: false, error: `La red ${item} está reservada por el servidor (${r}).` };
    }
    const dup = nets.find((n) => overlaps(n, c));
    if (dup) return { ok: false, error: `Las redes ${dup.text} y ${c.text} se enciman; deja solo una.` };
    nets.push(c);
  }
  return { ok: true, nets, text: nets.map((n) => n.text).join(',') };
}

/**
 * Comprueba que las redes no se enciman con las de otra VPN (de otro ISP o de
 * otro router del mismo ISP). `exceptPeerId` excluye el peer que se edita.
 */
export async function findNetworkClash(nets: Cidr[], exceptPeerId?: string | null): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.onu_networks, t.name AS tenant_name
       FROM tenant_vpn_peers p JOIN tenants t ON t.id = p.tenant_id
      WHERE ($1::uuid IS NULL OR p.id <> $1::uuid)`,
    [exceptPeerId || null],
  );
  for (const row of rows) {
    for (const raw of splitNetworks(row.onu_networks)) {
      const other = parseCidr(raw);
      if (!other) continue;
      const hit = nets.find((n) => overlaps(n, other));
      if (hit) {
        return `La red ${hit.text} se encima con ${other.text} del router "${row.name}" (ISP "${String(row.tenant_name).trim()}"). Cada router debe declarar sus propias redes.`;
      }
    }
  }
  return null;
}

export interface NetworkScope {
  /** Redes del ISP. `null` = sin restricción (super admin sin ISP asignado). */
  allow: Cidr[] | null;
  /**
   * Redes de OTROS ISP que caen dentro de las propias (VPN antiguas con
   * rangos amplios, p. ej. 192.168.0.0/16). Se bloquean explícitamente.
   */
  deny: Cidr[];
}

/** Redes que puede alcanzar un usuario según su ISP. */
export async function networkScopeFor(role: string | undefined, tenantId: string | null): Promise<NetworkScope> {
  if (!tenantId) return { allow: role === 'super_admin' ? null : [], deny: [] };

  const { rows } = await pool.query(
    `SELECT tenant_id, onu_networks FROM tenant_vpn_peers
      WHERE COALESCE(is_active, true) = true`,
  );
  const allow: Cidr[] = [];
  const others: Cidr[] = [];
  for (const row of rows) {
    for (const raw of splitNetworks(row.onu_networks)) {
      const c = parseCidr(raw);
      if (!c) continue;
      (row.tenant_id === tenantId ? allow : others).push(c);
    }
  }
  // Solo las redes de otro ISP que caen DENTRO de una propia más amplia. Una
  // red ajena más amplia que la propia (p. ej. otro ISP con 192.168.0.0/16)
  // no se bloquea: taparía las redes del propio ISP.
  const deny = others.filter((o) => allow.some((a) => o.prefix > a.prefix && overlaps(a, o)));
  return { allow, deny };
}

/** true si la IP pertenece al ISP (y no a otro ISP metido dentro de sus rangos). */
export function ipAllowed(ip: string, scope: NetworkScope): boolean {
  if (scope.allow === null) return true;
  if (scope.deny.some((c) => ipInCidr(ip, c))) return false;
  return scope.allow.some((c) => ipInCidr(ip, c));
}
