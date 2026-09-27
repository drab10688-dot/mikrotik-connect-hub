import { pool } from './db';
import { parseUptime } from './ap-signal';

/**
 * Relaciona cada cliente wireless de un AP con su cliente PPPoE.
 *
 * En la mayoría de redes la antena del cliente está en PUENTE y el PPPoE lo
 * hace un router detrás, así que la MAC que ve el AP (antena) no es la del
 * PPPoE (router). Orden de resolución:
 *  1. manual     — vínculo guardado por el operador (tabla ap_client_links).
 *  2. mac        — MAC idéntica al caller-id (la antena hace el PPPoE).
 *  3. mac-cercana— mismo equipo, otra interfaz (MACs consecutivas).
 *  4. ip         — la IP que reporta la estación es la del PPPoE.
 *  5. sugerido   — hora de conexión: cuando la antena se reconecta, el PPPoE
 *                  del router de atrás sube segundos después. Solo sugiere;
 *                  el operador confirma y queda como manual.
 */

export interface PppoeSession {
  name: string;
  comment: string | null;
  address: string | null;
  caller_id: string | null;
  uptime_s: number | null;
}

export interface PppoeLink {
  user: string;
  comment: string | null;
  address: string | null;
  online: boolean;
  match: 'manual' | 'mac' | 'mac-cercana' | 'ip' | 'sugerido';
  /** Segundos entre la conexión de la antena y la del PPPoE (solo 'sugerido'). */
  delta_s?: number;
}

export function normMac(mac?: string | null): string {
  return String(mac || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

function nearMac(a: string, b: string): boolean {
  if (a.length !== 12 || b.length !== 12 || a === b) return false;
  if (a.slice(0, 8) !== b.slice(0, 8)) return false;
  return Math.abs(parseInt(a.slice(8), 16) - parseInt(b.slice(8), 16)) <= 4;
}

export async function ensureApLinkSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ap_client_links (
       mikrotik_id UUID NOT NULL,
       mac TEXT NOT NULL,
       pppoe_user TEXT NOT NULL,
       created_by UUID,
       updated_at TIMESTAMPTZ DEFAULT now(),
       PRIMARY KEY (mikrotik_id, mac)
     )`,
  );
}

let schemaReady: Promise<void> | null = null;
function schema() {
  if (!schemaReady) schemaReady = ensureApLinkSchema().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

export async function saveApLink(mikrotikId: string, mac: string, user: string, userId?: string) {
  await schema();
  await pool.query(
    `INSERT INTO ap_client_links (mikrotik_id, mac, pppoe_user, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (mikrotik_id, mac) DO UPDATE SET pppoe_user = EXCLUDED.pppoe_user,
       created_by = EXCLUDED.created_by, updated_at = now()`,
    [mikrotikId, normMac(mac), user, userId || null],
  );
}

export async function deleteApLink(mikrotikId: string, mac: string) {
  await schema();
  await pool.query(`DELETE FROM ap_client_links WHERE mikrotik_id = $1 AND mac = $2`, [mikrotikId, normMac(mac)]);
}

/** Sesiones PPPoE del MikroTik (activas + comentario del secreto). */
export function pppoeSessions(activeRaw: any[], secretsRaw: any[]): { active: PppoeSession[]; comments: Map<string, string> } {
  const comments = new Map<string, string>();
  for (const s of secretsRaw) if (s?.name && s.comment) comments.set(String(s.name), String(s.comment));
  const active = activeRaw
    .filter((a) => a?.name)
    .map((a) => ({
      name: String(a.name),
      comment: comments.get(String(a.name)) || a.comment || null,
      address: a.address || null,
      caller_id: a['caller-id'] || null,
      uptime_s: parseUptime(a.uptime),
    }));
  return { active, comments };
}

/**
 * Agrega `pppoe` a cada cliente wireless de cada AP. `readAt` es el momento en
 * que se leyeron los APs (la lectura puede venir de caché).
 */
export async function linkApClients(
  mikrotikId: string,
  aps: Array<{ ip: string; clients: any[] }>,
  active: PppoeSession[],
  comments: Map<string, string>,
  readAt: number,
) {
  await schema();
  const { rows } = await pool.query(`SELECT mac, pppoe_user FROM ap_client_links WHERE mikrotik_id = $1`, [mikrotikId]);
  const manual = new Map<string, string>(rows.map((r: any) => [String(r.mac), String(r.pppoe_user)]));
  const byName = new Map(active.map((s) => [s.name, s]));
  const now = Date.now();

  const link = (s: PppoeSession | undefined, user: string, match: PppoeLink['match'], delta?: number): PppoeLink => ({
    user,
    comment: s?.comment ?? comments.get(user) ?? null,
    address: s?.address ?? null,
    online: !!s,
    match,
    ...(delta !== undefined ? { delta_s: delta } : {}),
  });

  const used = new Set<string>();
  const pending: any[] = [];

  for (const ap of aps) {
    for (const cl of ap.clients || []) {
      cl.pppoe = null;
      const mac = normMac(cl.mac);
      const saved = mac ? manual.get(mac) : undefined;
      if (saved) {
        cl.pppoe = link(byName.get(saved), saved, 'manual');
        used.add(saved);
        continue;
      }
      let hit = mac ? active.find((s) => normMac(s.caller_id) === mac) : undefined;
      let match: PppoeLink['match'] = 'mac';
      if (!hit && mac) { hit = active.find((s) => nearMac(normMac(s.caller_id), mac)); match = 'mac-cercana'; }
      if (!hit && cl.ip) { hit = active.find((s) => s.address === cl.ip); match = 'ip'; }
      if (hit) {
        cl.pppoe = link(hit, hit.name, match);
        used.add(hit.name);
      } else {
        pending.push(cl);
      }
    }
  }

  // Sugerencia por hora de conexión: el PPPoE debe haber subido entre 90 s
  // antes (margen de caché) y 5 min después de que la antena se asoció.
  const pairs: Array<{ cl: any; s: PppoeSession; delta: number }> = [];
  for (const cl of pending) {
    if (cl.uptime_s == null) continue;
    const linkedAt = readAt - cl.uptime_s * 1000;
    for (const s of active) {
      if (used.has(s.name) || s.uptime_s == null) continue;
      const delta = Math.round((now - s.uptime_s * 1000 - linkedAt) / 1000);
      if (delta >= -90 && delta <= 300) pairs.push({ cl, s, delta });
    }
  }
  // Se descartan las ambiguas (otro candidato a menos de 20 s): p. ej. tras
  // reiniciar un AP todos se reconectan a la vez y no se puede distinguir.
  pairs.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  const takenCl = new Set<any>();
  for (const p of pairs) {
    if (takenCl.has(p.cl) || used.has(p.s.name)) continue;
    const rivals = pairs.filter(
      (o) => o !== p && Math.abs(Math.abs(o.delta) - Math.abs(p.delta)) < 20
        && (o.cl === p.cl || o.s.name === p.s.name),
    );
    takenCl.add(p.cl);
    if (rivals.length) continue;
    p.cl.pppoe = link(p.s, p.s.name, 'sugerido', p.delta);
    used.add(p.s.name);
  }
}
