import crypto from 'crypto';
import type { Pool } from 'pg';
import { pool } from './db';
import { notifyTelegram } from './net-monitor';

/**
 * WhatsApp por ISP con Evolution API (sesión por QR, sin Meta).
 *
 * - Cada ISP tiene su sesión "wa-<slug>" y su cola (wa_queue).
 * - El despachador corre cada minuto y envía UN mensaje por ISP si ya pasó la
 *   pausa configurada (por defecto 2 min ± 30 s), dentro del horario y días
 *   permitidos y sin pasar el tope diario. Primero la prioridad más baja
 *   (pagos/reactivaciones = 1), luego los más antiguos.
 * - "Solo a quien escribió primero" (opt-in) y la palabra de baja reducen el
 *   riesgo de bloqueo: WhatsApp castiga los envíos a quien no te tiene.
 * - Evolution solo está en la red interna; avisa a la API por
 *   /api/public/whatsapp/evolution/:instancia?s=<secreto>.
 */

const EVO_URL = (process.env.EVOLUTION_URL || 'http://evolution:8080').replace(/\/$/, '');
const EVO_KEY = process.env.EVOLUTION_API_KEY || '';
const API_INTERNAL_URL = process.env.WA_WEBHOOK_BASE || 'http://api:3000';
const TZ = process.env.TZ || 'America/Bogota';

export const MAX_ATTEMPTS = 3;
const MAX_PENDING_PER_TENANT = 20000;
const MAX_SKIPS_PER_RUN = 25;

/** Eventos conocidos (los del plugin UISP) con su prioridad por defecto. */
export const EVENT_LABELS: Record<string, string> = {
  payment_confirmed: 'Pago recibido',
  service_reactivated: 'Servicio reactivado',
  service_suspended: 'Servicio suspendido',
  payment_reminder: 'Recordatorio de pago',
  invoice_created: 'Factura nueva',
  manual: 'Manual',
  test: 'Prueba',
  system: 'Sistema',
};
export const DEFAULT_PRIORITIES: Record<string, number> = {
  test: 0,
  system: 0,
  payment_confirmed: 1,
  service_reactivated: 1,
  service_suspended: 2,
  manual: 3,
  payment_reminder: 4,
  invoice_created: 5,
};
/** Estos se envían aunque el cliente no haya escrito primero o esté de baja. */
const BYPASS_OPTIN = new Set(['test', 'system']);

export interface WaSettings {
  tenant_id: string;
  enabled: boolean;
  paused: boolean;
  instance_name: string | null;
  interval_sec: number;
  jitter_sec: number;
  hour_start: number;
  hour_end: number;
  days: string;
  daily_cap: number;
  require_optin: boolean;
  optout_word: string;
  signature: string | null;
  priorities: Record<string, number>;
  alert_disconnect: boolean;
  api_key_hint: string | null;
  webhook_secret: string;
  connection_state: string;
  connected_number: string | null;
  state_changed_at: string | null;
  alerted_state: string | null;
  last_sent_at: string | null;
  next_send_at: string | null;
}

// ───────────────────────── Evolution API ─────────────────────────

export class EvolutionError extends Error {
  constructor(message: string, public status: number, public body: any) {
    super(message);
  }
}

async function evo(path: string, method = 'GET', body?: any, timeoutMs = 20_000): Promise<any> {
  if (!EVO_KEY) throw new EvolutionError('Falta EVOLUTION_API_KEY en el .env del servidor (corre update.sh)', 500, null);
  let res: Response;
  try {
    res = await fetch(`${EVO_URL}${path}`, {
      method,
      headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e: any) {
    throw new EvolutionError(`Evolution no responde (${e.message}). Revisa: docker logs omnisync-evolution`, 503, null);
  }
  const text = await res.text();
  let data: any = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* texto plano */ }
  if (!res.ok) {
    const msg = data?.response?.message ?? data?.message ?? data?.error ?? text;
    throw new EvolutionError(typeof msg === 'string' ? msg : JSON.stringify(msg), res.status, data);
  }
  return data;
}

/** La base "evolution" vive en el mismo Postgres; update.sh la crea, esto es respaldo. */
export async function ensureEvolutionDatabase(db: Pool): Promise<void> {
  const { rows } = await db.query(`SELECT 1 FROM pg_database WHERE datname = 'evolution'`);
  if (!rows.length) await db.query('CREATE DATABASE evolution');
}

// ───────────────────────── Utilidades ─────────────────────────

/** Deja solo dígitos con indicativo. 10 dígitos que empiezan por 3 = celular de Colombia. */
export function normalizePhone(raw: unknown, defaultCountry = '57'): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('3')) d = defaultCountry + d;
  if (d.length < 10 || d.length > 15) return null;
  return d;
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Hora y día de la semana en la zona del servidor (Colombia por defecto). */
function localParts(d: Date): { hour: number; day: number; dateKey: string } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value || '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    hour: Number(get('hour')) % 24,
    day: days.indexOf(get('weekday')),
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

function allowedDays(s: Pick<WaSettings, 'days'>): Set<number> {
  return new Set(String(s.days || '').split(',').map((x) => x.trim()).filter((x) => /^[0-6]$/.test(x)).map(Number));
}

export function inSendWindow(s: Pick<WaSettings, 'days' | 'hour_start' | 'hour_end'>, at = new Date()): boolean {
  const { hour, day } = localParts(at);
  return allowedDays(s).has(day) && hour >= s.hour_start && hour < s.hour_end;
}

