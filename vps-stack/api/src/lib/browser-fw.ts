import { execFile } from 'child_process';
import type { Cidr, NetworkPin } from './networks';

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
 * Prioridad de las reglas "desde este escritorio hacia la red X, usa la tabla
 * del túnel de SU ISP". Va después de las IP puntuales (20000+ifindex,
 * l2tp.ts) y antes de la tabla main (32766), donde la ruta global de una red
 * repetida puede apuntar al túnel de otro ISP.
 */
const PIN_PREF = 30500;

/** Borra las reglas de fijación por túnel de una IP de escritorio. */
const unpinScript = (ip: string) =>
  ip ? `while ip rule del pref ${PIN_PREF} from '${ip}/32' 2>/dev/null; do :; done` : 'true';

/**
 * Fija cada red del ISP a la tabla 31000+N de su túnel (N = último octeto de
 * la IP de túnel; la misma tabla que usa restore-l2tp-routes.sh). La tabla
 * lleva además un "unreachable" de respaldo: con el túnel caído el tráfico se
 * corta en vez de caer a la ruta global (que podría ser de otro ISP).
 */
function pinScript(ip: string, pins: NetworkPin[]): string {
  const lines: string[] = [unpinScript(ip)];
  for (const pin of pins) {
    const peer = safeIp(pin.tunnelIp);
    const n = Number(peer.split('.')[3]);
    if (!peer || !(n >= 1 && n <= 254)) continue;
    const table = 31000 + n;
    lines.push(
      `IFC=$(ip -o -4 addr show | grep -F "peer ${peer}/" | head -1 | awk '{print $2}'); ` +
        `[ -n "$IFC" ] && ip route replace default dev "$IFC" table ${table} 2>/dev/null; ` +
        `ip route replace unreachable default metric 4294967295 table ${table} 2>/dev/null; ` +
        `ip rule add pref ${PIN_PREF} from '${ip}/32' to '${pin.cidr.text}' table ${table} || exit 1`,
    );
  }
  return lines.join('; ');
}

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
 * super admin), cada red fijada al túnel de su ISP (`pins`). `extra` son IPs
 * puntuales ya validadas (equipo
 * descubierto por la MikroTik del propio ISP).
 */
export async function isolateBrowser(
  container: string,
  sourceIp: string,
  allow: Cidr[] | null,
  pins: NetworkPin[],
  extra: string[] = [],
): Promise<boolean> {
  const name = safeName(container);
  const ip = safeIp(sourceIp);
  if (!name || !ip) return false;
  const tag = `${TAG_PREFIX}${name}`;

  // Se insertan al inicio, así que el último insertado se evalúa primero:
  // orden final = IPs puntuales > redes propias > cola DROP. Las redes propias
  // salen solo por los túneles del ISP (`pins`), aunque otro ISP las repita;
  // si la fijación falla no se abre nada (queda la cola DROP).
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
  for (const e of extra.map(safeIp).filter(Boolean)) add(`${e}/32`, 'RETURN');

  const pinning = allow === null ? unpinScript(ip) : pinScript(ip, pins);
  const r = await hostSh(`${BASE}; ${flushScript(name, ip)}; ${pinning}; ${rules.join('; ')}${rules.length ? '; ' : ''}printf isolated`);
  return r.ok && r.out.includes('isolated');
}

/** Quita las reglas de un escritorio destruido. */
export async function releaseBrowser(container: string, sourceIp?: string | null): Promise<void> {
  const name = safeName(container);
  if (!name) return;
  const ip = sourceIp ? safeIp(sourceIp) : '';
  await hostSh(`${flushScript(name, ip)}; ${unpinScript(ip)}`);
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
