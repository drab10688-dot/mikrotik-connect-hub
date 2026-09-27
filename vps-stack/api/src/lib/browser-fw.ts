import { execFile } from 'child_process';
import type { Cidr } from './networks';

/**
 * Firewall POR ESCRITORIO remoto (aislamiento multi-ISP).
 *
 * Cada contenedor omnisync-ub-* sólo puede abrir conexiones hacia las redes
 * VPN de su ISP (más la IP puntual del equipo abierto). Todo lo demás se
 * descarta, incluidas las redes de otros ISP.
 *
 * Las reglas viven en la tabla `mangle` (cadena OMNISYNC-UB, enganchada al
 * inicio de FORWARD). Se usa mangle porque la tabla filter/FORWARD recibe
 * cientos de ACCEPT insertados al inicio por el hook L2TP (ip-up) y por las
 * rutas puntuales; esos ACCEPT se evaluaban ANTES que DOCKER-USER y dejaban
 * el aislamiento sin efecto. mangle/FORWARD siempre se evalúa primero.
 *
 * Los comandos se ejecutan en el contenedor L2TP (red del host, privilegiado),
 * igual que las rutas de lib/l2tp.ts.
 */

const HOST_CONTAINER = process.env.L2TP_CONTAINER || 'omnisync-l2tp';
const SUBNET = process.env.BROWSER_SUBNET || '172.31.42.0/24';
const CHAIN = 'OMNISYNC-UB';
const TAG_PREFIX = 'omnisync-ub:';

function hostSh(script: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile('docker', ['exec', HOST_CONTAINER, 'sh', '-c', script], { timeout: 20000 }, (err, stdout, stderr) => {
      if (err) console.warn(`[browser-fw] ${err.message} ${stderr || ''}`);
      resolve({ ok: !err, out: stdout || '' });
    });
  });
}

const safeName = (v: string) => v.replace(/[^a-zA-Z0-9_.-]/g, '');
const safeIp = (v: string) => (/^\d{1,3}(\.\d{1,3}){3}$/.test(v) ? v : '');

/**
 * Estructura base (idempotente): cadena, enganche en FORWARD y cola
 * "permitir su propia subred (Nginx) y descartar el resto".
 * La misma estructura la crea browser-firewall.sh en instalación/actualización.
 */
const BASE = [
  `S='${SUBNET}'; C='${CHAIN}'`,
  `iptables -t mangle -N "$C" 2>/dev/null || true`,
  `iptables -t mangle -C FORWARD -s "$S" -j "$C" 2>/dev/null || iptables -t mangle -I FORWARD 1 -s "$S" -j "$C"`,
  // Nginx también vive en esta subred: sus respuestas (panel, ONUs) son ESTABLISHED.
  `iptables -t mangle -C "$C" -m conntrack --ctstate ESTABLISHED,RELATED -m comment --comment omnisync-ub-base -j RETURN 2>/dev/null || iptables -t mangle -I "$C" 1 -m conntrack --ctstate ESTABLISHED,RELATED -m comment --comment omnisync-ub-base -j RETURN`,
  `iptables -t mangle -C "$C" -d "$S" -m comment --comment omnisync-ub-base -j RETURN 2>/dev/null || iptables -t mangle -A "$C" -d "$S" -m comment --comment omnisync-ub-base -j RETURN`,
  `iptables -t mangle -C "$C" -m comment --comment omnisync-ub-base -j DROP 2>/dev/null || iptables -t mangle -A "$C" -m comment --comment omnisync-ub-base -j DROP`,
].join('; ');

/**
 * Borra las reglas de un escritorio (por nombre y por IP origen).
 * `iptables -S` muestra el comentario entre comillas ("omnisync-ub:..."); al
 * reinyectar la línea sin shell las comillas quedarían literales y el -D no
 * encontraría la regla, así que se quitan (el comentario no lleva espacios).
 */
function flushScript(name: string, ip: string): string {
  const tag = `${TAG_PREFIX}${name}("| |$)`;
  const pattern = ip ? `${tag}|-s ${ip}/32 ` : tag;
  return (
    `iptables -t mangle -S '${CHAIN}' 2>/dev/null | grep -E -- '${pattern}' | sed -e 's/^-A /-D /' -e 's/"//g' | ` +
    `while read -r rule; do iptables -t mangle $rule 2>/dev/null; done`
  );
}

/**
 * Aplica el aislamiento de un escritorio: sólo `allow` (null = sin límite,
 * super admin) y nunca `deny`. `extra` son IPs puntuales ya validadas (equipo
 * descubierto por la MikroTik del propio ISP).
 */
export async function isolateBrowser(
  container: string,
  sourceIp: string,
  allow: Cidr[] | null,
  deny: Cidr[],
  extra: string[] = [],
): Promise<boolean> {
  const name = safeName(container);
  const ip = safeIp(sourceIp);
  if (!name || !ip) return false;
  const tag = `${TAG_PREFIX}${name}`;

  // Se insertan al inicio, así que el último insertado se evalúa primero:
  // orden final = IPs puntuales > DROP de otros ISP > redes propias > cola DROP.
  // La IP puntual va por su propia tabla de rutas (túnel del router elegido),
  // por eso puede estar aunque coincida con la LAN repetida de otro ISP.
  const rules: string[] = [];
  const add = (dst: string, action: 'RETURN' | 'DROP') =>
    rules.push(`iptables -t mangle -I '${CHAIN}' 1 -s '${ip}/32' -d '${dst}' -m comment --comment '${tag}' -j ${action}`);

  if (allow === null) {
    for (const d of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10']) add(d, 'RETURN');
  } else {
    for (const c of allow) add(c.text, 'RETURN');
  }
  for (const c of deny) add(c.text, 'DROP');
  for (const e of extra.map(safeIp).filter(Boolean)) add(`${e}/32`, 'RETURN');

  const r = await hostSh(`${BASE}; ${flushScript(name, ip)}; ${rules.join('; ')}${rules.length ? '; ' : ''}printf isolated`);
  return r.ok && r.out.includes('isolated');
}

/** Quita las reglas de un escritorio destruido. */
export async function releaseBrowser(container: string, sourceIp?: string | null): Promise<void> {
  const name = safeName(container);
  if (!name) return;
  await hostSh(flushScript(name, sourceIp ? safeIp(sourceIp) : ''));
}

/** Elimina reglas de escritorios que ya no existen (reinicios del API, fallos). */
export async function pruneBrowserRules(runningContainers: string[]): Promise<void> {
  const alive = new Set(runningContainers.map(safeName));
  const r = await hostSh(`iptables -t mangle -S '${CHAIN}' 2>/dev/null | grep -o -- '${TAG_PREFIX}[a-zA-Z0-9_.-]*' | sort -u`);
  if (!r.ok) return;
  for (const tag of r.out.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const name = tag.slice(TAG_PREFIX.length);
    if (!alive.has(name)) await releaseBrowser(name);
  }
}