function priorityFor(s: Pick<WaSettings, 'priorities'> | null, event: string): number {
  const custom = s?.priorities?.[event];
  if (Number.isInteger(custom) && custom >= 0 && custom <= 9) return custom;
  return DEFAULT_PRIORITIES[event] ?? 5;
}

function instanceNameFor(slug: string): string {
  return 'wa-' + (String(slug || 'isp').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 40) || 'isp');
}

// ───────────────────────── Configuración ─────────────────────────

export async function getSettings(tenantId: string): Promise<WaSettings> {
  const { rows: t } = await pool.query(`SELECT slug FROM tenants WHERE id = $1`, [tenantId]);
  if (!t[0]) throw new Error('ISP no encontrado');
  await pool.query(
    `INSERT INTO wa_settings (tenant_id, instance_name) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId, instanceNameFor(t[0].slug)]
  );
  const { rows } = await pool.query(`SELECT * FROM wa_settings WHERE tenant_id = $1`, [tenantId]);
  return rows[0];
}

/** Lo que ve el panel (sin hash de la clave ni secreto del webhook). */
export function publicSettings(s: WaSettings) {
  const { webhook_secret: _w, ...rest } = s as any;
  delete rest.api_key_hash;
  return { ...rest, has_api_key: Boolean((s as any).api_key_hash), default_priorities: DEFAULT_PRIORITIES, event_labels: EVENT_LABELS };
}

export interface SettingsInput {
  enabled?: boolean;
  interval_sec?: number;
  jitter_sec?: number;
  hour_start?: number;
  hour_end?: number;
  days?: number[] | string;
  daily_cap?: number;
  require_optin?: boolean;
  optout_word?: string;
  signature?: string | null;
  priorities?: Record<string, number>;
  alert_disconnect?: boolean;
}

/** Valida y guarda. Lanza Error con un mensaje para el usuario si algo no cuadra. */
export async function saveSettings(tenantId: string, input: SettingsInput): Promise<WaSettings> {
  const cur = await getSettings(tenantId);
  const int = (v: any, min: number, max: number, name: string, fallback: number) => {
    if (v === undefined || v === null || v === '') return fallback;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} debe estar entre ${min} y ${max}`);
    return n;
  };
  const interval = int(input.interval_sec, 30, 3600, 'La pausa entre mensajes (segundos)', cur.interval_sec);
  const jitter = int(input.jitter_sec, 0, Math.floor(interval / 2), 'La variación al azar', Math.min(cur.jitter_sec, Math.floor(interval / 2)));
  const hStart = int(input.hour_start, 0, 23, 'La hora de inicio', cur.hour_start);
  const hEnd = int(input.hour_end, 1, 24, 'La hora de fin', cur.hour_end);
  if (hEnd <= hStart) throw new Error('La hora de fin debe ser mayor que la de inicio');
  const cap = int(input.daily_cap, 1, 5000, 'El tope diario', cur.daily_cap);
  let days = cur.days;
  if (input.days !== undefined) {
    const list = (Array.isArray(input.days) ? input.days : String(input.days).split(','))
      .map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (!list.length) throw new Error('Elige al menos un día de envío');
    days = [...new Set(list)].join(',');
  }
  let word = cur.optout_word;
  if (input.optout_word !== undefined) {
    word = String(input.optout_word).trim().toUpperCase();
    if (!/^[A-ZÁÉÍÓÚÑ0-9]{2,20}$/.test(word)) throw new Error('La palabra de baja debe tener de 2 a 20 letras o números, sin espacios');
  }
  let signature = cur.signature;
  if (input.signature !== undefined) {
    signature = input.signature === null ? null : String(input.signature).slice(0, 300).trim() || null;
  }
  let priorities = cur.priorities || {};
  if (input.priorities !== undefined) {
    priorities = {};
    for (const [k, v] of Object.entries(input.priorities || {})) {
      if (!(k in DEFAULT_PRIORITIES) || BYPASS_OPTIN.has(k)) continue;
      const n = Math.round(Number(v));
      if (Number.isInteger(n) && n >= 1 && n <= 9) priorities[k] = n;
    }
  }
  const { rows } = await pool.query(
    `UPDATE wa_settings SET
       enabled = COALESCE($2::boolean, enabled), interval_sec = $3::int, jitter_sec = $4::int,
       hour_start = $5::int, hour_end = $6::int, days = $7::text, daily_cap = $8::int,
       require_optin = COALESCE($9::boolean, require_optin), optout_word = $10::text, signature = $11::text,
       priorities = $12::jsonb, alert_disconnect = COALESCE($13::boolean, alert_disconnect),
       next_send_at = CASE WHEN next_send_at > now() + make_interval(secs => $3::int + $4::int)
                           THEN now() + make_interval(secs => $3::int) ELSE next_send_at END,
       updated_at = now()
     WHERE tenant_id = $1 RETURNING *`,
    [tenantId, typeof input.enabled === 'boolean' ? input.enabled : null, interval, jitter, hStart, hEnd, days, cap,
     typeof input.require_optin === 'boolean' ? input.require_optin : null, word, signature,
     JSON.stringify(priorities), typeof input.alert_disconnect === 'boolean' ? input.alert_disconnect : null]
  );
  return rows[0];
}

