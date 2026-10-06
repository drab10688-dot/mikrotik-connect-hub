import { pool } from './db';

/**
 * Redes de ONUs/LAN que cada ISP declara en su VPN.
 *
 * Son la base del aislamiento multi-ISP: las rutas del VPS, el escritorio
 * remoto y el acceso web a ONUs sólo alcanzan las redes del ISP dueño. Por eso
 * se validan con reglas estrictas:
 *  - Sólo rangos privados (10/8, 172.16/12, 192.168/16, 100.64/10).
 *  - Máscara mínima /24 (configurable con ONU_NET_MIN_PREFIX): un /16 se lleva
 *    la ruta global de redes que también usan otros routers.
 *  - Puede repetirse en otros routers, del mismo ISP o de otro (ver
 *    tunnelsForIp/NetworkPin más abajo).
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
 * Redes repetidas: se permiten entre routers del mismo ISP y entre ISP
 * distintos. Las ONUs se reparten por el token de la URL TR-069, no por IP, y
 * el tráfico de cada ISP queda fijado a SUS túneles:
 *  - respuestas: marcas de conexión por túnel (restore-l2tp-routes.sh);
 *  - escritorio remoto: reglas por IP origen hacia las tablas de sus túneles
 *    (browser-fw.ts, `pins`);
 *  - Connection Request: se envía por cada túnel del ISP dueño de la ONU.
 */

/**
 * Túneles que declaran una red con `ip`: los del ISP indicado (`own`) y el
 * total de routers activos de cualquier ISP (`total`).
 */
export async function tunnelsForIp(ip: string, tenantId: string): Promise<{ own: string[]; total: number }> {
  const { rows } = await pool.query(
    `SELECT tenant_id, tunnel_ip, onu_networks FROM tenant_vpn_peers
      WHERE tunnel_ip IS NOT NULL AND COALESCE(is_active, true) = true`,
  );
  const hits = rows.filter((r: any) => splitNetworks(r.onu_networks).some((raw) => {
    const c = parseCidr(raw);
    return c ? ipInCidr(ip, c) : false;
  }));
  return {
    own: hits.filter((r: any) => r.tenant_id === tenantId).map((r: any) => String(r.tunnel_ip)),
    total: hits.length,
  };
}

export interface NetworkPin {
  cidr: Cidr;
  /** IP de túnel del router del ISP que declara la red. */
  tunnelIp: string;
}

export interface NetworkScope {
  /** Redes del ISP. `null` = sin restricción (super admin sin ISP asignado). */
  allow: Cidr[] | null;
  /**
   * Cada red propia fijada al túnel de un router del ISP. Así una red que
   * otro ISP también declara nunca sale por el túnel ajeno.
   */
  pins: NetworkPin[];
}

/** Redes que puede alcanzar un usuario según su ISP. */
export async function networkScopeFor(role: string | undefined, tenantId: string | null): Promise<NetworkScope> {
  if (!tenantId) return { allow: role === 'super_admin' ? null : [], pins: [] };

  // El router actualizado más reciente gana cuando el ISP repite una red,
  // igual que prepareTenantRoute (routes/browser.ts).
  const { rows } = await pool.query(
    `SELECT tunnel_ip, onu_networks FROM tenant_vpn_peers
      WHERE tenant_id = $1 AND COALESCE(is_active, true) = true
      ORDER BY updated_at DESC NULLS LAST, created_at DESC`,
    [tenantId],
  );
  const allow: Cidr[] = [];
  const pins: NetworkPin[] = [];
  for (const row of rows) {
    for (const raw of splitNetworks(row.onu_networks)) {
      const c = parseCidr(raw);
      if (!c || allow.some((a) => a.text === c.text)) continue;
      allow.push(c);
      if (row.tunnel_ip) pins.push({ cidr: c, tunnelIp: String(row.tunnel_ip) });
    }
  }
  return { allow, pins };
}

/** true si la IP pertenece a las redes del ISP. */
export function ipAllowed(ip: string, scope: NetworkScope): boolean {
  if (scope.allow === null) return true;
  return scope.allow.some((c) => ipInCidr(ip, c));
}
