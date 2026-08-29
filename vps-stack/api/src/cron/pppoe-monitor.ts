import type { Pool } from 'pg';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';

/**
 * Monitor de sesiones PPPoE.
 * Cada ejecución compara las sesiones activas del MikroTik contra el último
 * estado conocido y registra eventos de conexión / desconexión por cliente.
 */
export async function runPppoeMonitor(pool: Pool) {
  let devices: any[] = [];
  try {
    const { rows } = await pool.query(`SELECT id FROM mikrotik_devices`);
    devices = rows;
  } catch (e: any) {
    console.error('[PPPOE MON] no se pudieron listar routers:', e.message);
    return;
  }

  for (const d of devices) {
    try {
      await monitorDevice(pool, d.id);
    } catch (e: any) {
      console.warn(`[PPPOE MON] ${d.id}: ${e.message}`);
    }
  }
}

async function monitorDevice(pool: Pool, mikrotikId: string) {
  const config = await getDeviceConfig(pool, mikrotikId);
  const raw = await mikrotikRequest(config, '/rest/ppp/active');
  const active: any[] = Array.isArray(raw) ? raw : [];

  const now = new Date();
  const current = new Map<string, any>();
  for (const s of active) {
    if (s.name) current.set(String(s.name), s);
  }

  const { rows: previous } = await pool.query(
    `SELECT username, is_online, session_id FROM pppoe_sessions WHERE mikrotik_id = $1`,
    [mikrotikId]
  );
  const prevMap = new Map<string, any>(previous.map((p: any) => [p.username, p]));

  // Conexiones nuevas o reconexiones
  for (const [username, s] of current) {
    const prev = prevMap.get(username);
    const sessionId = String(s['.id'] ?? s.session_id ?? '');
    const reconnected = !prev || !prev.is_online || (prev.session_id && prev.session_id !== sessionId);

    await pool.query(
      `INSERT INTO pppoe_sessions (mikrotik_id, username, is_online, address, caller_id, service, session_id, last_seen, last_up)
       VALUES ($1,$2,true,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (mikrotik_id, username) DO UPDATE
         SET is_online = true,
             address = EXCLUDED.address,
             caller_id = EXCLUDED.caller_id,
             service = EXCLUDED.service,
             session_id = EXCLUDED.session_id,
             last_seen = EXCLUDED.last_seen,
             last_up = CASE WHEN pppoe_sessions.is_online THEN pppoe_sessions.last_up ELSE EXCLUDED.last_up END`,
      [mikrotikId, username, s.address || null, s['caller-id'] || null, s.service || null, sessionId || null, now]
    );

    if (reconnected) {
      await pool.query(
        `INSERT INTO pppoe_events (mikrotik_id, username, event, address, caller_id, uptime, created_at)
         VALUES ($1,$2,'up',$3,$4,$5,$6)`,
        [mikrotikId, username, s.address || null, s['caller-id'] || null, s.uptime || null, now]
      );
    }
  }

  // Desconexiones
  for (const [username, prev] of prevMap) {
    if (prev.is_online && !current.has(username)) {
      await pool.query(
        `UPDATE pppoe_sessions SET is_online = false, last_down = $3, last_seen = $3
           WHERE mikrotik_id = $1 AND username = $2`,
        [mikrotikId, username, now]
      );
      await pool.query(
        `INSERT INTO pppoe_events (mikrotik_id, username, event, created_at)
         VALUES ($1,$2,'down',$3)`,
        [mikrotikId, username, now]
      );
    }
  }
}

/** Limpieza del historial de eventos PPPoE (por defecto 90 días). */
export async function cleanupPppoeEvents(pool: Pool, days = 90) {
  const { rowCount } = await pool.query(
    `DELETE FROM pppoe_events WHERE created_at < now() - ($1 || ' days')::interval`,
    [days]
  );
  return rowCount || 0;
}