/** Clave nueva para el plugin de UISP. Se muestra UNA vez; se guarda solo el hash. */
export async function regenerateApiKey(tenantId: string): Promise<string> {
  await getSettings(tenantId);
  const key = 'wa_' + crypto.randomBytes(24).toString('hex');
  await pool.query(
    `UPDATE wa_settings SET api_key_hash = $2, api_key_hint = $3, updated_at = now() WHERE tenant_id = $1`,
    [tenantId, hashApiKey(key), key.slice(0, 7) + '…' + key.slice(-4)]
  );
  return key;
}

export async function tenantByApiKey(key: string): Promise<string | null> {
  if (!key || key.length < 20) return null;
  const { rows } = await pool.query(
    `SELECT s.tenant_id FROM wa_settings s JOIN tenants t ON t.id = s.tenant_id
      WHERE s.api_key_hash = $1 AND COALESCE(t.is_active, true) AND COALESCE(t.enable_whatsapp, false)`,
    [hashApiKey(key)]
  );
  return rows[0]?.tenant_id || null;
}

// ───────────────────────── Sesión (QR) ─────────────────────────

function webhookUrl(s: WaSettings): string {
  return `${API_INTERNAL_URL}/api/public/whatsapp/evolution/${encodeURIComponent(s.instance_name!)}?s=${s.webhook_secret}`;
}

const WEBHOOK_EVENTS = ['CONNECTION_UPDATE', 'MESSAGES_UPSERT'];

async function instanceExists(name: string): Promise<boolean> {
  const list = await evo(`/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`).catch((e) => {
    if (e instanceof EvolutionError && e.status === 404) return [];
    throw e;
  });
  return Array.isArray(list) && list.length > 0;
}

/** Crea la sesión si no existe, deja el webhook apuntando a Omnisync y devuelve el QR. */
export async function connectSession(tenantId: string): Promise<{ state: string; qr: string | null; pairing_code: string | null }> {
  const s = await getSettings(tenantId);
  const name = s.instance_name!;
  if (!(await instanceExists(name))) {
    await evo('/instance/create', 'POST', {
      instanceName: name,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      rejectCall: false,
      groupsIgnore: true,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
    });
  }
  await evo(`/webhook/set/${encodeURIComponent(name)}`, 'POST', {
    webhook: { enabled: true, url: webhookUrl(s), byEvents: false, base64: false, events: WEBHOOK_EVENTS },
  }).catch((e) => console.warn(`[WA] webhook ${name}: ${e.message}`));
  const state = await refreshState(tenantId, s);
  if (state === 'open') return { state, qr: null, pairing_code: null };
  const c = await evo(`/instance/connect/${encodeURIComponent(name)}`);
  return { state, qr: c?.base64 || null, pairing_code: c?.pairingCode || null };
}

export async function logoutSession(tenantId: string): Promise<void> {
  const s = await getSettings(tenantId);
  await evo(`/instance/logout/${encodeURIComponent(s.instance_name!)}`, 'DELETE').catch((e) => {
    if (!(e instanceof EvolutionError && (e.status === 404 || e.status === 400))) throw e;
  });
  await setState(s, 'close', 'Sesión cerrada desde el panel');
}

/** Pregunta a Evolution el estado y lo guarda (con historial y aviso por Telegram). */
export async function refreshState(tenantId: string, s?: WaSettings): Promise<string> {
  s = s || (await getSettings(tenantId));
  let state = 'close';
  let number: string | null = s.connected_number;
  try {
    const r = await evo(`/instance/connectionState/${encodeURIComponent(s.instance_name!)}`, 'GET', undefined, 8000);
    state = r?.instance?.state || r?.state || 'close';
    if (state === 'open' && !number) {
      const list = await evo(`/instance/fetchInstances?instanceName=${encodeURIComponent(s.instance_name!)}`).catch(() => []);
      const owner = Array.isArray(list) ? (list[0]?.ownerJid || list[0]?.owner || list[0]?.number) : null;
      number = owner ? String(owner).split('@')[0].split(':')[0] : null;
    }
  } catch (e: any) {
    state = e instanceof EvolutionError && e.status === 404 ? 'close' : 'error';
  }
  await setState(s, state, null, number);
  return state;
}

async function setState(s: WaSettings, state: string, detail: string | null, number?: string | null): Promise<void> {
  const changed = s.connection_state !== state;
  await pool.query(
    `UPDATE wa_settings SET connection_state = $2,
       connected_number = CASE WHEN $2 = 'open' THEN COALESCE($3, connected_number) ELSE connected_number END,
       state_changed_at = CASE WHEN connection_state IS DISTINCT FROM $2 THEN now() ELSE state_changed_at END
     WHERE tenant_id = $1`,
    [s.tenant_id, state, number ?? null]
  );
  if (changed) {
    await pool.query(`INSERT INTO wa_session_events (tenant_id, state, detail) VALUES ($1, $2, $3)`, [s.tenant_id, state, detail]);
    s.state_changed_at = new Date().toISOString();
  }
  s.connection_state = state;
}

/** Aviso por Telegram si la sesión lleva >2 min caída, y cuando vuelve. */
async function alertOnState(s: WaSettings, ispName: string): Promise<void> {
  if (!s.alert_disconnect) return;
  const since = s.state_changed_at ? new Date(s.state_changed_at).getTime() : Date.now();
  const down = s.connection_state !== 'open';
  if (down && s.alerted_state !== 'down' && Date.now() - since > 120_000 && s.last_sent_at) {
    await notifyTelegram(s.tenant_id,
      `📵 <b>WhatsApp desconectado</b> — ${ispName}\nLa sesión no está conectada (${s.connection_state}). ` +
      `Los avisos quedan en cola. Entra a Omnisync → WhatsApp y vuelve a escanear el QR.`).catch(() => undefined);
    await pool.query(`UPDATE wa_settings SET alerted_state = 'down' WHERE tenant_id = $1`, [s.tenant_id]);
  } else if (!down && s.alerted_state === 'down') {
    await notifyTelegram(s.tenant_id, `✅ <b>WhatsApp conectado de nuevo</b> — ${ispName}. La cola sigue enviando.`).catch(() => undefined);
    await pool.query(`UPDATE wa_settings SET alerted_state = NULL WHERE tenant_id = $1`, [s.tenant_id]);
  }
}

// ───────────────────────── Cola ─────────────────────────

export interface EnqueueInput {
  phone: unknown;
  message: unknown;
  event?: unknown;
  client_ref?: unknown;
  dedupe_key?: unknown;
  source?: string;
}

export async function enqueue(tenantId: string, input: EnqueueInput): Promise<{ id: number | null; status: string; duplicate: boolean }> {
  const s = await getSettings(tenantId);
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error('Teléfono inválido (usa el número con indicativo, p. ej. 573001234567)');
  const message = String(input.message ?? '').trim();
  if (!message) throw new Error('El mensaje está vacío');
  if (message.length > 4000) throw new Error('El mensaje supera 4000 caracteres');
  const event = /^[a-z_]{2,40}$/.test(String(input.event ?? '')) ? String(input.event) : 'manual';
  const dedupe = input.dedupe_key ? String(input.dedupe_key).slice(0, 200) : null;

  const { rows: cnt } = await pool.query(
    `SELECT count(*)::int AS n FROM wa_queue WHERE tenant_id = $1 AND status = 'pending'`, [tenantId]
  );
  if (cnt[0].n >= MAX_PENDING_PER_TENANT) throw new Error('La cola está llena; revisa el panel de WhatsApp');

  const { rows } = await pool.query(
    `INSERT INTO wa_queue (tenant_id, phone, message, event_type, priority, source, client_ref, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id, status`,
    [tenantId, phone, message, event, priorityFor(s, event), input.source || 'api',
     input.client_ref == null ? null : String(input.client_ref).slice(0, 100), dedupe]
  );
  if (!rows[0]) return { id: null, status: 'duplicate', duplicate: true };
  return { id: Number(rows[0].id), status: rows[0].status, duplicate: false };
}

async function markSkipped(id: number, reason: string): Promise<void> {
  await pool.query(`UPDATE wa_queue SET status = 'skipped', last_error = $2, updated_at = now() WHERE id = $1`, [id, reason]);
}

function nextSendAt(s: WaSettings): Date {
  const jitter = s.jitter_sec > 0 ? Math.round((Math.random() * 2 - 1) * s.jitter_sec) : 0;
  return new Date(Date.now() + Math.max(15, s.interval_sec + jitter) * 1000);
}

/** ¿El error de Evolution dice que el número no tiene WhatsApp? */
function notOnWhatsapp(e: any): boolean {
  const msg = e?.body?.response?.message;
  if (Array.isArray(msg) && msg.some((m: any) => m && m.exists === false)) return true;
  return /exists["']?\s*:\s*false|not.*whatsapp/i.test(String(e?.message || ''));
}

/** Un intento de envío para un ISP. Devuelve lo que pasó (para logs/simulación). */
export async function dispatchTenant(s: WaSettings, ispName: string, now = new Date()): Promise<string> {
  if (!s.enabled || s.paused) return 'pausado';
  const state = await refreshState(s.tenant_id, s);
  await alertOnState(s, ispName);
  if (state !== 'open') return `sesión ${state}`;
  if (!inSendWindow(s, now)) return 'fuera de horario';
  if (s.next_send_at && new Date(s.next_send_at) > now) return 'esperando pausa';

  const { rows: today } = await pool.query(
    `SELECT count(*)::int AS n FROM wa_queue
      WHERE tenant_id = $1 AND status = 'sent' AND (sent_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`,
    [s.tenant_id, TZ]
  );
  if (today[0].n >= s.daily_cap) return 'tope diario';

  for (let i = 0; i < MAX_SKIPS_PER_RUN; i++) {
    const { rows } = await pool.query(
      `UPDATE wa_queue SET status = 'sending', updated_at = now()
        WHERE id = (SELECT id FROM wa_queue
                     WHERE tenant_id = $1 AND status = 'pending' AND not_before <= now()
                     ORDER BY priority, created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      [s.tenant_id]
    );
    const m = rows[0];
    if (!m) return 'cola vacía';

    if (!BYPASS_OPTIN.has(m.event_type)) {
      const { rows: c } = await pool.query(
        `SELECT first_inbound_at, opted_out_at, not_on_whatsapp FROM wa_contacts WHERE tenant_id = $1 AND phone = $2`,
        [s.tenant_id, m.phone]
      );
      const contact = c[0];
      if (contact?.opted_out_at) { await markSkipped(m.id, `El cliente pidió no recibir más (${s.optout_word})`); continue; }
      if (contact?.not_on_whatsapp) { await markSkipped(m.id, 'El número no tiene WhatsApp'); continue; }
      if (s.require_optin && !contact?.first_inbound_at) { await markSkipped(m.id, 'El cliente nunca escribió (opción "solo a quien escribió primero")'); continue; }
    }

    const text = s.signature ? `${m.message}\n\n${s.signature}` : m.message;
    try {
      // "delay" muestra "escribiendo…" un momento antes de enviar: más natural
      await evo(`/message/sendText/${encodeURIComponent(s.instance_name!)}`, 'POST',
        { number: m.phone, text, delay: 1200 + Math.floor(Math.random() * 1800) }, 30_000);
      await pool.query(`UPDATE wa_queue SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL, updated_at = now() WHERE id = $1`, [m.id]);
      await pool.query(`UPDATE wa_settings SET last_sent_at = now(), next_send_at = $2 WHERE tenant_id = $1`, [s.tenant_id, nextSendAt(s)]);
      return `enviado #${m.id}`;
    } catch (e: any) {
      if (notOnWhatsapp(e)) {
        await pool.query(
          `INSERT INTO wa_contacts (tenant_id, phone, not_on_whatsapp) VALUES ($1, $2, true)
           ON CONFLICT (tenant_id, phone) DO UPDATE SET not_on_whatsapp = true`,
          [s.tenant_id, m.phone]
        );
        await markSkipped(m.id, 'El número no tiene WhatsApp');
        continue;
      }
      const attempts = Number(m.attempts) + 1;
      await pool.query(
        `UPDATE wa_queue SET status = $2, attempts = $3, last_error = $4,
           not_before = now() + make_interval(mins => $5::int), updated_at = now() WHERE id = $1`,
        [m.id, attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, String(e.message || e).slice(0, 500), 5 * attempts]
      );
      // Tras un error también se respeta la pausa: no martillar a WhatsApp
      await pool.query(`UPDATE wa_settings SET next_send_at = $2 WHERE tenant_id = $1`, [s.tenant_id, nextSendAt(s)]);
      return `error #${m.id}: ${e.message}`;
    }
  }
  return 'muchos omitidos; sigue en la próxima vuelta';
}

let running = false;

/** Cron cada minuto: un envío como máximo por ISP con el módulo activo. */
export async function runWhatsappDispatcher(): Promise<void> {
  if (running || !EVO_KEY) return;
  running = true;
  try {
    // Mensajes que quedaron "enviando" por un reinicio vuelven a la cola
    await pool.query(`UPDATE wa_queue SET status = 'pending', updated_at = now() WHERE status = 'sending' AND updated_at < now() - interval '10 minutes'`);
    const { rows } = await pool.query(
      `SELECT s.*, t.name AS isp_name FROM wa_settings s JOIN tenants t ON t.id = s.tenant_id
        WHERE s.enabled AND COALESCE(t.enable_whatsapp, false) AND COALESCE(t.is_active, true)`
    );
    for (const s of rows) {
      try {
        const r = await dispatchTenant(s, s.isp_name);
        if (r.startsWith('enviado') || r.startsWith('error')) console.log(`[WA] ${s.isp_name}: ${r}`);
      } catch (e: any) {
        console.error(`[WA] ${s.isp_name}:`, e.message);
      }
    }
  } finally {
    running = false;
  }
}

/** Limpieza diaria: historial de más de 90 días. */
export async function cleanupWhatsapp(): Promise<number> {
  const a = await pool.query(`DELETE FROM wa_queue WHERE status IN ('sent','skipped','cancelled','failed') AND created_at < now() - interval '90 days'`);
  await pool.query(`DELETE FROM wa_session_events WHERE at < now() - interval '90 days'`);
  return a.rowCount || 0;
}

// ───────────────────────── Eventos de Evolution ─────────────────────────

function inboundPhone(key: any): string | null {
  const candidates = [key?.senderPn, key?.remoteJidAlt, key?.participantPn, key?.remoteJid];
  for (const c of candidates) {
    if (typeof c === 'string' && c.endsWith('@s.whatsapp.net')) return normalizePhone(c.split('@')[0].split(':')[0]);
  }
  return null;
}

function messageText(msg: any): string {
  return String(msg?.conversation ?? msg?.extendedTextMessage?.text ?? msg?.buttonsResponseMessage?.selectedDisplayText ?? '').trim();
}

/** Webhook interno de Evolution: conexión y mensajes que escriben los clientes. */
export async function handleEvolutionEvent(instance: string, secret: string, body: any): Promise<boolean> {
  const { rows } = await pool.query(`SELECT s.*, t.name AS isp_name FROM wa_settings s JOIN tenants t ON t.id = s.tenant_id WHERE s.instance_name = $1`, [instance]);
  const s: WaSettings & { isp_name: string } = rows[0];
  if (!s || !secret || !safeEqual(secret, s.webhook_secret)) return false;
  const event = String(body?.event || '').toLowerCase().replace(/_/g, '.');
  const data = body?.data || {};

  if (event === 'connection.update') {
    const state = String(data.state || 'close');
    const number = data.wuid ? String(data.wuid).split('@')[0].split(':')[0] : null;
    await setState(s, state, data.statusReason ? `Motivo ${data.statusReason}` : null, number);
    return true;
  }

  if (event === 'messages.upsert') {
    const items = Array.isArray(data) ? data : [data];
    for (const it of items) {
      if (it?.key?.fromMe) continue;
      if (String(it?.key?.remoteJid || '').endsWith('@g.us')) continue; // grupos no
      const phone = inboundPhone(it?.key);
      if (!phone) continue;
      const text = messageText(it?.message).toUpperCase();
      const optOut = text === s.optout_word;
      const optIn = text === 'ALTA';
      await pool.query(
        `INSERT INTO wa_contacts (tenant_id, phone, first_inbound_at, last_inbound_at, opted_out_at)
         VALUES ($1, $2, now(), now(), CASE WHEN $3 THEN now() END)
         ON CONFLICT (tenant_id, phone) DO UPDATE SET
           first_inbound_at = COALESCE(wa_contacts.first_inbound_at, now()),
           last_inbound_at = now(), not_on_whatsapp = false,
           opted_out_at = CASE WHEN $3 THEN now() WHEN $4 THEN NULL ELSE wa_contacts.opted_out_at END`,
        [s.tenant_id, phone, optOut, optIn]
      );
      if (optOut || optIn) {
        await enqueue(s.tenant_id, {
          phone, event: 'system', source: 'auto',
          message: optOut
            ? `Listo, no te enviaremos más avisos por este medio. Si cambias de opinión escribe ALTA.`
            : `¡Listo! Volverás a recibir tus avisos por WhatsApp. Para dejar de recibirlos escribe ${s.optout_word}.`,
        }).catch(() => undefined);
      }
    }
    return true;
  }
  return true;
}

// ───────────────────────── Estadísticas y recomendaciones ─────────────────────────

/**
 * Cuándo terminaría de salir la cola con la configuración actual (simulación:
 * pausa promedio, horario, días y tope diario). null si no termina en 60 días.
 */
export function estimateFinish(
  pending: number,
  s: Pick<WaSettings, 'interval_sec' | 'hour_start' | 'hour_end' | 'days' | 'daily_cap' | 'next_send_at'>,
  sentToday: number,
  now = new Date()
): Date | null {
  if (pending <= 0) return now;
  const days = allowedDays(s);
  if (!days.size) return null;
  let t = new Date(Math.max(now.getTime(), s.next_send_at ? new Date(s.next_send_at).getTime() : 0));
  let dayKey = localParts(t).dateKey;
  let countToday = dayKey === localParts(now).dateKey ? sentToday : 0;
  const limit = now.getTime() + 60 * 86400_000;
  let left = pending;
  while (left > 0) {
    if (t.getTime() > limit) return null;
    const p = localParts(t);
    if (p.dateKey !== dayKey) { dayKey = p.dateKey; countToday = 0; }
    if (!days.has(p.day) || p.hour >= s.hour_end || countToday >= s.daily_cap) {
      // al siguiente día, a la hora de inicio (pasos de 1 h para no depender de cambios de hora)
      t = new Date(t.getTime() + 3600_000);
      while (localParts(t).hour !== s.hour_start) t = new Date(t.getTime() + 3600_000);
      t = new Date(Math.floor(t.getTime() / 3600_000) * 3600_000);
      continue;
    }
    if (p.hour < s.hour_start) {
      t = new Date(t.getTime() + 3600_000);
      t = new Date(Math.floor(t.getTime() / 3600_000) * 3600_000);
      continue;
    }
    left--; countToday++;
    if (left > 0) t = new Date(t.getTime() + s.interval_sec * 1000);
  }
  return t;
}

export type RiskLevel = 'ok' | 'info' | 'warn' | 'high';
export interface Recommendation { level: RiskLevel; title: string; detail: string }

export interface WaMetrics {
  avg_sent_per_day_7d: number;
  max_sent_day_30d: number;
  pending: number;
  eta: Date | null;
  failure_rate_7d: number;      // 0..1 sobre intentos terminados
  non_optin_share_30d: number;  // 0..1 de destinatarios enviados que nunca escribieron
  not_on_wa_share_30d: number;  // 0..1 de omitidos por no tener WhatsApp
  optout_share_30d: number;     // 0..1 de destinatarios que pidieron la baja
  disconnects_7d: number;
  cap_hits_7d: number;
}

const RANK: Record<RiskLevel, number> = { ok: 0, info: 1, warn: 2, high: 3 };

/** Reglas de recomendación (puras, se pueden probar sin base). */
export function recommend(s: Pick<WaSettings, 'interval_sec' | 'require_optin' | 'hour_start' | 'hour_end' | 'daily_cap'>, m: WaMetrics, now = new Date()): { risk: RiskLevel; items: Recommendation[] } {
  const items: Recommendation[] = [];
  const fmt = (d: Date) => d.toLocaleString('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  if (m.pending > 0) {
    if (!m.eta) {
      items.push({ level: 'high', title: 'La cola no alcanza a salir', detail: `Hay ${m.pending} mensajes en cola y con la configuración actual no terminarían en 60 días. Revisa el horario, los días y el tope diario.` });
    } else if (localParts(m.eta).dateKey !== localParts(now).dateKey) {
      items.push({ level: 'warn', title: 'La cola terminará otro día', detail: `Hay ${m.pending} mensajes en cola; con la pausa de ${Math.round(s.interval_sec / 60 * 10) / 10} min terminarán el ${fmt(m.eta)}; si son facturas, considera enviarlas por correo o no mandar recordatorios ese día. No bajes la pausa: sube el riesgo de bloqueo.` });
    }
  }
  if (s.interval_sec < 60) {
    items.push({ level: 'high', title: 'Pausa muy corta', detail: `Enviar cada ${s.interval_sec} s parece un robot para WhatsApp. Usa 2 minutos o más.` });
  } else if (s.interval_sec < 90) {
    items.push({ level: 'warn', title: 'Pausa corta', detail: 'Menos de 90 s entre mensajes aumenta el riesgo. Lo recomendado son 2 minutos con variación al azar.' });
  }
  if (m.avg_sent_per_day_7d > 500) {
    items.push({ level: 'high', title: 'Volumen alto para WhatsApp por QR', detail: `Promedio de ${Math.round(m.avg_sent_per_day_7d)} mensajes al día. Con este volumen conviene la API oficial de Meta (se paga por conversación, sin riesgo de bloqueo).` });
  } else if (m.avg_sent_per_day_7d > 200) {
    items.push({ level: 'warn', title: 'Volumen considerable', detail: `Promedio de ${Math.round(m.avg_sent_per_day_7d)} mensajes al día. Manténlo así solo si el número tiene meses de uso y los clientes te escriben; ten un segundo chip calentado de respaldo.` });
  }
  if (m.max_sent_day_30d > 300) {
    items.push({ level: 'info', title: 'Picos de envío', detail: `El día con más envíos del último mes llegó a ${m.max_sent_day_30d}. Si es el día de facturación, reparte la generación de facturas en varios días.` });
  }
  if (!s.require_optin && m.non_optin_share_30d > 0.3) {
    items.push({ level: 'high', title: 'Muchos destinatarios nunca te escribieron', detail: `${pct(m.non_optin_share_30d)} de los mensajes fueron a números que nunca te escribieron. Es la causa más común de bloqueo: activa "solo a quien escribió primero" y pide a tus clientes que te escriban (pon el número en la factura).` });
  } else if (!s.require_optin && m.non_optin_share_30d > 0.1) {
    items.push({ level: 'warn', title: 'Envíos a quien no te escribió', detail: `${pct(m.non_optin_share_30d)} de los mensajes fueron a números que nunca te escribieron.` });
  }
  if (m.failure_rate_7d > 0.1) {
    items.push({ level: 'warn', title: 'Muchos envíos fallan', detail: `${pct(m.failure_rate_7d)} de los envíos de la semana fallaron. Revisa la conexión y los teléfonos de los clientes en el CRM.` });
  }
  if (m.not_on_wa_share_30d > 0.05) {
    items.push({ level: 'info', title: 'Teléfonos sin WhatsApp', detail: `${pct(m.not_on_wa_share_30d)} de los mensajes iban a números sin WhatsApp. Corrige esos teléfonos en el CRM.` });
  }
  if (m.optout_share_30d > 0.02) {
    items.push({ level: 'warn', title: 'Clientes pidiendo la baja', detail: `${pct(m.optout_share_30d)} de los destinatarios escribió la palabra de baja. Revisa el tono y la cantidad de avisos: las bajas y reportes llevan a bloqueos.` });
  }
  if (m.disconnects_7d >= 3) {
    items.push({ level: 'high', title: 'La sesión se cae seguido', detail: `${m.disconnects_7d} desconexiones esta semana. Puede ser un aviso de WhatsApp antes de un bloqueo: baja el volumen unos días y revisa el teléfono vinculado.` });
  }
  if (m.cap_hits_7d > 0) {
    items.push({ level: 'info', title: 'Se alcanzó el tope diario', detail: `${m.cap_hits_7d} día(s) de esta semana llegaron al tope de ${s.daily_cap}. Lo que falte sale al día siguiente.` });
  }
  if (s.hour_start < 7 || s.hour_end > 21) {
    items.push({ level: 'info', title: 'Horario amplio', detail: 'Mensajes muy temprano o de noche generan reportes. Lo recomendado es de 7 a. m. a 8 p. m.' });
  }
  if (!items.length) {
    items.push({ level: 'ok', title: 'Volumen saludable', detail: 'La cola va al día y el ritmo de envío es seguro.' });
  }
  items.sort((a, b) => RANK[b.level] - RANK[a.level]);
  const risk = items.reduce<RiskLevel>((r, i) => (RANK[i.level] > RANK[r] ? i.level : r), 'ok');
  return { risk: risk === 'info' ? 'ok' : risk, items };
}

export async function getStats(tenantId: string, days = 30) {
  days = Math.min(90, Math.max(7, Math.round(days) || 30));
  const s = await getSettings(tenantId);
  const q = (sql: string, params: any[] = []) => pool.query(sql, [tenantId, TZ, ...params]).then((r) => r.rows);

  const [totals, perDay, perHour, byEvent, contacts, disc, nonOptin] = await Promise.all([
    q(`SELECT
         count(*) FILTER (WHERE status = 'pending')::int AS pending,
         count(*) FILTER (WHERE status = 'sent' AND (sent_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date)::int AS sent_today,
         count(*) FILTER (WHERE (created_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date)::int AS queued_today,
         count(*) FILTER (WHERE status = 'sent' AND sent_at > now() - interval '7 days')::int AS sent_7d,
         count(*) FILTER (WHERE status = 'sent' AND sent_at > now() - interval '30 days')::int AS sent_30d,
         count(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '7 days')::int AS failed_7d,
         count(*) FILTER (WHERE status = 'skipped' AND updated_at > now() - interval '30 days')::int AS skipped_30d,
         count(*) FILTER (WHERE status = 'skipped' AND last_error LIKE '%no tiene WhatsApp%' AND updated_at > now() - interval '30 days')::int AS not_on_wa_30d,
         count(*) FILTER (WHERE status IN ('sent','skipped','failed') AND updated_at > now() - interval '30 days')::int AS finished_30d,
         count(*) FILTER (WHERE status IN ('sent','failed') AND updated_at > now() - interval '7 days')::int AS attempted_7d
       FROM wa_queue WHERE tenant_id = $1`),
    q(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
              count(w.*) FILTER (WHERE w.status = 'sent')::int AS sent,
              count(w.*) FILTER (WHERE w.status = 'failed')::int AS failed,
              count(w.*) FILTER (WHERE w.status = 'skipped')::int AS skipped
         FROM generate_series((now() AT TIME ZONE $2)::date - ($3::int - 1), (now() AT TIME ZONE $2)::date, interval '1 day') d
         LEFT JOIN wa_queue w ON w.tenant_id = $1
              AND (COALESCE(w.sent_at, w.updated_at) AT TIME ZONE $2)::date = d::date
              AND w.status IN ('sent','failed','skipped')
        GROUP BY d ORDER BY d`, [days]),
    q(`SELECT extract(hour FROM sent_at AT TIME ZONE $2)::int AS hour, count(*)::int AS sent
         FROM wa_queue WHERE tenant_id = $1 AND status = 'sent' AND sent_at > now() - interval '7 days'
        GROUP BY 1 ORDER BY 1`),
    q(`SELECT event_type, count(*) FILTER (WHERE status = 'sent')::int AS sent, count(*) FILTER (WHERE status = 'pending')::int AS pending
         FROM wa_queue WHERE tenant_id = $1 AND $2::text IS NOT NULL AND created_at > now() - interval '30 days'
        GROUP BY 1 ORDER BY 2 DESC`),
    q(`SELECT count(*) FILTER (WHERE first_inbound_at IS NOT NULL)::int AS optin,
              count(*) FILTER (WHERE opted_out_at IS NOT NULL)::int AS optout,
              count(*) FILTER (WHERE opted_out_at > now() - interval '30 days')::int AS optout_30d
         FROM wa_contacts WHERE tenant_id = $1 AND $2::text IS NOT NULL`),
    q(`SELECT count(*)::int AS n FROM wa_session_events
        WHERE tenant_id = $1 AND $2::text IS NOT NULL AND state <> 'open' AND at > now() - interval '7 days'`),
    q(`SELECT count(DISTINCT w.phone)::int AS recipients,
              count(DISTINCT w.phone) FILTER (WHERE c.first_inbound_at IS NULL)::int AS without_optin
         FROM wa_queue w LEFT JOIN wa_contacts c ON c.tenant_id = w.tenant_id AND c.phone = w.phone
        WHERE w.tenant_id = $1 AND $2::text IS NOT NULL AND w.status = 'sent' AND w.sent_at > now() - interval '30 days'`),
  ]);

  const t = totals[0];
  const last7 = perDay.slice(-7);
  const metrics: WaMetrics = {
    avg_sent_per_day_7d: last7.reduce((a: number, d: any) => a + d.sent, 0) / 7,
    max_sent_day_30d: perDay.slice(-30).reduce((a: number, d: any) => Math.max(a, d.sent), 0),
    pending: t.pending,
    eta: estimateFinish(t.pending, s, t.sent_today),
    failure_rate_7d: t.attempted_7d ? t.failed_7d / t.attempted_7d : 0,
    non_optin_share_30d: nonOptin[0].recipients ? nonOptin[0].without_optin / nonOptin[0].recipients : 0,
    not_on_wa_share_30d: t.finished_30d ? t.not_on_wa_30d / t.finished_30d : 0,
    optout_share_30d: nonOptin[0].recipients ? contacts[0].optout_30d / nonOptin[0].recipients : 0,
    disconnects_7d: disc[0].n,
    cap_hits_7d: last7.filter((d: any) => d.sent >= s.daily_cap).length,
  };
  const rec = recommend(s, metrics);
  return {
    totals: t,
    per_day: perDay,
    per_hour: Array.from({ length: 24 }, (_, h) => ({ hour: h, sent: perHour.find((r: any) => r.hour === h)?.sent || 0 })),
    by_event: byEvent.map((r: any) => ({ ...r, label: EVENT_LABELS[r.event_type] || r.event_type })),
    contacts: contacts[0],
    metrics: { ...metrics, eta: metrics.eta ? metrics.eta.toISOString() : null },
    risk: rec.risk,
    recommendations: rec.items,
    session: { state: s.connection_state, number: s.connected_number, since: s.state_changed_at },
    settings: { interval_sec: s.interval_sec, hour_start: s.hour_start, hour_end: s.hour_end, daily_cap: s.daily_cap, paused: s.paused, enabled: s.enabled },
  };
}

/** Resumen de todos los ISP con el módulo activo (solo super admin). */
export async function getOverview() {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, COALESCE(t.enable_whatsapp, false) AS module, s.enabled, s.paused,
            s.connection_state, s.connected_number, s.interval_sec, s.daily_cap,
            (SELECT count(*) FROM wa_queue w WHERE w.tenant_id = t.id AND w.status = 'pending')::int AS pending,
            (SELECT count(*) FROM wa_queue w WHERE w.tenant_id = t.id AND w.status = 'sent' AND w.sent_at > now() - interval '24 hours')::int AS sent_24h,
            (SELECT count(*) FROM wa_queue w WHERE w.tenant_id = t.id AND w.status = 'failed' AND w.updated_at > now() - interval '7 days')::int AS failed_7d
       FROM tenants t LEFT JOIN wa_settings s ON s.tenant_id = t.id
      WHERE COALESCE(t.enable_whatsapp, false) OR s.tenant_id IS NOT NULL
      ORDER BY t.name`
  );
  return rows;
}
