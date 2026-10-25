import crypto from 'crypto';
import type { Pool } from 'pg';
import { pool } from './db';

/**
 * WhatsApp por ISP con Evolution API (sesión por QR, sin Meta).
 *
 * - Un ISP puede tener varios números (uno por organización de UISP); cada
 *   número es una sesión "wa-<slug>[-n]" con su ritmo, firma, menú y QR de pago.
 * - Permiso primero: al primer aviso de un cliente se le manda la PRESENTACIÓN
 *   (responde SÍ o NO). El aviso espera ("waiting") hasta que acepte; si dice
 *   NO o no responde en N días, no se le vuelve a escribir. Los suscritos
 *   siempre ven cómo darse de BAJA. Pocas presentaciones al día por número.
 * - El despachador corre cada minuto: por número, primero respuestas y
 *   confirmaciones (inmediatas), luego un aviso o una presentación si ya pasó
 *   la pausa (2 min ± 30 s por defecto), en horario y sin pasar los topes.
 * - Menú del aviso de factura (1 vencimiento, 2 saldo, 3 medios de pago con
 *   la imagen del QR, 4 soporte) con los datos que manda el plugin de UISP.
 * - Evolution solo está en la red interna; avisa a la API por
 *   /api/public/whatsapp/evolution/:instancia?s=<secreto del número>.
 */

const EVO_URL = (process.env.EVOLUTION_URL || 'http://evolution:8080').replace(/\/$/, '');
const EVO_KEY = process.env.EVOLUTION_API_KEY || '';
const API_INTERNAL_URL = process.env.WA_WEBHOOK_BASE || 'http://api:3000';
const TZ = process.env.TZ || 'America/Bogota';

export const MAX_ATTEMPTS = 3;
const MAX_PENDING_PER_TENANT = 20000;
const MAX_SKIPS_PER_RUN = 25;
const MAX_IMMEDIATE_PER_RUN = 5;
const MAX_QR_BYTES = 1_500_000;

/** Eventos conocidos (los del plugin UISP) con su prioridad por defecto. */
export const EVENT_LABELS: Record<string, string> = {
  payment_confirmed: 'Pago recibido',
  service_reactivated: 'Servicio reactivado',
  service_suspended: 'Servicio suspendido',
  payment_reminder: 'Recordatorio de pago',
  invoice_created: 'Factura nueva',
  welcome: 'Bienvenida (cliente nuevo)',
  manual: 'Manual',
};
export const DEFAULT_PRIORITIES: Record<string, number> = {
  payment_confirmed: 1,
  service_reactivated: 1,
  service_suspended: 2,
  manual: 3,
  payment_reminder: 4,
  invoice_created: 5,
  welcome: 1,
};
/** Mensajes que salen de inmediato (no esperan la pausa ni el horario). */
const IMMEDIATE_KINDS = ['reply', 'system', 'test'];

export const DEFAULT_INVITE_TEMPLATE =
  'Hola {nombre}, te escribe *{organizacion}*. Por este medio te enviaremos tus facturas, ' +
  'la confirmación de tus pagos y avisos de tu servicio.\n\nResponde *SÍ* para recibirlos o *NO* si prefieres no recibirlos.';
/** Al registrar al cliente en el CRM (el técnico está con él): bienvenida que pide el SÍ. */
export const DEFAULT_WELCOME_TEMPLATE =
  '¡Hola {nombre}! Bienvenido a *{organizacion}* 🎉 Tu servicio quedó registrado.\n\n' +
  'Por este medio te enviaremos tus facturas, la confirmación de tus pagos y avisos de tu servicio. ' +
  'Responde *SÍ* para recibirlos o *NO* si prefieres no recibirlos.';
export const DEFAULT_INVOICE_TEMPLATE =
  '📄 Hola {nombre}, tu factura de {mes} está lista.\n\nResponde con un número:\n{menu}';

export interface MenuOption {
  key: string;
  label: string;
  reply: string;
  /** Respuesta si el cliente no debe nada (opción de saldo) */
  reply_paid?: string;
  /** 'qr' = adjunta la imagen del QR de pago del número */
  media?: 'qr' | null;
  /** Avisa por WhatsApp al administrador que el cliente pidió un asesor */
  support?: boolean;
}
export const DEFAULT_MENU: MenuOption[] = [
  { key: '1', label: 'Fecha de vencimiento', reply: '🗓️ Tu factura {numero_factura} vence el *{fecha_vencimiento}*.' },
  { key: '2', label: 'Saldo a pagar', reply: '💰 Tu saldo a pagar es *{saldo}*.', reply_paid: '✅ ¡Estás al día! No tienes saldo pendiente.' },
  { key: '3', label: 'Medios de pago', reply: '💳 Así puedes pagar:\n{medios_pago}\nEn línea: {link_pago}', media: 'qr' },
  { key: '4', label: 'Hablar con soporte', reply: '🙋 Listo, un asesor te escribirá pronto por este chat.', support: true },
];
const NO_DATA_REPLY = 'Por ahora no tengo los datos de tu factura. Responde con el número de soporte para que un asesor te ayude.';

export interface WaSettings {
  tenant_id: string;
  enabled: boolean;
  paused: boolean;
  hour_start: number;
  hour_end: number;
  days: string;
  priorities: Record<string, number>;
  alert_disconnect: boolean;
  api_key_hint: string | null;
  optout_word: string;
  optin_words: string;
  decline_words: string;
  optin_any_message: boolean;
  require_crm_link: boolean;
  admin_phone: string | null;
  invite_wait_days: number;
  footer: string;
}

export interface WaNumber {
  id: number;
  tenant_id: string;
  label: string;
  display_name: string | null;
  instance_name: string;
  is_default: boolean;
  paused: boolean;
  interval_sec: number;
  jitter_sec: number;
  daily_cap: number;
  invite_daily_cap: number;
  signature: string | null;
  invite_template: string | null;
  invoice_template: string | null;
  welcome_template: string | null;
  support_phone: string | null;
  menu: MenuOption[] | null;
  payment_link: string | null;
  payment_info: string | null;
  qr_image: string | null;
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

/** Primera palabra en mayúsculas, sin tildes ni signos: "Sí, gracias" → "SI". */
export function firstWord(text: string): string {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim().split(/\s+/)[0] || '';
}

const wordList = (s: string) => new Set(String(s || '').split(',').map((w) => firstWord(w)).filter(Boolean));

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
  if (Number.isInteger(custom) && custom >= 1 && custom <= 9) return custom;
  return DEFAULT_PRIORITIES[event] ?? 5;
}

const slugify = (s: string) => String(s || 'isp').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'isp';

// ───────────────────────── Plantillas ─────────────────────────

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function parseDay(v: any): Date | null {
  if (!v) return null;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatMoney(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return '$' + Math.round(n).toLocaleString('es-CO');
}

function firstName(name: any): string {
  const w = String(name || '').trim().split(/\s+/)[0] || '';
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '';
}

export interface InvoiceContext {
  invoice_number?: string;
  due_date?: string;
  amount?: number;
  balance?: number;
  month?: string;
}

/** Variables disponibles en todas las plantillas. */
export function templateVars(n: Partial<WaNumber>, s: Partial<WaSettings>, sub: { client_name?: string | null; context?: InvoiceContext | null } | null, menuText = ''): Record<string, string> {
  const ctx = sub?.context || {};
  const due = parseDay(ctx.due_date);
  const monthSrc = ctx.month ? null : due || new Date();
  return {
    nombre: firstName(sub?.client_name),
    organizacion: n.display_name || n.label || '',
    numero_factura: ctx.invoice_number ? `N° ${ctx.invoice_number}` : '',
    fecha_vencimiento: due ? due.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }) : '',
    saldo: ctx.balance !== undefined && ctx.balance !== null ? formatMoney(ctx.balance) : '',
    valor: ctx.amount !== undefined && ctx.amount !== null ? formatMoney(ctx.amount) : '',
    mes: ctx.month ? String(ctx.month) : MONTHS[monthSrc!.getMonth()],
    medios_pago: n.payment_info || '',
    link_pago: n.payment_link || '',
    baja: s.optout_word || 'BAJA',
    menu: menuText,
  };
}

/**
 * Reemplaza {variables}. Una línea con una variable vacía se quita (salvo
 * {nombre}, que solo limpia la coma: "Hola ," → "Hola,").
 */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return String(tpl || '').split('\n').map((line) => {
    let drop = false;
    const out = line.replace(/\{([a-z_]+)\}/g, (m, k) => {
      if (!(k in vars)) return m;
      if (!vars[k] && k !== 'nombre') drop = true;
      return vars[k];
    });
    return drop ? null : out.replace(/\s+([,!])/g, '$1').replace(/ {2,}/g, ' ');
  }).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const menuOf = (n: Partial<WaNumber>): MenuOption[] => (Array.isArray(n.menu) && n.menu.length ? n.menu : DEFAULT_MENU);
const menuText = (n: Partial<WaNumber>) => menuOf(n).map((o) => `*${o.key}* · ${o.label}`).join('\n');

/** Texto de la respuesta a una opción del menú (null = no es una opción). */
export function menuReply(n: Partial<WaNumber>, s: Partial<WaSettings>, sub: any, text: string): { option: MenuOption; message: string } | null {
  const t = String(text || '').trim();
  const option = menuOf(n).find((o) => o.key === t || firstWord(o.key) === firstWord(t) && firstWord(t) !== '');
  if (!option) return null;
  const ctx: InvoiceContext = sub?.context || {};
  const needsDue = option.reply.includes('{fecha_vencimiento}');
  const needsBalance = option.reply.includes('{saldo}');
  if (needsBalance && ctx.balance !== undefined && ctx.balance !== null && Number(ctx.balance) <= 0 && option.reply_paid) {
    return { option, message: renderTemplate(option.reply_paid, templateVars(n, s, sub)) };
  }
  if ((needsDue && !ctx.due_date) || (needsBalance && (ctx.balance === undefined || ctx.balance === null))) {
    return { option, message: NO_DATA_REPLY };
  }
  return { option, message: renderTemplate(option.reply, templateVars(n, s, sub)) };
}

// ───────────────────────── Configuración del ISP ─────────────────────────

export async function getSettings(tenantId: string): Promise<WaSettings> {
  await pool.query(`INSERT INTO wa_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
  const { rows } = await pool.query(`SELECT * FROM wa_settings WHERE tenant_id = $1`, [tenantId]);
  if (!rows[0]) throw new Error('ISP no encontrado');
  await ensureDefaultNumber(tenantId);
  return rows[0];
}

export function publicSettings(s: WaSettings & Record<string, any>) {
  const { api_key_hash, ...rest } = s;
  return { ...rest, has_api_key: Boolean(api_key_hash), default_priorities: DEFAULT_PRIORITIES, event_labels: EVENT_LABELS };
}

export interface SettingsInput {
  enabled?: boolean;
  hour_start?: number;
  hour_end?: number;
  days?: number[] | string;
  priorities?: Record<string, number>;
  alert_disconnect?: boolean;
  optout_word?: string;
  optin_words?: string;
  decline_words?: string;
  optin_any_message?: boolean;
  invite_wait_days?: number;
  require_crm_link?: boolean;
  admin_phone?: string | null;
  footer?: string;
}

const intIn = (v: any, min: number, max: number, name: string, fallback: number) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} debe estar entre ${min} y ${max}`);
  return n;
};

function wordsInput(v: any, fallback: string, name: string): string {
  if (v === undefined) return fallback;
  const list = [...wordList(String(v))];
  if (!list.length || list.some((w) => w.length > 20)) throw new Error(`${name}: escribe palabras separadas por coma`);
  return list.join(',');
}

export async function saveSettings(tenantId: string, input: SettingsInput): Promise<WaSettings> {
  const cur = await getSettings(tenantId);
  const hStart = intIn(input.hour_start, 0, 23, 'La hora de inicio', cur.hour_start);
  const hEnd = intIn(input.hour_end, 1, 24, 'La hora de fin', cur.hour_end);
  if (hEnd <= hStart) throw new Error('La hora de fin debe ser mayor que la de inicio');
  let days = cur.days;
  if (input.days !== undefined) {
    const list = (Array.isArray(input.days) ? input.days : String(input.days).split(','))
      .map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (!list.length) throw new Error('Elige al menos un día de envío');
    days = [...new Set(list)].join(',');
  }
  const optout = input.optout_word === undefined ? cur.optout_word : firstWord(String(input.optout_word));
  if (!/^[A-Z0-9]{2,20}$/.test(optout)) throw new Error('La palabra de baja debe tener de 2 a 20 letras o números, sin espacios');
  const optin = wordsInput(input.optin_words, cur.optin_words, 'Palabras para aceptar');
  const decline = wordsInput(input.decline_words, cur.decline_words, 'Palabras para rechazar');
  const clash = [...wordList(optin)].find((w) => wordList(decline).has(w) || w === optout);
  if (clash) throw new Error(`La palabra ${clash} no puede servir para aceptar y para rechazar o dar de baja`);
  const wait = intIn(input.invite_wait_days, 1, 30, 'Los días de espera de la respuesta', cur.invite_wait_days);
  let footer = cur.footer;
  if (input.footer !== undefined) footer = String(input.footer).slice(0, 200).trim();
  if (footer && !footer.includes('{baja}')) throw new Error('El pie debe incluir {baja} para que el cliente sepa cómo darse de baja');
  // WhatsApp del administrador (avisos: soporte, vinculaciones, número caído). Vacío = sin avisos
  let adminPhone: string | null | undefined;
  if (input.admin_phone !== undefined) {
    const raw = String(input.admin_phone ?? '').trim();
    adminPhone = raw === '' ? null : normalizePhone(raw);
    if (raw !== '' && !adminPhone) throw new Error('El WhatsApp del administrador no es un teléfono válido');
  }
  let priorities = cur.priorities || {};
  if (input.priorities !== undefined) {
    priorities = {};
    for (const [k, v] of Object.entries(input.priorities || {})) {
      if (!(k in DEFAULT_PRIORITIES)) continue;
      const n = Math.round(Number(v));
      if (Number.isInteger(n) && n >= 1 && n <= 9) priorities[k] = n;
    }
  }
  const { rows } = await pool.query(
    `UPDATE wa_settings SET
       enabled = COALESCE($2::boolean, enabled), hour_start = $3::int, hour_end = $4::int, days = $5::text,
       priorities = $6::jsonb, alert_disconnect = COALESCE($7::boolean, alert_disconnect),
       optout_word = $8::text, optin_words = $9::text, decline_words = $10::text,
       optin_any_message = COALESCE($11::boolean, optin_any_message), invite_wait_days = $12::int,
       footer = $13::text, require_crm_link = COALESCE($14::boolean, require_crm_link),
       admin_phone = CASE WHEN $15::boolean THEN $16::text ELSE admin_phone END, updated_at = now()
     WHERE tenant_id = $1 RETURNING *`,
    [tenantId, typeof input.enabled === 'boolean' ? input.enabled : null, hStart, hEnd, days, JSON.stringify(priorities),
     typeof input.alert_disconnect === 'boolean' ? input.alert_disconnect : null, optout, optin, decline,
     typeof input.optin_any_message === 'boolean' ? input.optin_any_message : null, wait, footer,
     typeof input.require_crm_link === 'boolean' ? input.require_crm_link : null,
     adminPhone !== undefined, adminPhone ?? null]
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

// ───────────────────────── Números ─────────────────────────

async function uniqueInstanceName(base: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const name = i === 0 ? base : `${base}-${i + 1}`;
    const { rows } = await pool.query(`SELECT 1 FROM wa_numbers WHERE instance_name = $1`, [name]);
    if (!rows.length) return name;
  }
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

export async function ensureDefaultNumber(tenantId: string): Promise<WaNumber> {
  const { rows } = await pool.query(`SELECT * FROM wa_numbers WHERE tenant_id = $1 ORDER BY is_default DESC, id LIMIT 1`, [tenantId]);
  if (rows[0]) {
    if (!rows[0].is_default) await pool.query(`UPDATE wa_numbers SET is_default = true WHERE id = $1`, [rows[0].id]);
    return rows[0];
  }
  const { rows: t } = await pool.query(`SELECT slug, name FROM tenants WHERE id = $1`, [tenantId]);
  if (!t[0]) throw new Error('ISP no encontrado');
  const { rows: created } = await pool.query(
    `INSERT INTO wa_numbers (tenant_id, label, display_name, instance_name, is_default)
     VALUES ($1, 'Principal', $2, $3, true)
     ON CONFLICT DO NOTHING RETURNING *`,
    [tenantId, t[0].name, await uniqueInstanceName('wa-' + slugify(t[0].slug))]
  );
  if (created[0]) return created[0];
  const { rows: again } = await pool.query(`SELECT * FROM wa_numbers WHERE tenant_id = $1 AND is_default`, [tenantId]);
  return again[0];
}

export async function listNumbers(tenantId: string): Promise<WaNumber[]> {
  await ensureDefaultNumber(tenantId);
  const { rows } = await pool.query(`SELECT * FROM wa_numbers WHERE tenant_id = $1 ORDER BY is_default DESC, id`, [tenantId]);
  return rows;
}

export async function getNumber(tenantId: string, id: number): Promise<WaNumber> {
  const { rows } = await pool.query(`SELECT * FROM wa_numbers WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!rows[0]) throw Object.assign(new Error('Número no encontrado'), { status: 404 });
  return rows[0];
}

/** Lo que ve el panel: valores efectivos (con los textos por defecto), sin secreto ni imagen. */
export function publicNumber(n: WaNumber) {
  const { webhook_secret: _s, qr_image, ...rest } = n;
  return {
    ...rest,
    has_qr: Boolean(qr_image),
    invite_template: n.invite_template || DEFAULT_INVITE_TEMPLATE,
    invoice_template: n.invoice_template || DEFAULT_INVOICE_TEMPLATE,
    welcome_template: n.welcome_template || DEFAULT_WELCOME_TEMPLATE,
    menu: menuOf(n),
    wa_link: n.connected_number ? `https://wa.me/${n.connected_number}?text=${encodeURIComponent('Hola, quiero recibir mis avisos')}` : null,
  };
}

export interface NumberInput {
  label?: string;
  display_name?: string | null;
  paused?: boolean;
  interval_sec?: number;
  jitter_sec?: number;
  daily_cap?: number;
  invite_daily_cap?: number;
  signature?: string | null;
  invite_template?: string | null;
  invoice_template?: string | null;
  welcome_template?: string | null;
  /** WhatsApp de quien atiende el soporte de las organizaciones de este número */
  support_phone?: string | null;
  menu?: MenuOption[] | null;
  payment_link?: string | null;
  payment_info?: string | null;
}

const textOrNull = (v: any, max: number) => (v === null || v === undefined ? null : String(v).slice(0, max).trim() || null);

function validMenu(menu: any): MenuOption[] | null {
  if (menu === null) return null;
  if (!Array.isArray(menu) || menu.length > 9) throw new Error('El menú admite hasta 9 opciones');
  const keys = new Set<string>();
  return menu.map((o: any) => {
    const key = String(o?.key ?? '').trim().toUpperCase().slice(0, 12);
    const label = String(o?.label ?? '').trim().slice(0, 60);
    const reply = String(o?.reply ?? '').trim().slice(0, 1000);
    if (!key || !label || !reply) throw new Error('Cada opción del menú necesita número, texto y respuesta');
    if (keys.has(key)) throw new Error(`La opción ${key} está repetida`);
    keys.add(key);
    return {
      key, label, reply,
      reply_paid: o?.reply_paid ? String(o.reply_paid).trim().slice(0, 500) : undefined,
      media: o?.media === 'qr' ? 'qr' : null,
      support: Boolean(o?.support),
    } as MenuOption;
  });
}

export async function createNumber(tenantId: string, input: NumberInput): Promise<WaNumber> {
  await ensureDefaultNumber(tenantId);
  const { rows: lim } = await pool.query(
    `SELECT COALESCE(t.wa_max_numbers, 1) AS max, (SELECT count(*) FROM wa_numbers n WHERE n.tenant_id = t.id)::int AS used, t.slug
       FROM tenants t WHERE t.id = $1`, [tenantId]
  );
  if (!lim[0]) throw new Error('ISP no encontrado');
  if (lim[0].used >= lim[0].max) {
    throw Object.assign(new Error(`Este ISP puede tener ${lim[0].max} número(s) de WhatsApp. Pide al administrador de Omnisync que amplíe el límite.`), { status: 403 });
  }
  const label = textOrNull(input.label, 60);
  if (!label) throw new Error('Ponle un nombre al número (p. ej. "Suros Empresas")');
  const { rows } = await pool.query(
    `INSERT INTO wa_numbers (tenant_id, label, display_name, instance_name) VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, label, textOrNull(input.display_name, 80) || label, await uniqueInstanceName(`wa-${slugify(lim[0].slug)}-${slugify(label).slice(0, 16)}`)]
  );
  return updateNumber(tenantId, rows[0].id, input);
}

export async function updateNumber(tenantId: string, id: number, input: NumberInput): Promise<WaNumber> {
  const cur = await getNumber(tenantId, id);
  const interval = intIn(input.interval_sec, 30, 3600, 'La pausa entre mensajes (segundos)', cur.interval_sec);
  const jitter = intIn(input.jitter_sec, 0, Math.floor(interval / 2), 'La variación al azar', Math.min(cur.jitter_sec, Math.floor(interval / 2)));
  const cap = intIn(input.daily_cap, 1, 5000, 'El tope diario', cur.daily_cap);
  const invCap = intIn(input.invite_daily_cap, 0, 500, 'El tope de presentaciones por día', cur.invite_daily_cap);
  const pick = <K extends keyof NumberInput>(k: K, max: number) =>
    input[k] === undefined ? (cur as any)[k] : textOrNull(input[k], max);
  const link = pick('payment_link', 300);
  if (link && !/^https?:\/\/\S+$/i.test(link)) throw new Error('El link de pago debe empezar por http:// o https://');
  const menu = input.menu === undefined ? cur.menu : validMenu(input.menu);
  let support = cur.support_phone;
  if (input.support_phone !== undefined) {
    const raw = String(input.support_phone ?? '').trim();
    support = raw === '' ? null : normalizePhone(raw);
    if (raw !== '' && !support) throw new Error('El WhatsApp de soporte no es un teléfono válido');
  }
  const { rows } = await pool.query(
    `UPDATE wa_numbers SET
       label = COALESCE($3::text, label), display_name = $4::text, paused = COALESCE($5::boolean, paused),
       interval_sec = $6::int, jitter_sec = $7::int, daily_cap = $8::int, invite_daily_cap = $9::int,
       signature = $10::text, invite_template = $11::text, invoice_template = $12::text, menu = $13::jsonb,
       welcome_template = $16::text, support_phone = $17::text,
       payment_link = $14::text, payment_info = $15::text,
       next_send_at = CASE WHEN next_send_at > now() + make_interval(secs => $6::int + $7::int)
                           THEN now() + make_interval(secs => $6::int) ELSE next_send_at END,
       updated_at = now()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenantId, input.label === undefined ? null : textOrNull(input.label, 60), pick('display_name', 80),
     typeof input.paused === 'boolean' ? input.paused : null, interval, jitter, cap, invCap,
     pick('signature', 300), pick('invite_template', 1500), pick('invoice_template', 1500),
     menu ? JSON.stringify(menu) : null, link, pick('payment_info', 800), pick('welcome_template', 1500), support]
  );
  return rows[0];
}

/** Imagen del QR de pago (data URL png/jpeg/webp). null la quita. */
export async function setNumberQr(tenantId: string, id: number, dataUrl: string | null): Promise<void> {
  await getNumber(tenantId, id);
  if (dataUrl !== null) {
    const m = String(dataUrl).match(/^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error('Sube una imagen PNG, JPG o WEBP');
    if (Buffer.byteLength(m[3], 'base64') > MAX_QR_BYTES) throw new Error('La imagen supera 1,5 MB');
  }
  await pool.query(`UPDATE wa_numbers SET qr_image = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [id, tenantId, dataUrl]);
}

export async function setDefaultNumber(tenantId: string, id: number): Promise<void> {
  await getNumber(tenantId, id);
  await pool.query(`UPDATE wa_numbers SET is_default = false WHERE tenant_id = $1 AND is_default AND id <> $2`, [tenantId, id]);
  await pool.query(`UPDATE wa_numbers SET is_default = true WHERE id = $1`, [id]);
}

/** Borra un número (no el por defecto): cierra su sesión y pasa sus pendientes al por defecto. */
export async function deleteNumber(tenantId: string, id: number): Promise<void> {
  const n = await getNumber(tenantId, id);
  if (n.is_default) throw new Error('No se puede borrar el número por defecto; marca otro como por defecto primero');
  const def = await ensureDefaultNumber(tenantId);
  await evo(`/instance/delete/${encodeURIComponent(n.instance_name)}`, 'DELETE').catch(() => undefined);
  await pool.query(`UPDATE wa_queue SET number_id = $2 WHERE number_id = $1 AND status IN ('pending', 'waiting')`, [id, def.id]);
  await pool.query(`DELETE FROM wa_numbers WHERE id = $1`, [id]);
}

// ───────────────────────── Organizaciones ─────────────────────────

export async function listOrgs(tenantId: string) {
  const { rows } = await pool.query(
    `SELECT o.*, n.label AS number_label,
            (SELECT count(*) FROM wa_queue q WHERE q.tenant_id = o.tenant_id AND q.client_ref IS NOT NULL
               AND q.source = 'org:' || o.id)::int AS messages
       FROM wa_orgs o LEFT JOIN wa_numbers n ON n.id = o.number_id
      WHERE o.tenant_id = $1 ORDER BY o.name NULLS LAST, o.org_id`,
    [tenantId]
  );
  return rows;
}

export async function assignOrg(tenantId: string, orgId: number, numberId: number | null): Promise<void> {
  if (numberId !== null) await getNumber(tenantId, numberId);
  const { rowCount } = await pool.query(`UPDATE wa_orgs SET number_id = $3 WHERE id = $1 AND tenant_id = $2`, [orgId, tenantId, numberId]);
  if (!rowCount) throw Object.assign(new Error('Organización no encontrada'), { status: 404 });
}

/**
 * Organizaciones que atiende un número (desde Números → Editar). Una organización solo puede
 * estar en un número: si alguna ya es de otro, no se cambia nada y se dice cuál.
 */
export async function setNumberOrgs(tenantId: string, numberId: number, orgIds: number[]): Promise<void> {
  await getNumber(tenantId, numberId);
  const ids = [...new Set((orgIds || []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  if (ids.length) {
    const { rows } = await pool.query(
      `SELECT o.id, o.name, o.org_id, o.number_id, n.label FROM wa_orgs o LEFT JOIN wa_numbers n ON n.id = o.number_id
        WHERE o.tenant_id = $1 AND o.id = ANY($2::int[])`,
      [tenantId, ids]
    );
    if (rows.length !== ids.length) throw new Error('Alguna organización no existe; usa "Traer organizaciones de UISP"');
    const taken = rows.filter((o: any) => o.number_id && o.number_id !== numberId);
    if (taken.length) {
      throw new Error(`Ya están asignadas a otro número: ${taken.map((o: any) => `${o.name || 'org ' + o.org_id} (${o.label})`).join(', ')}. Quítalas de ese número primero.`);
    }
  }
  await pool.query(`UPDATE wa_orgs SET number_id = NULL WHERE tenant_id = $1 AND number_id = $2 AND NOT (id = ANY($3::int[]))`, [tenantId, numberId, ids]);
  if (ids.length) await pool.query(`UPDATE wa_orgs SET number_id = $2 WHERE tenant_id = $1 AND id = ANY($3::int[])`, [tenantId, numberId, ids]);
}

/** Trae del plugin UISP la lista completa de organizaciones (para asignarlas antes del primer aviso). */
export async function syncOrgs(tenantId: string): Promise<{ total: number; added: number }> {
  const { rows: sources } = await pool.query(`SELECT source, url FROM wa_lookup_sources WHERE tenant_id = $1`, [tenantId]);
  if (!sources.length) throw new Error('Omnisync todavía no tiene la consulta del plugin UISP: en el plugin pulsa "Probar conexión con Omnisync" (versión 4.1.7 o superior).');
  let total = 0, added = 0, answered = 0;
  for (const src of sources) {
    try {
      const res = await fetch(src.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'organizations' }), signal: AbortSignal.timeout(30_000),
      });
      const data: any = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.organizations)) continue;
      answered++;
      for (const o of data.organizations) {
        if (o?.id == null) continue;
        const { rows } = await pool.query(
          `INSERT INTO wa_orgs (tenant_id, source, org_id, name) VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, source, org_id) DO UPDATE SET name = EXCLUDED.name
           RETURNING (xmax = 0) AS inserted`,
          [tenantId, String(data.uisp || src.source || '').slice(0, 120), String(o.id).slice(0, 60), String(o.name || '').slice(0, 120) || null]
        );
        total++;
        if (rows[0]?.inserted) added++;
      }
    } catch (e: any) {
      console.warn('[WA] traer organizaciones:', e.message);
    }
  }
  if (!answered) throw new Error('El plugin UISP no respondió con las organizaciones. ¿Está instalada la versión 4.1.7?');
  return { total, added };
}

/** Mensaje a todos los suscritos de un número (p. ej. "este es nuestro nuevo número"), con la pausa normal. */
export async function announceToNumber(tenantId: string, numberId: number, message: string): Promise<{ queued: number }> {
  const n = await getNumber(tenantId, numberId);
  const text = String(message || '').trim();
  if (text.length < 10) throw new Error('Escribe el mensaje del anuncio');
  if (text.length > 1000) throw new Error('El anuncio supera 1000 caracteres');
  const day = new Date().toISOString().slice(0, 10);
  const { rowCount } = await pool.query(
    `INSERT INTO wa_queue (tenant_id, number_id, kind, phone, message, event_type, priority, source, client_ref, dedupe_key)
     SELECT $1, $2::int, 'notice', s.phone, $3, 'manual', 6, 'anuncio', s.client_ref,
            'anuncio-' || $2::int::text || '-' || $4::text || '-' || s.phone
       FROM wa_subscribers s WHERE s.number_id = $2::int AND s.status = 'subscribed' AND NOT s.not_on_whatsapp
     ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [tenantId, n.id, text, day]
  );
  return { queued: rowCount || 0 };
}

/** Registra la organización y devuelve el número que le toca (asignado o el por defecto). */
async function numberForOrg(tenantId: string, org: { source?: string; id?: string; name?: string } | null): Promise<{ number: WaNumber; orgRowId: number | null }> {
  if (org?.id) {
    const { rows } = await pool.query(
      `INSERT INTO wa_orgs (tenant_id, source, org_id, name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, source, org_id) DO UPDATE SET name = COALESCE(EXCLUDED.name, wa_orgs.name), last_seen = now()
       RETURNING id, number_id`,
      [tenantId, org.source || '', org.id, org.name || null]
    );
    if (rows[0]?.number_id) {
      const { rows: n } = await pool.query(`SELECT * FROM wa_numbers WHERE id = $1`, [rows[0].number_id]);
      if (n[0]) return { number: n[0], orgRowId: rows[0].id };
    }
    return { number: await ensureDefaultNumber(tenantId), orgRowId: rows[0]?.id ?? null };
  }
  return { number: await ensureDefaultNumber(tenantId), orgRowId: null };
}

// ───────────────────────── Sesión (QR) ─────────────────────────

function webhookUrl(n: WaNumber): string {
  return `${API_INTERNAL_URL}/api/public/whatsapp/evolution/${encodeURIComponent(n.instance_name)}?s=${n.webhook_secret}`;
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
export async function connectNumber(tenantId: string, id: number): Promise<{ state: string; qr: string | null; pairing_code: string | null }> {
  const n = await getNumber(tenantId, id);
  const name = n.instance_name;
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
    webhook: { enabled: true, url: webhookUrl(n), byEvents: false, base64: false, events: WEBHOOK_EVENTS },
  }).catch((e) => console.warn(`[WA] webhook ${name}: ${e.message}`));
  const state = await refreshState(n);
  if (state === 'open') return { state, qr: null, pairing_code: null };
  const c = await evo(`/instance/connect/${encodeURIComponent(name)}`);
  return { state, qr: c?.base64 || null, pairing_code: c?.pairingCode || null };
}

export async function logoutNumber(tenantId: string, id: number): Promise<void> {
  const n = await getNumber(tenantId, id);
  await evo(`/instance/logout/${encodeURIComponent(n.instance_name)}`, 'DELETE').catch((e) => {
    if (!(e instanceof EvolutionError && (e.status === 404 || e.status === 400))) throw e;
  });
  await setState(n, 'close', 'Sesión cerrada desde el panel');
}

/** Pregunta a Evolution el estado del número y lo guarda (con historial). */
export async function refreshState(n: WaNumber): Promise<string> {
  let state = 'close';
  let number: string | null = n.connected_number;
  try {
    const r = await evo(`/instance/connectionState/${encodeURIComponent(n.instance_name)}`, 'GET', undefined, 8000);
    state = r?.instance?.state || r?.state || 'close';
    if (state === 'open' && !number) {
      const list = await evo(`/instance/fetchInstances?instanceName=${encodeURIComponent(n.instance_name)}`).catch(() => []);
      const owner = Array.isArray(list) ? (list[0]?.ownerJid || list[0]?.owner || list[0]?.number) : null;
      number = owner ? String(owner).split('@')[0].split(':')[0] : null;
    }
  } catch (e: any) {
    state = e instanceof EvolutionError && e.status === 404 ? 'close' : 'error';
  }
  await setState(n, state, null, number);
  return state;
}

async function setState(n: WaNumber, state: string, detail: string | null, number?: string | null): Promise<void> {
  const changed = n.connection_state !== state;
  await pool.query(
    `UPDATE wa_numbers SET connection_state = $2,
       connected_number = CASE WHEN $2 = 'open' THEN COALESCE($3, connected_number) ELSE connected_number END,
       state_changed_at = CASE WHEN connection_state IS DISTINCT FROM $2 THEN now() ELSE state_changed_at END
     WHERE id = $1`,
    [n.id, state, number ?? null]
  );
  if (changed) {
    await pool.query(`INSERT INTO wa_session_events (tenant_id, number_id, state, detail) VALUES ($1, $2, $3, $4)`, [n.tenant_id, n.id, state, detail]);
    n.state_changed_at = new Date().toISOString();
  }
  n.connection_state = state;
  if (state === 'open' && number) n.connected_number = number;
}

/**
 * Aviso por WhatsApp al número del administrador (Configuración → WhatsApp del administrador),
 * enviado desde un número conectado del ISP (si se cayó uno, desde otro). Sin número de
 * administrador o sin ningún número conectado, no se envía (el panel igual lo muestra).
 */
export async function notifyAdmin(tenantId: string, text: string, avoidNumberId: number | null = null,
  opts: { to?: string | null; from?: WaNumber | null } = {}): Promise<boolean> {
  let to = normalizePhone(opts.to);
  if (!to) {
    const { rows: st } = await pool.query(`SELECT admin_phone FROM wa_settings WHERE tenant_id = $1`, [tenantId]);
    to = normalizePhone(st[0]?.admin_phone);
  }
  if (!to) return false;
  // Sale por el número indicado si está conectado; si no, por otro número conectado del ISP
  let sender: WaNumber | null = null;
  if (opts.from && opts.from.id !== avoidNumberId) {
    const { rows } = await pool.query(`SELECT * FROM wa_numbers WHERE id = $1 AND connection_state = 'open'`, [opts.from.id]);
    sender = rows[0] || null;
  }
  if (!sender) {
    const { rows } = await pool.query(
      `SELECT * FROM wa_numbers WHERE tenant_id = $1 AND connection_state = 'open' AND ($2::int IS NULL OR id <> $2)
        ORDER BY is_default DESC, id LIMIT 1`,
      [tenantId, avoidNumberId]
    );
    sender = rows[0] || null;
  }
  if (!sender || sender.connected_number === to) return false;
  await enqueueImmediate(sender, to, 'system', text, null, 'admin');
  flushImmediate(sender).catch(() => undefined);
  return true;
}

/** Aviso al soporte de las organizaciones de este número (o al administrador si no tiene). */
export function notifySupport(n: WaNumber, text: string, avoidSelf = false): Promise<boolean> {
  return notifyAdmin(n.tenant_id, text, avoidSelf ? n.id : null, { to: n.support_phone, from: avoidSelf ? null : n });
}

/** ¿Es este teléfono el del administrador o el soporte de algún número del ISP? (no se trata como cliente) */
async function isStaffPhone(s: WaSettings, phone: string): Promise<boolean> {
  if (s.admin_phone && normalizePhone(s.admin_phone) === phone) return true;
  const { rows } = await pool.query(`SELECT 1 FROM wa_numbers WHERE tenant_id = $1 AND support_phone = $2 LIMIT 1`, [s.tenant_id, phone]);
  return rows.length > 0;
}

/** Aviso al soporte del número si lleva >2 min caído (desde otro número), y cuando vuelve. */
async function alertOnState(s: WaSettings, n: WaNumber, ispName: string): Promise<void> {
  if (!s.alert_disconnect) return;
  const since = n.state_changed_at ? new Date(n.state_changed_at).getTime() : Date.now();
  const down = n.connection_state !== 'open';
  if (down && n.alerted_state !== 'down' && Date.now() - since > 120_000 && n.last_sent_at) {
    await notifySupport(n,
      `📵 *WhatsApp desconectado* — ${ispName} · ${n.label}\nLa sesión no está conectada (${n.connection_state}). ` +
      `Los avisos quedan en cola. Entra a Omnisync → WhatsApp → Números y vuelve a escanear el QR.`, true).catch(() => undefined);
    await pool.query(`UPDATE wa_numbers SET alerted_state = 'down' WHERE id = $1`, [n.id]);
  } else if (!down && n.alerted_state === 'down') {
    await notifySupport(n, `✅ *WhatsApp conectado de nuevo* — ${ispName} · ${n.label}. La cola sigue enviando.`).catch(() => undefined);
    await pool.query(`UPDATE wa_numbers SET alerted_state = NULL WHERE id = $1`, [n.id]);
  }
}

// ───────────────────────── Suscriptores ─────────────────────────

async function getSubscriber(n: WaNumber, phone: string): Promise<any> {
  await pool.query(
    `INSERT INTO wa_subscribers (number_id, phone, tenant_id) VALUES ($1, $2, $3) ON CONFLICT (number_id, phone) DO NOTHING`,
    [n.id, phone, n.tenant_id]
  );
  const { rows } = await pool.query(`SELECT * FROM wa_subscribers WHERE number_id = $1 AND phone = $2`, [n.id, phone]);
  return rows[0];
}

export async function listSubscribers(tenantId: string, opts: { number_id?: number | null; status?: string | null; q?: string | null; limit?: number; offset?: number }) {
  // status 'unlinked' = escribieron pero no están vinculados a un cliente del CRM
  const unlinked = opts.status === 'unlinked';
  const { rows } = await pool.query(
    `SELECT s.number_id, n.label AS number_label, s.phone, s.status, s.client_ref, s.client_name, s.invited_at,
            s.responded_at, s.last_inbound_at, s.not_on_whatsapp, s.context, s.context_at,
            s.link_state, s.link_attempts, s.linked_at, count(*) OVER () AS total
       FROM wa_subscribers s JOIN wa_numbers n ON n.id = s.number_id
      WHERE s.tenant_id = $1 AND ($2::int IS NULL OR s.number_id = $2)
        AND ($3::text IS NULL OR s.status = $3) AND (NOT $7::boolean OR s.client_ref IS NULL)
        AND ($4::text IS NULL OR s.phone LIKE '%' || $4 || '%' OR s.client_ref = $4 OR s.client_name ILIKE '%' || $4 || '%')
      ORDER BY COALESCE(s.responded_at, s.invited_at, s.created_at) DESC
      LIMIT $5 OFFSET $6`,
    [tenantId, opts.number_id ?? null, unlinked ? null : (opts.status ?? null), opts.q ?? null, opts.limit ?? 50, opts.offset ?? 0, unlinked]
  );
  return { items: rows.map(({ total, ...r }) => r), total: Number(rows[0]?.total || 0) };
}

// ───────────────────────── Vinculación con el CRM ─────────────────────────

/** "Juan Pérez" → "J*** P***": confirma a quién se vinculó sin revelar el nombre. */
export function maskName(name: string): string {
  return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w.charAt(0).toUpperCase() + '***').join(' ');
}

export interface LookupClient { id: number; name: string; first_name?: string; phone?: string; organization_id?: number | null; organization_name?: string | null }

/** Guarda la dirección de consulta que manda el plugin UISP (?hook=lookup&s=…). */
async function saveLookupSource(tenantId: string, source: string, url: unknown): Promise<void> {
  const u = String(url || '');
  if (!/^https?:\/\/\S{8,600}$/i.test(u)) return;
  await pool.query(
    `INSERT INTO wa_lookup_sources (tenant_id, source, url) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, source) DO UPDATE SET url = EXCLUDED.url, updated_at = now()
     WHERE wa_lookup_sources.url IS DISTINCT FROM EXCLUDED.url OR wa_lookup_sources.updated_at < now() - interval '1 day'`,
    [tenantId, source, u]
  );
}

/**
 * Pregunta a los plugins UISP del ISP. Devuelve el cliente, 'multiple', 'none' o
 * 'unavailable' (ningún plugin respondió o no hay plugin con la versión que consulta).
 */
export async function lookupCrm(tenantId: string, query: { phone?: string; client_id?: number }): Promise<LookupClient | 'multiple' | 'none' | 'unavailable'> {
  const { rows } = await pool.query(`SELECT url FROM wa_lookup_sources WHERE tenant_id = $1 ORDER BY updated_at DESC`, [tenantId]);
  if (!rows.length) return 'unavailable';
  let answered = false;
  let multiple = false;
  for (const { url } of rows) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
        signal: AbortSignal.timeout(30_000),
      });
      const data: any = await res.json().catch(() => null);
      if (!res.ok || !data) continue;
      answered = true;
      if (data.found && data.client?.id) return data.client as LookupClient;
      if (data.multiple) multiple = true;
    } catch (e: any) {
      console.warn('[WA] consulta al plugin UISP:', e.message);
    }
  }
  if (multiple) return 'multiple';
  return answered ? 'none' : 'unavailable';
}

/** Vincula el WhatsApp con el cliente y le pasa sus avisos pendientes de ese número. */
async function linkSubscriber(n: WaNumber, phone: string, client: LookupClient, how: 'phone' | 'id' | 'manual'): Promise<void> {
  await pool.query(
    `UPDATE wa_subscribers SET client_ref = $3, client_name = COALESCE($4, client_name), link_state = $5,
       linked_at = now(), link_attempts = 0
     WHERE number_id = $1 AND phone = $2`,
    [n.id, phone, String(client.id), client.name || null, how]
  );
  // Avisos de ese cliente que estaban yendo a otro teléfono: ahora van a este WhatsApp
  await pool.query(
    `UPDATE wa_queue SET phone = $3, updated_at = now()
      WHERE number_id = $1 AND client_ref = $2 AND phone <> $3 AND kind = 'notice' AND status IN ('pending', 'waiting')`,
    [n.id, String(client.id), phone]
  );
}

const ASK_ID = 'Hola 👋 Este número no está registrado en tu cuenta. Escríbeme tu *ID de cliente* (aparece en tu factura) para vincularlo y enviarte tus avisos por aquí.';

/** Número que atiende la organización del cliente (asignado o, si no, el por defecto). */
async function numberForClientOrg(tenantId: string, orgId: number | null | undefined): Promise<WaNumber | null> {
  if (orgId == null) return null;
  const { rows } = await pool.query(
    `SELECT n.* FROM wa_orgs o JOIN wa_numbers n ON n.id = o.number_id
      WHERE o.tenant_id = $1 AND o.org_id = $2 ORDER BY o.last_seen DESC LIMIT 1`,
    [tenantId, String(orgId)]
  );
  return rows[0] || (await ensureDefaultNumber(tenantId));
}

/**
 * Si el cliente es de una organización que atiende otro número, se le indica ese número
 * (no se suscribe aquí: sus avisos salen por el otro). Devuelve true si se redirigió.
 */
async function redirectIfOtherOrg(n: WaNumber, phone: string, client: LookupClient, reply: (m: string) => Promise<unknown>): Promise<boolean> {
  const target = await numberForClientOrg(n.tenant_id, client.organization_id);
  if (!target || target.id === n.id) return false;
  await pool.query(`UPDATE wa_subscribers SET link_state = 'redirected', linked_at = now() WHERE number_id = $1 AND phone = $2`, [n.id, phone]);
  const org = client.organization_name || target.display_name || target.label;
  const link = target.connected_number ? `wa.me/${target.connected_number}` : 'nuestro otro WhatsApp';
  await reply(`Hola 👋 Tu servicio es con *${org}*. Tus facturas y avisos te llegan por este otro número: ${link} 👉 escríbenos ahí.`);
  return true;
}

/**
 * Quien escribe y no está vinculado a un cliente: primero se busca su teléfono en el
 * CRM; si no aparece, se le pide el ID de cliente (3 intentos). Si es de una organización
 * que atiende otro número, se le indica ese número. Devuelve true si quedó vinculado aquí
 * (y el mensaje se sigue procesando) o false si ya se respondió.
 */
async function ensureLinked(s: WaSettings, n: WaNumber, ispName: string, phone: string, text: string, sub: any): Promise<boolean> {
  const reply = (msg: string) => enqueueImmediate(n, phone, 'system', msg);
  const alertAdmin = (msg: string) => notifySupport(n, `${msg}\n${ispName} · ${n.label} · +${phone}`).catch(() => undefined);
  if (sub.link_state === 'failed') return false; // ya se le dijo que un asesor lo atiende
  if (sub.link_state === 'redirected') {
    // Ya se le indicó el otro número: no se repite más de una vez al día
    if (sub.linked_at && new Date(sub.linked_at).getTime() > Date.now() - 86400_000) return false;
    sub.link_state = null;
  }
  if (sub.link_state === 'unavailable') {
    // La consulta al CRM no estaba disponible: se reintenta si ya hay plugin que responda
    const { rows } = await pool.query(`SELECT 1 FROM wa_lookup_sources WHERE tenant_id = $1 LIMIT 1`, [n.tenant_id]);
    if (!rows.length) return false;
    sub.link_state = null;
  }

  if (!sub.link_state) {
    const r = await lookupCrm(n.tenant_id, { phone });
    if (r !== 'none' && r !== 'multiple' && r !== 'unavailable') {
      if (await redirectIfOtherOrg(n, phone, r, reply)) return false;
      await linkSubscriber(n, phone, r, 'phone');
      sub.client_ref = String(r.id);
      sub.client_name = r.name || sub.client_name;
      return true;
    }
    if (r === 'unavailable') {
      await pool.query(`UPDATE wa_subscribers SET link_state = 'unavailable' WHERE number_id = $1 AND phone = $2`, [n.id, phone]);
      await alertAdmin('❓ *Escribió alguien que no está vinculado* y no se pudo consultar el CRM (¿plugin UISP 4.1.6 o superior instalado y "Probar conexión" pulsado?). Se reintentará con su próximo mensaje, o vincúlalo en Omnisync → WhatsApp → Clientes.');
      await reply('Hola 👋 Recibimos tu mensaje; un asesor te responderá pronto.');
      return false;
    }
    await pool.query(`UPDATE wa_subscribers SET link_state = 'asked' WHERE number_id = $1 AND phone = $2`, [n.id, phone]);
    await reply(ASK_ID);
    return false;
  }

  // link_state = 'asked': esperamos el ID de cliente
  const digits = String(text || '').match(/\d{1,10}/)?.[0];
  const attempts = Number(sub.link_attempts || 0) + 1;
  const r = digits ? await lookupCrm(n.tenant_id, { client_id: Number(digits) }) : 'none';
  if (r !== 'none' && r !== 'multiple' && r !== 'unavailable') {
    if (await redirectIfOtherOrg(n, phone, r, reply)) return false;
    await linkSubscriber(n, phone, r, 'id');
    await pool.query(`UPDATE wa_subscribers SET status = 'subscribed', responded_at = now() WHERE number_id = $1 AND phone = $2`, [n.id, phone]);
    await pool.query(`UPDATE wa_queue SET status = 'pending', not_before = now(), updated_at = now() WHERE number_id = $1 AND phone = $2 AND status = 'waiting'`, [n.id, phone]);
    await logInteraction(n, phone, 'vinculo');
    await alertAdmin(`🔗 *WhatsApp vinculado por ID de cliente*: cliente #${r.id} (${r.name || 'sin nombre'}).`);
    await reply(`¡Listo! ✅ Vinculamos este WhatsApp a la cuenta de *${maskName(r.name)}* (cliente #${r.id}). Desde ahora recibirás tus avisos por aquí. Para dejar de recibirlos responde *${s.optout_word}*.`);
    return false;
  }
  if (r === 'unavailable') {
    await pool.query(`UPDATE wa_subscribers SET link_state = 'unavailable' WHERE number_id = $1 AND phone = $2`, [n.id, phone]);
    await alertAdmin('❓ *No se pudo consultar el CRM* para vincular un WhatsApp. Se reintentará con su próximo mensaje.');
    await reply('Hola 👋 Recibimos tu mensaje; un asesor te responderá pronto.');
    return false;
  }
  if (attempts >= 3) {
    await pool.query(`UPDATE wa_subscribers SET link_state = 'failed', link_attempts = $3 WHERE number_id = $1 AND phone = $2`, [n.id, phone, attempts]);
    await alertAdmin('❓ *No se pudo vincular un WhatsApp* con un cliente del CRM. Vincúlalo a mano en Omnisync → WhatsApp → Clientes (filtro "Sin vincular").');
    await reply('No logré encontrar tu cuenta. Un asesor te escribirá pronto para ayudarte.');
    return false;
  }
  await pool.query(`UPDATE wa_subscribers SET link_attempts = $3 WHERE number_id = $1 AND phone = $2`, [n.id, phone, attempts]);
  await reply(digits
    ? 'No encontré ese ID de cliente. Revisa el número que aparece en tu factura y escríbemelo de nuevo.'
    : 'Para vincularte necesito tu *ID de cliente* (solo el número, aparece en tu factura).');
  return false;
}

/** Desvincular un WhatsApp de su cliente (vuelve a verificarse con su próximo mensaje). */
export async function unlinkSubscriber(tenantId: string, numberId: number, phone: string): Promise<void> {
  const n = await getNumber(tenantId, numberId);
  const p = normalizePhone(phone);
  if (!p) throw new Error('Teléfono inválido');
  await pool.query(
    `UPDATE wa_subscribers SET client_ref = NULL, link_state = NULL, link_attempts = 0, linked_at = NULL WHERE number_id = $1 AND phone = $2`,
    [n.id, p]
  );
}

/**
 * Reiniciar (para pruebas): el número queda como nuevo en ese WhatsApp y los avisos
 * omitidos de los últimos 3 días (bienvenida, factura…) vuelven a la cola.
 */
export async function resetSubscriber(tenantId: string, numberId: number, phone: string): Promise<{ requeued: number }> {
  const n = await getNumber(tenantId, numberId);
  const p = normalizePhone(phone);
  if (!p) throw new Error('Teléfono inválido');
  await pool.query(`DELETE FROM wa_subscribers WHERE number_id = $1 AND phone = $2`, [n.id, p]);
  const { rowCount } = await pool.query(
    `UPDATE wa_queue SET status = 'pending', attempts = 0, last_error = NULL, not_before = now(), updated_at = now()
      WHERE number_id = $1 AND phone = $2 AND kind IN ('notice', 'welcome') AND status IN ('skipped', 'waiting')
        AND created_at > now() - interval '3 days'`,
    [n.id, p]
  );
  return { requeued: rowCount || 0 };
}

/** Vinculación manual desde el panel (cuando el cliente no supo su ID o hubo varios con su teléfono). */
export async function manualLink(tenantId: string, numberId: number, phone: string, clientId: number): Promise<{ name: string | null }> {
  const n = await getNumber(tenantId, numberId);
  const p = normalizePhone(phone);
  if (!p) throw new Error('Teléfono inválido');
  if (!Number.isInteger(clientId) || clientId <= 0) throw new Error('ID de cliente inválido');
  const sub = await getSubscriber(n, p);
  const r = await lookupCrm(tenantId, { client_id: clientId });
  if (r === 'none') throw new Error(`El cliente #${clientId} no existe en el CRM (o es un prospecto)`);
  const client: LookupClient = typeof r === 'object' ? r : { id: clientId, name: '' };
  await linkSubscriber(n, p, client, 'manual');
  // Si ya escribió, queda suscrito; si no, recibirá la presentación con su primer aviso
  if (sub.last_inbound_at && !['opted_out', 'declined'].includes(sub.status)) {
    await pool.query(`UPDATE wa_subscribers SET status = 'subscribed', responded_at = COALESCE(responded_at, now()) WHERE number_id = $1 AND phone = $2`, [n.id, p]);
  }
  return { name: client.name || null };
}

// ───────────────────────── Cola ─────────────────────────

export interface EnqueueInput {
  phone: unknown;
  message?: unknown;
  event?: unknown;
  client_ref?: unknown;
  client_name?: unknown;
  organization?: { id?: unknown; name?: unknown } | null;
  uisp?: unknown;
  context?: any;
  dedupe_key?: unknown;
  source?: string;
  number_id?: number | null;
  /** Dirección de consulta del plugin UISP (?hook=lookup&s=…) para verificar a quien escribe */
  lookup_url?: unknown;
}

function cleanContext(c: any): InvoiceContext | null {
  if (!c || typeof c !== 'object') return null;
  const out: InvoiceContext = {};
  if (c.invoice_number != null) out.invoice_number = String(c.invoice_number).slice(0, 40);
  if (c.due_date && parseDay(c.due_date)) out.due_date = String(c.due_date).slice(0, 30);
  if (c.amount != null && Number.isFinite(Number(c.amount))) out.amount = Number(c.amount);
  if (c.balance != null && Number.isFinite(Number(c.balance))) out.balance = Number(c.balance);
  if (c.month) out.month = String(c.month).slice(0, 20);
  return Object.keys(out).length ? out : null;
}

/** Aviso desde UISP (o manual). Elige el número por la organización; el envío lo decide el despachador. */
export async function enqueue(tenantId: string, input: EnqueueInput): Promise<{ id: number | null; status: string; duplicate: boolean; number_id: number }> {
  const s = await getSettings(tenantId);
  // Antes de validar: la prueba de conexión del plugin (sin teléfono) también deja registrada la consulta
  if (input.lookup_url) await saveLookupSource(tenantId, String(input.uisp ?? '').slice(0, 120), input.lookup_url).catch(() => undefined);
  let phone = normalizePhone(input.phone);
  if (!phone) throw new Error('Teléfono inválido (usa el número con indicativo, p. ej. 573001234567)');
  const event = /^[a-z_]{2,40}$/.test(String(input.event ?? '')) ? String(input.event) : 'manual';
  const dedupe = input.dedupe_key ? String(input.dedupe_key).slice(0, 200) : null;

  let n: WaNumber;
  let orgRowId: number | null = null;
  if (input.number_id) {
    n = await getNumber(tenantId, Number(input.number_id));
  } else {
    const org = input.organization?.id != null
      ? { source: String(input.uisp ?? '').slice(0, 120), id: String(input.organization.id).slice(0, 60), name: input.organization.name ? String(input.organization.name).slice(0, 120) : undefined }
      : null;
    ({ number: n, orgRowId } = await numberForOrg(tenantId, org));
  }

  const clientRef = input.client_ref == null ? null : String(input.client_ref).slice(0, 100);
  // Si el cliente vinculó otro WhatsApp dando su ID (o lo vinculó el admin), sus avisos van ahí.
  // Si solo se reconoció por estar en el CRM ('phone'), manda el teléfono que el CRM tenga hoy.
  if (clientRef) {
    const { rows: linked } = await pool.query(
      `SELECT phone FROM wa_subscribers
        WHERE number_id = $1 AND client_ref = $2 AND link_state IN ('id', 'manual')
          AND status NOT IN ('opted_out', 'declined') AND NOT not_on_whatsapp
        ORDER BY linked_at DESC NULLS LAST LIMIT 1`,
      [n.id, clientRef]
    );
    if (linked[0]?.phone) phone = linked[0].phone;
  }
  const sub = await getSubscriber(n, phone);
  const clientName = input.client_name == null ? null : String(input.client_name).slice(0, 120);
  const ctx = cleanContext(input.context);
  await pool.query(
    `UPDATE wa_subscribers SET client_ref = COALESCE($3, client_ref), client_name = COALESCE($4, client_name),
       link_state = CASE WHEN $3::text IS NOT NULL AND link_state IS DISTINCT FROM 'phone'
                          AND link_state IS DISTINCT FROM 'id' AND link_state IS DISTINCT FROM 'manual'
                         THEN 'crm' ELSE link_state END,
       context = CASE WHEN $5::jsonb IS NULL THEN context ELSE COALESCE(context, '{}'::jsonb) || $5::jsonb END,
       context_at = CASE WHEN $5::jsonb IS NULL THEN context_at ELSE now() END
     WHERE number_id = $1 AND phone = $2`,
    [n.id, phone, clientRef, clientName, ctx ? JSON.stringify(ctx) : null]
  );

  // Factura nueva: se usa la plantilla del número (con el menú); el resto, el texto del plugin
  let message = String(input.message ?? '').trim();
  const fresh = { ...sub, client_name: clientName || sub.client_name, context: { ...(sub.context || {}), ...(ctx || {}) } };
  if (event === 'invoice_created') {
    message = renderTemplate(n.invoice_template || DEFAULT_INVOICE_TEMPLATE, templateVars(n, s, fresh, menuText(n)));
  }
  // Cliente nuevo (lo registró el plugin en el CRM): la bienvenida hace de presentación
  const kind = event === 'welcome' ? 'welcome' : 'notice';
  if (kind === 'welcome') {
    message = renderTemplate(n.welcome_template || DEFAULT_WELCOME_TEMPLATE, templateVars(n, s, fresh));
  }
  if (!message) throw new Error('El mensaje está vacío');
  if (message.length > 4000) throw new Error('El mensaje supera 4000 caracteres');

  const { rows: cnt } = await pool.query(
    `SELECT count(*)::int AS n FROM wa_queue WHERE tenant_id = $1 AND status IN ('pending', 'waiting')`, [tenantId]
  );
  if (cnt[0].n >= MAX_PENDING_PER_TENANT) throw new Error('La cola está llena; revisa el panel de WhatsApp');

  const { rows } = await pool.query(
    `INSERT INTO wa_queue (tenant_id, number_id, kind, phone, message, event_type, priority, source, client_ref, dedupe_key)
     VALUES ($1, $2, $10, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id, status`,
    [tenantId, n.id, phone, message, event, priorityFor(s, event),
     orgRowId ? `org:${orgRowId}` : (input.source || 'api'), clientRef, dedupe, kind]
  );
  if (!rows[0]) return { id: null, status: 'duplicate', duplicate: true, number_id: n.id };
  return { id: Number(rows[0].id), status: rows[0].status, duplicate: false, number_id: n.id };
}

/** Mensaje inmediato (respuesta del menú, confirmación o prueba). */
async function enqueueImmediate(n: WaNumber, phone: string, kind: 'reply' | 'system' | 'test', message: string, media: string | null = null, source = 'auto'): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO wa_queue (tenant_id, number_id, kind, phone, message, event_type, priority, source, media)
     VALUES ($1, $2, $3, $4, $5, $3, 0, $6, $7) RETURNING id`,
    [n.tenant_id, n.id, kind, phone, message, source, media]
  );
  return Number(rows[0].id);
}

export async function enqueueTest(tenantId: string, numberId: number, phone: unknown, message: string): Promise<number> {
  const n = await getNumber(tenantId, numberId);
  const p = normalizePhone(phone);
  if (!p) throw new Error('Teléfono inválido');
  return enqueueImmediate(n, p, 'test', message || '✅ Mensaje de prueba de Omnisync. Si lo recibes, WhatsApp está funcionando.', null, 'panel');
}

async function markSkipped(id: number, reason: string): Promise<void> {
  await pool.query(`UPDATE wa_queue SET status = 'skipped', last_error = $2, updated_at = now() WHERE id = $1`, [id, reason]);
}

function nextSendAt(n: WaNumber): Date {
  const jitter = n.jitter_sec > 0 ? Math.round((Math.random() * 2 - 1) * n.jitter_sec) : 0;
  return new Date(Date.now() + Math.max(15, n.interval_sec + jitter) * 1000);
}

/** ¿El error de Evolution dice que el número no tiene WhatsApp? */
function notOnWhatsapp(e: any): boolean {
  const msg = e?.body?.response?.message;
  if (Array.isArray(msg) && msg.some((m: any) => m && m.exists === false)) return true;
  return /exists["']?\s*:\s*false|not.*whatsapp/i.test(String(e?.message || ''));
}

/** Texto final: aviso + pie de BAJA (solo avisos) + firma (todo menos respuestas). */
function composeText(s: WaSettings, n: WaNumber, m: any): string {
  let text = m.message;
  if (m.kind === 'notice' && s.footer) text += `\n\n_${renderTemplate(s.footer, { baja: s.optout_word })}_`;
  if (n.signature && m.kind !== 'reply') text += `\n\n${n.signature}`;
  return text;
}

/** Envía una fila de la cola. Devuelve true si salió. */
async function sendRow(s: WaSettings, n: WaNumber, m: any): Promise<{ ok: boolean; detail: string }> {
  const text = composeText(s, n, m);
  const paced = m.kind === 'notice' || m.kind === 'invite' || m.kind === 'welcome';
  try {
    const delay = 1200 + Math.floor(Math.random() * 1800); // "escribiendo…" un momento: más natural
    if (m.media === 'qr' && n.qr_image) {
      const [, mime, b64] = n.qr_image.match(/^data:([^;]+);base64,(.+)$/) || [];
      await evo(`/message/sendMedia/${encodeURIComponent(n.instance_name)}`, 'POST',
        { number: m.phone, mediatype: 'image', mimetype: mime, media: b64, fileName: 'qr-pago.png', caption: text, delay }, 45_000);
    } else {
      await evo(`/message/sendText/${encodeURIComponent(n.instance_name)}`, 'POST', { number: m.phone, text, delay }, 30_000);
    }
    await pool.query(`UPDATE wa_queue SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL, updated_at = now() WHERE id = $1`, [m.id]);
    await pool.query(
      `UPDATE wa_numbers SET last_sent_at = now(), next_send_at = CASE WHEN $2 THEN $3::timestamptz ELSE next_send_at END WHERE id = $1`,
      [n.id, paced, nextSendAt(n).toISOString()]
    );
    return { ok: true, detail: `enviado #${m.id}` };
  } catch (e: any) {
    if (notOnWhatsapp(e)) {
      await pool.query(`UPDATE wa_subscribers SET not_on_whatsapp = true WHERE number_id = $1 AND phone = $2`, [n.id, m.phone]);
      await markSkipped(m.id, 'El número no tiene WhatsApp');
      return { ok: false, detail: 'sin WhatsApp' };
    }
    const attempts = Number(m.attempts) + 1;
    await pool.query(
      `UPDATE wa_queue SET status = $2, attempts = $3, last_error = $4,
         not_before = now() + make_interval(mins => $5::int), updated_at = now() WHERE id = $1`,
      [m.id, attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, String(e.message || e).slice(0, 500), 5 * attempts]
    );
    // Tras un error también se respeta la pausa: no martillar a WhatsApp
    if (paced) await pool.query(`UPDATE wa_numbers SET next_send_at = $2 WHERE id = $1`, [n.id, nextSendAt(n).toISOString()]);
    return { ok: false, detail: `error #${m.id}: ${e.message}` };
  }
}

async function claim(sql: string, params: any[]): Promise<any | null> {
  const { rows } = await pool.query(
    `UPDATE wa_queue SET status = 'sending', updated_at = now()
      WHERE id = (${sql} LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`, params
  );
  return rows[0] || null;
}

/** Respuestas, confirmaciones y pruebas: salen ya, sin pausa ni horario. */
async function sendImmediate(s: WaSettings, n: WaNumber): Promise<number> {
  let sent = 0;
  for (let i = 0; i < MAX_IMMEDIATE_PER_RUN; i++) {
    const m = await claim(
      `SELECT id FROM wa_queue WHERE number_id = $1 AND status = 'pending' AND kind = ANY($2::text[]) AND not_before <= now()
        ORDER BY created_at`, [n.id, IMMEDIATE_KINDS]
    );
    if (!m) break;
    if ((await sendRow(s, n, m)).ok) sent++;
  }
  return sent;
}

async function countToday(n: WaNumber, kinds: string[]): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM wa_queue
      WHERE number_id = $1 AND kind = ANY($2::text[]) AND status = 'sent'
        AND (sent_at AT TIME ZONE $3)::date = (now() AT TIME ZONE $3)::date`,
    [n.id, kinds, TZ]
  );
  return rows[0].n;
}

/** Presentación a un cliente que todavía no ha aceptado (tiene avisos esperando). */
async function sendInvite(s: WaSettings, n: WaNumber, sub: any): Promise<{ ok: boolean; detail: string }> {
  const text = renderTemplate(n.invite_template || DEFAULT_INVITE_TEMPLATE, templateVars(n, s, sub));
  const { rows } = await pool.query(
    `INSERT INTO wa_queue (tenant_id, number_id, kind, phone, message, event_type, priority, status, source, client_ref)
     VALUES ($1, $2, 'invite', $3, $4, 'invite', 0, 'sending', 'auto', $5) RETURNING *`,
    [n.tenant_id, n.id, sub.phone, text, sub.client_ref]
  );
  const r = await sendRow(s, n, rows[0]);
  if (r.ok) {
    await pool.query(`UPDATE wa_subscribers SET status = 'invited', invited_at = now() WHERE number_id = $1 AND phone = $2 AND status = 'new'`, [n.id, sub.phone]);
    return { ok: true, detail: `presentación a +${sub.phone}` };
  }
  if (r.detail === 'sin WhatsApp') {
    await pool.query(`UPDATE wa_queue SET status = 'skipped', last_error = 'El número no tiene WhatsApp', updated_at = now()
                       WHERE number_id = $1 AND phone = $2 AND status = 'waiting'`, [n.id, sub.phone]);
  } else {
    // La presentación fallida no se reintenta como fila: el cliente sigue "new" y se le presenta en otro turno
    await pool.query(`UPDATE wa_queue SET status = 'failed', updated_at = now() WHERE id = $1`, [rows[0].id]);
  }
  return r;
}

/** Un turno de envío para un número. Devuelve lo que pasó (para logs y pruebas). */
export async function dispatchNumber(s: WaSettings, n: WaNumber, ispName: string, now = new Date()): Promise<string> {
  const state = await refreshState(n);
  await alertOnState(s, n, ispName);
  if (state !== 'open') return `sesión ${state}`;

  // Pruebas, confirmaciones (SÍ/NO/BAJA) y respuestas del menú salen siempre;
  // "Envíos activos" apagado o la pausa solo detienen avisos, bienvenidas y presentaciones.
  const immediate = await sendImmediate(s, n);
  if (!s.enabled || s.paused || n.paused) return immediate ? `respuestas ${immediate}` : 'pausado';
  if (!inSendWindow(s, now)) return immediate ? `respuestas ${immediate}` : 'fuera de horario';
  if (n.next_send_at && new Date(n.next_send_at) > now) return immediate ? `respuestas ${immediate}` : 'esperando pausa';
  if ((await countToday(n, ['notice', 'invite', 'welcome'])) >= n.daily_cap) return 'tope diario';

  // Bienvenidas de clientes recién registrados: primero, y sin contar en el tope de presentaciones
  for (let i = 0; i < MAX_SKIPS_PER_RUN; i++) {
    const m = await claim(
      `SELECT id FROM wa_queue WHERE number_id = $1 AND status = 'pending' AND kind = 'welcome' AND not_before <= now()
        ORDER BY created_at`, [n.id]
    );
    if (!m) break;
    const sub = await getSubscriber(n, m.phone);
    if (sub.not_on_whatsapp) { await markSkipped(m.id, 'El número no tiene WhatsApp'); continue; }
    if (sub.status === 'subscribed') { await markSkipped(m.id, 'El cliente ya estaba suscrito'); continue; }
    if (['declined', 'opted_out'].includes(sub.status)) { await markSkipped(m.id, 'El cliente ya había dicho que no'); continue; }
    const r = await sendRow(s, n, m);
    if (r.ok) {
      await pool.query(
        `UPDATE wa_subscribers SET status = 'invited', invited_at = now() WHERE number_id = $1 AND phone = $2 AND status IN ('new', 'no_reply')`,
        [n.id, m.phone]
      );
    }
    return r.ok ? `bienvenida a +${m.phone}` : r.detail;
  }

  for (let i = 0; i < MAX_SKIPS_PER_RUN; i++) {
    const m = await claim(
      `SELECT id FROM wa_queue WHERE number_id = $1 AND status = 'pending' AND kind = 'notice' AND not_before <= now()
        ORDER BY priority, created_at`, [n.id]
    );
    if (!m) break;
    const sub = await getSubscriber(n, m.phone);
    if (sub.not_on_whatsapp) { await markSkipped(m.id, 'El número no tiene WhatsApp'); continue; }
    if (sub.status === 'opted_out') { await markSkipped(m.id, `El cliente pidió no recibir más (${s.optout_word})`); continue; }
    if (sub.status === 'declined') { await markSkipped(m.id, 'El cliente respondió NO a la presentación'); continue; }
    if (sub.status === 'no_reply') { await markSkipped(m.id, 'El cliente no respondió la presentación'); continue; }
    if (sub.status !== 'subscribed') {
      // new / invited: el aviso espera a que acepte
      await pool.query(`UPDATE wa_queue SET status = 'waiting', updated_at = now() WHERE id = $1`, [m.id]);
      continue;
    }
    return (await sendRow(s, n, m)).detail;
  }

  // Sin avisos para suscritos: presentación al cliente con el aviso en espera más antiguo
  if ((await countToday(n, ['invite'])) < n.invite_daily_cap) {
    const { rows } = await pool.query(
      `SELECT s.* FROM wa_subscribers s
         JOIN LATERAL (SELECT min(q.created_at) AS first_wait FROM wa_queue q
                        WHERE q.number_id = s.number_id AND q.phone = s.phone AND q.status = 'waiting') w ON w.first_wait IS NOT NULL
        WHERE s.number_id = $1 AND s.status = 'new' AND NOT s.not_on_whatsapp
        ORDER BY w.first_wait LIMIT 1`,
      [n.id]
    );
    if (rows[0]) return (await sendInvite(s, n, rows[0])).detail;
  }
  return 'cola vacía';
}

/** Vence presentaciones sin respuesta y avisos que esperaron demasiado. */
export async function expireWaiting(s: WaSettings): Promise<void> {
  await pool.query(
    `UPDATE wa_subscribers SET status = 'no_reply'
      WHERE tenant_id = $1 AND status = 'invited' AND invited_at < now() - make_interval(days => $2::int)`,
    [s.tenant_id, s.invite_wait_days]
  );
  await pool.query(
    `UPDATE wa_queue q SET status = 'skipped', updated_at = now(),
       last_error = CASE WHEN sb.status = 'no_reply' THEN 'El cliente no respondió la presentación'
                         ELSE 'No alcanzó a recibir la presentación (tope diario)' END
       FROM wa_subscribers sb
      WHERE q.tenant_id = $1 AND q.status = 'waiting' AND sb.number_id = q.number_id AND sb.phone = q.phone
        AND (sb.status = 'no_reply' OR (sb.status = 'new' AND q.created_at < now() - make_interval(days => $2::int)))`,
    [s.tenant_id, s.invite_wait_days]
  );
}

let running = false;

/** Cron cada minuto: por número, respuestas inmediatas y como máximo un aviso o presentación. */
export async function runWhatsappDispatcher(): Promise<void> {
  if (running || !EVO_KEY) return;
  running = true;
  try {
    // Mensajes que quedaron "enviando" por un reinicio vuelven a la cola
    await pool.query(`UPDATE wa_queue SET status = 'pending', updated_at = now() WHERE status = 'sending' AND updated_at < now() - interval '10 minutes'`);
    const { rows: tenants } = await pool.query(
      `SELECT s.*, t.name AS isp_name FROM wa_settings s JOIN tenants t ON t.id = s.tenant_id
        WHERE COALESCE(t.enable_whatsapp, false) AND COALESCE(t.is_active, true)`
    );
    for (const s of tenants) {
      try {
        await expireWaiting(s);
        const { rows: numbers } = await pool.query(`SELECT * FROM wa_numbers WHERE tenant_id = $1 ORDER BY id`, [s.tenant_id]);
        for (const n of numbers) {
          const r = await dispatchNumber(s, n, s.isp_name).catch((e: any) => `error: ${e.message}`);
          if (/^(enviado|error|presentación|respuestas)/.test(r)) console.log(`[WA] ${s.isp_name} · ${n.label}: ${r}`);
        }
      } catch (e: any) {
        console.error(`[WA] ${s.isp_name}:`, e.message);
      }
    }
  } finally {
    running = false;
  }
}

/** Envía ya las respuestas de un número (tras un mensaje del cliente), sin esperar al cron. */
async function flushImmediate(n: WaNumber): Promise<void> {
  const { rows } = await pool.query(`SELECT * FROM wa_settings WHERE tenant_id = $1`, [n.tenant_id]);
  if (!rows[0]) return;
  const { rows: fresh } = await pool.query(`SELECT * FROM wa_numbers WHERE id = $1`, [n.id]);
  if (fresh[0]?.connection_state === 'open') await sendImmediate(rows[0], fresh[0]);
}

/** Limpieza diaria: historial de más de 90 días. */
export async function cleanupWhatsapp(): Promise<number> {
  const a = await pool.query(`DELETE FROM wa_queue WHERE status IN ('sent','skipped','cancelled','failed') AND created_at < now() - interval '90 days'`);
  await pool.query(`DELETE FROM wa_session_events WHERE at < now() - interval '90 days'`);
  await pool.query(`DELETE FROM wa_interactions WHERE at < now() - interval '180 days'`);
  return a.rowCount || 0;
}

// ───────────────────────── Mensajes de los clientes ─────────────────────────

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

async function logInteraction(n: WaNumber, phone: string, action: string): Promise<void> {
  await pool.query(`INSERT INTO wa_interactions (tenant_id, number_id, phone, action) VALUES ($1, $2, $3, $4)`, [n.tenant_id, n.id, phone, action]);
}

/** Qué hacer con un mensaje de un cliente: SÍ / NO / BAJA / opción del menú / nada. */
export async function handleInbound(s: WaSettings, n: WaNumber, ispName: string, phone: string, text: string): Promise<string> {
  // El administrador recibe avisos por este número: lo que escriba no se trata como de un cliente
  if (await isStaffPhone(s, phone)) return 'administrador';
  const sub = await getSubscriber(n, phone);
  // El cliente solo se vincula verificando contra el CRM (ensureLinked), nunca por lo que escriba
  await pool.query(
    `UPDATE wa_subscribers SET last_inbound_at = now(), not_on_whatsapp = false WHERE number_id = $1 AND phone = $2`, [n.id, phone]
  );
  const word = firstWord(text);
  const reply = (msg: string) => enqueueImmediate(n, phone, 'system', msg);
  const isOptOut = Boolean(word) && word === firstWord(s.optout_word);

  // Solo se atiende a clientes del CRM: si este WhatsApp no está vinculado, se verifica primero
  // (su teléfono en el CRM o su ID de cliente). La BAJA se respeta siempre.
  if (s.require_crm_link && !sub.client_ref && !isOptOut) {
    if (!(await ensureLinked(s, n, ispName, phone, text, sub))) return 'vinculación';
  }
  const name = firstName(sub.client_name);

  if (isOptOut) {
    if (sub.status === 'opted_out') return 'ya estaba de baja';
    await pool.query(`UPDATE wa_subscribers SET status = 'opted_out', responded_at = now() WHERE number_id = $1 AND phone = $2`, [n.id, phone]);
    await pool.query(`UPDATE wa_queue SET status = 'skipped', last_error = 'El cliente pidió no recibir más', updated_at = now()
                       WHERE number_id = $1 AND phone = $2 AND status IN ('pending', 'waiting') AND kind = 'notice'`, [n.id, phone]);
    await logInteraction(n, phone, 'baja');
    await reply(`Listo, no te enviaremos más avisos por este medio. Si cambias de opinión responde *SÍ*.`);
    return 'baja';
  }
  if (word && wordList(s.decline_words).has(word) && ['new', 'invited'].includes(sub.status)) {
    await pool.query(`UPDATE wa_subscribers SET status = 'declined', responded_at = now() WHERE number_id = $1 AND phone = $2`, [n.id, phone]);
    await pool.query(`UPDATE wa_queue SET status = 'skipped', last_error = 'El cliente respondió NO a la presentación', updated_at = now()
                       WHERE number_id = $1 AND phone = $2 AND status IN ('pending', 'waiting') AND kind = 'notice'`, [n.id, phone]);
    await logInteraction(n, phone, 'no');
    await reply(`Entendido${name ? ', ' + name : ''}. No te enviaremos avisos por aquí. Si cambias de opinión responde *SÍ*.`);
    return 'rechazó';
  }
  const accepts = (word && wordList(s.optin_words).has(word)) || (s.optin_any_message && ['new', 'invited'].includes(sub.status));
  if (accepts && sub.status !== 'subscribed') {
    await pool.query(`UPDATE wa_subscribers SET status = 'subscribed', responded_at = now() WHERE number_id = $1 AND phone = $2`, [n.id, phone]);
    const { rowCount } = await pool.query(
      `UPDATE wa_queue SET status = 'pending', not_before = now(), updated_at = now()
        WHERE number_id = $1 AND phone = $2 AND status = 'waiting'`, [n.id, phone]
    );
    // Si tenía avisos esperando, que salgan pronto: el primero no espera la pausa completa
    if (rowCount) await pool.query(`UPDATE wa_numbers SET next_send_at = LEAST(next_send_at, now() + interval '20 seconds') WHERE id = $1`, [n.id]);
    await logInteraction(n, phone, 'si');
    await reply(`¡Listo${name ? ', ' + name : ''}! ✅ Desde ahora recibirás tus avisos por aquí. Para dejar de recibirlos responde *${s.optout_word}*.`);
    return 'aceptó';
  }
  if (sub.status === 'subscribed') {
    const r = menuReply(n, s, sub, text);
    if (r) {
      await logInteraction(n, phone, `menu:${r.option.key}`);
      await enqueueImmediate(n, phone, 'reply', r.message, r.option.media === 'qr' && n.qr_image ? 'qr' : null);
      if (r.option.support) {
        await notifySupport(n,
          `🙋 *Cliente pide un asesor por WhatsApp* — ${ispName} · ${n.label}\n` +
          `+${phone}${sub.client_name ? ' · ' + sub.client_name : ''}${sub.client_ref ? ' · cliente #' + sub.client_ref : ''}`).catch(() => undefined);
      }
      return `menú ${r.option.key}`;
    }
  }
  return 'mensaje libre';
}

/** Webhook interno de Evolution: conexión y mensajes que escriben los clientes. */
export async function handleEvolutionEvent(instance: string, secret: string, body: any): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT n.*, t.name AS isp_name FROM wa_numbers n JOIN tenants t ON t.id = n.tenant_id WHERE n.instance_name = $1`, [instance]
  );
  const n: WaNumber & { isp_name: string } = rows[0];
  if (!n || !secret || !safeEqual(secret, n.webhook_secret)) return false;
  const event = String(body?.event || '').toLowerCase().replace(/_/g, '.');
  const data = body?.data || {};

  if (event === 'connection.update') {
    const state = String(data.state || 'close');
    const number = data.wuid ? String(data.wuid).split('@')[0].split(':')[0] : null;
    await setState(n, state, data.statusReason ? `Motivo ${data.statusReason}` : null, number);
    return true;
  }

  if (event === 'messages.upsert') {
    const s = await getSettings(n.tenant_id);
    const items = (Array.isArray(data) ? data : [data])
      .filter((it: any) => !it?.key?.fromMe && !String(it?.key?.remoteJid || '').endsWith('@g.us')) // grupos no
      .map((it: any) => ({ phone: inboundPhone(it?.key), text: messageText(it?.message) }))
      .filter((it: any) => it.phone);
    if (!items.length) return true;
    // Se responde a Evolution de una vez: verificar contra el CRM puede tardar y un webhook
    // lento haría que Evolution lo reintente (mensajes procesados dos veces).
    (async () => {
      for (const it of items) {
        await handleInbound(s, n, n.isp_name, it.phone, it.text).catch((e) => console.warn('[WA] mensaje entrante:', e.message));
      }
      await flushImmediate(n);
    })().catch((e) => console.warn('[WA] respuesta inmediata:', e.message));
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
  s: { interval_sec: number; hour_start: number; hour_end: number; days: string; daily_cap: number; next_send_at: string | null },
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
  waiting: number;
  failure_rate_7d: number;     // 0..1 sobre intentos terminados
  not_on_wa_share_30d: number; // 0..1 de omitidos por no tener WhatsApp
  invited_30d: number;         // presentaciones enviadas
  accepted_30d: number;
  declined_30d: number;
  no_reply_30d: number;
  optout_30d: number;
  subscribed: number;
  notices_sent_30d: number;
  menu_uses_30d: number;
  disconnects_7d: number;
  cap_hits_7d: number;
}

const RANK: Record<RiskLevel, number> = { ok: 0, info: 1, warn: 2, high: 3 };

/** Reglas de recomendación (puras, se pueden probar sin base). */
export function recommend(
  n: { interval_sec: number; daily_cap: number; invite_daily_cap: number },
  s: { hour_start: number; hour_end: number },
  m: WaMetrics,
  now = new Date()
): { risk: RiskLevel; items: Recommendation[] } {
  const items: Recommendation[] = [];
  const fmt = (d: Date) => d.toLocaleString('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  if (m.pending > 0) {
    if (!m.eta) {
      items.push({ level: 'high', title: 'La cola no alcanza a salir', detail: `Hay ${m.pending} avisos en cola y con la configuración actual no terminarían en 60 días. Revisa el horario, los días y el tope diario.` });
    } else if (localParts(m.eta).dateKey !== localParts(now).dateKey) {
      items.push({ level: 'warn', title: 'La cola terminará otro día', detail: `Hay ${m.pending} avisos en cola; con la pausa de ${Math.round(n.interval_sec / 60 * 10) / 10} min terminarán el ${fmt(m.eta)}; si son facturas, considera enviarlas por correo o no mandar recordatorios ese día. No bajes la pausa: sube el riesgo de bloqueo.` });
    }
  }
  if (n.interval_sec < 60) {
    items.push({ level: 'high', title: 'Pausa muy corta', detail: `Enviar cada ${n.interval_sec} s parece un robot para WhatsApp. Usa 2 minutos o más.` });
  } else if (n.interval_sec < 90) {
    items.push({ level: 'warn', title: 'Pausa corta', detail: 'Menos de 90 s entre mensajes aumenta el riesgo. Lo recomendado son 2 minutos con variación al azar.' });
  }
  if (n.invite_daily_cap > 60) {
    items.push({ level: 'high', title: 'Demasiadas presentaciones al día', detail: `Escribirle a ${n.invite_daily_cap} desconocidos al día es lo que más bloquea números. Lo recomendado son 20 a 30.` });
  }
  if (m.avg_sent_per_day_7d > 500) {
    items.push({ level: 'high', title: 'Volumen alto para WhatsApp por QR', detail: `Promedio de ${Math.round(m.avg_sent_per_day_7d)} mensajes al día. Con este volumen conviene la API oficial de Meta (se paga por conversación, sin riesgo de bloqueo).` });
  } else if (m.avg_sent_per_day_7d > 200) {
    items.push({ level: 'warn', title: 'Volumen considerable', detail: `Promedio de ${Math.round(m.avg_sent_per_day_7d)} mensajes al día. Manténlo así solo si el número tiene meses de uso; ten un segundo chip calentado de respaldo.` });
  }
  if (m.max_sent_day_30d > 300) {
    items.push({ level: 'info', title: 'Picos de envío', detail: `El día con más envíos del último mes llegó a ${m.max_sent_day_30d}. Si es el día de facturación, reparte la generación de facturas en varios días.` });
  }
  const answered = m.accepted_30d + m.declined_30d + m.no_reply_30d;
  if (answered >= 20) {
    const acc = m.accepted_30d / answered;
    if (acc < 0.3) {
      items.push({ level: 'warn', title: 'Pocos clientes aceptan la presentación', detail: `Solo ${pct(acc)} respondió SÍ. Revisa el texto (que diga quién eres y qué ganan), pon el número en la factura y pide a los técnicos que el cliente escriba al instalar.` });
    }
    if (m.declined_30d / answered > 0.2) {
      items.push({ level: 'warn', title: 'Muchos responden NO', detail: `${pct(m.declined_30d / answered)} rechazó la presentación. Baja el tope de presentaciones y revisa el texto: los rechazos y reportes llevan a bloqueos.` });
    }
  }
  if (m.subscribed > 0 && m.optout_30d / m.subscribed > 0.05) {
    items.push({ level: 'warn', title: 'Clientes dándose de baja', detail: `${m.optout_30d} suscritos pidieron la baja este mes. Revisa cuántos avisos mandas y su tono.` });
  }
  if (m.waiting > 0 && n.invite_daily_cap > 0 && m.waiting / n.invite_daily_cap > 3) {
    items.push({ level: 'info', title: 'Avisos esperando presentación', detail: `${m.waiting} avisos esperan que el cliente acepte. Con ${n.invite_daily_cap} presentaciones al día tardarías unos ${Math.ceil(m.waiting / n.invite_daily_cap)} días; los que pasen del plazo se omiten. Invitar por SMS o en la factura acelera esto sin riesgo.` });
  }
  if (m.notices_sent_30d >= 30 && m.menu_uses_30d / m.notices_sent_30d < 0.05) {
    items.push({ level: 'info', title: 'Casi nadie usa el menú', detail: 'Menos del 5% de los avisos recibe respuesta. Prueba opciones más útiles (saldo, QR de pago): las conversaciones mantienen sano el número.' });
  }
  if (m.failure_rate_7d > 0.1) {
    items.push({ level: 'warn', title: 'Muchos envíos fallan', detail: `${pct(m.failure_rate_7d)} de los envíos de la semana fallaron. Revisa la conexión y los teléfonos de los clientes en el CRM.` });
  }
  if (m.not_on_wa_share_30d > 0.05) {
    items.push({ level: 'info', title: 'Teléfonos sin WhatsApp', detail: `${pct(m.not_on_wa_share_30d)} de los avisos iban a números sin WhatsApp. Corrige esos teléfonos en el CRM.` });
  }
  if (m.disconnects_7d >= 3) {
    items.push({ level: 'high', title: 'La sesión se cae seguido', detail: `${m.disconnects_7d} desconexiones esta semana. Puede ser un aviso de WhatsApp antes de un bloqueo: baja el volumen unos días y revisa el teléfono vinculado.` });
  }
  if (m.cap_hits_7d > 0) {
    items.push({ level: 'info', title: 'Se alcanzó el tope diario', detail: `${m.cap_hits_7d} día(s) de esta semana llegaron al tope de ${n.daily_cap}. Lo que falte sale al día siguiente.` });
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

async function numberStats(s: WaSettings, n: WaNumber, days: number) {
  const q = (sql: string, params: any[] = []) => pool.query(sql, [n.id, TZ, ...params]).then((r) => r.rows);
  const [totals, perDay, perHour, byEvent, funnel, menu, disc] = await Promise.all([
    q(`SELECT
         count(*) FILTER (WHERE status = 'pending' AND kind = 'notice')::int AS pending,
         count(*) FILTER (WHERE status = 'waiting')::int AS waiting,
         count(*) FILTER (WHERE status = 'sent' AND kind IN ('notice','invite','welcome') AND (sent_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date)::int AS sent_today,
         count(*) FILTER (WHERE status = 'sent' AND sent_at > now() - interval '7 days')::int AS sent_7d,
         count(*) FILTER (WHERE status = 'sent' AND sent_at > now() - interval '30 days')::int AS sent_30d,
         count(*) FILTER (WHERE status = 'sent' AND kind = 'notice' AND sent_at > now() - interval '30 days')::int AS notices_sent_30d,
         count(*) FILTER (WHERE status = 'sent' AND kind IN ('invite','welcome') AND sent_at > now() - interval '30 days')::int AS invites_30d,
         count(*) FILTER (WHERE status = 'sent' AND kind IN ('invite','welcome') AND (sent_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date)::int AS invites_today,
         count(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '7 days')::int AS failed_7d,
         count(*) FILTER (WHERE status = 'skipped' AND updated_at > now() - interval '30 days')::int AS skipped_30d,
         count(*) FILTER (WHERE status = 'skipped' AND last_error LIKE '%no tiene WhatsApp%' AND updated_at > now() - interval '30 days')::int AS not_on_wa_30d,
         count(*) FILTER (WHERE status IN ('sent','skipped','failed') AND kind = 'notice' AND updated_at > now() - interval '30 days')::int AS finished_30d,
         count(*) FILTER (WHERE status IN ('sent','failed') AND updated_at > now() - interval '7 days')::int AS attempted_7d
       FROM wa_queue WHERE number_id = $1`),
    q(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
              count(w.*) FILTER (WHERE w.status = 'sent' AND w.kind = 'notice')::int AS sent,
              count(w.*) FILTER (WHERE w.status = 'sent' AND w.kind IN ('invite','welcome'))::int AS invites,
              count(w.*) FILTER (WHERE w.status = 'sent' AND w.kind IN ('reply','system'))::int AS replies,
              count(w.*) FILTER (WHERE w.status = 'failed')::int AS failed,
              count(w.*) FILTER (WHERE w.status = 'skipped')::int AS skipped
         FROM generate_series((now() AT TIME ZONE $2)::date - ($3::int - 1), (now() AT TIME ZONE $2)::date, interval '1 day') d
         LEFT JOIN wa_queue w ON w.number_id = $1
              AND (COALESCE(w.sent_at, w.updated_at) AT TIME ZONE $2)::date = d::date
              AND w.status IN ('sent','failed','skipped')
        GROUP BY d ORDER BY d`, [days]),
    q(`SELECT extract(hour FROM sent_at AT TIME ZONE $2)::int AS hour, count(*)::int AS sent
         FROM wa_queue WHERE number_id = $1 AND status = 'sent' AND kind IN ('notice','invite','welcome') AND sent_at > now() - interval '7 days'
        GROUP BY 1 ORDER BY 1`),
    q(`SELECT event_type, count(*) FILTER (WHERE status = 'sent')::int AS sent,
              count(*) FILTER (WHERE status IN ('pending','waiting'))::int AS pending
         FROM wa_queue WHERE number_id = $1 AND $2::text IS NOT NULL AND kind = 'notice' AND created_at > now() - interval '30 days'
        GROUP BY 1 ORDER BY 2 DESC`),
    q(`SELECT count(*) FILTER (WHERE status = 'subscribed')::int AS subscribed,
              count(*) FILTER (WHERE status = 'invited')::int AS invited_now,
              count(*) FILTER (WHERE status = 'declined')::int AS declined,
              count(*) FILTER (WHERE status = 'no_reply')::int AS no_reply,
              count(*) FILTER (WHERE status = 'opted_out')::int AS opted_out,
              count(*) FILTER (WHERE status = 'subscribed' AND responded_at > now() - interval '30 days')::int AS accepted_30d,
              count(*) FILTER (WHERE status = 'declined' AND responded_at > now() - interval '30 days')::int AS declined_30d,
              count(*) FILTER (WHERE status = 'no_reply' AND invited_at > now() - interval '40 days')::int AS no_reply_30d,
              count(*) FILTER (WHERE status = 'opted_out' AND responded_at > now() - interval '30 days')::int AS optout_30d
         FROM wa_subscribers WHERE number_id = $1 AND $2::text IS NOT NULL`),
    q(`SELECT action, count(*)::int AS n FROM wa_interactions
        WHERE number_id = $1 AND $2::text IS NOT NULL AND at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC`),
    q(`SELECT count(*)::int AS n FROM wa_session_events
        WHERE number_id = $1 AND $2::text IS NOT NULL AND state <> 'open' AND at > now() - interval '7 days'`),
  ]);
  const t = totals[0], f = funnel[0];
  const last7 = perDay.slice(-7);
  const menuUses = menu.filter((r: any) => String(r.action).startsWith('menu:')).reduce((a: number, r: any) => a + r.n, 0);
  const metrics: WaMetrics = {
    avg_sent_per_day_7d: last7.reduce((a: number, d: any) => a + d.sent + d.invites, 0) / 7,
    max_sent_day_30d: perDay.slice(-30).reduce((a: number, d: any) => Math.max(a, d.sent + d.invites), 0),
    pending: t.pending,
    eta: estimateFinish(t.pending, { ...n, hour_start: s.hour_start, hour_end: s.hour_end, days: s.days }, t.sent_today),
    waiting: t.waiting,
    failure_rate_7d: t.attempted_7d ? t.failed_7d / t.attempted_7d : 0,
    not_on_wa_share_30d: t.finished_30d ? t.not_on_wa_30d / t.finished_30d : 0,
    invited_30d: t.invites_30d,
    accepted_30d: f.accepted_30d,
    declined_30d: f.declined_30d,
    no_reply_30d: f.no_reply_30d,
    optout_30d: f.optout_30d,
    subscribed: f.subscribed,
    notices_sent_30d: t.notices_sent_30d,
    menu_uses_30d: menuUses,
    disconnects_7d: disc[0].n,
    cap_hits_7d: last7.filter((d: any) => d.sent + d.invites >= n.daily_cap).length,
  };
  const rec = recommend(n, s, metrics);
  return { totals: t, funnel: f, per_day: perDay, per_hour: perHour, by_event: byEvent, interactions: menu, metrics, risk: rec.risk, recommendations: rec.items };
}

/** Panel: un número o todos los del ISP (sumados, con recomendaciones de cada uno). */
export async function getStats(tenantId: string, days = 30, numberId: number | null = null) {
  days = Math.min(90, Math.max(7, Math.round(days) || 30));
  const s = await getSettings(tenantId);
  const numbers = numberId ? [await getNumber(tenantId, numberId)] : await listNumbers(tenantId);
  const per = await Promise.all(numbers.map((n) => numberStats(s, n, days)));

  const sumObj = (list: any[]) => list.reduce((acc, o) => {
    for (const [k, v] of Object.entries(o || {})) if (typeof v === 'number') acc[k] = (acc[k] || 0) + v;
    return acc;
  }, {} as Record<string, number>);
  const perDay = per[0].per_day.map((d: any, i: number) => {
    const out: any = { day: d.day };
    for (const k of ['sent', 'invites', 'replies', 'failed', 'skipped']) out[k] = per.reduce((a, p) => a + (p.per_day[i]?.[k] || 0), 0);
    return out;
  });
  const perHour = Array.from({ length: 24 }, (_, h) => ({
    hour: h, sent: per.reduce((a, p) => a + (p.per_hour.find((r: any) => r.hour === h)?.sent || 0), 0),
  }));
  const merge = (key: 'by_event' | 'interactions', id: string) => {
    const m = new Map<string, any>();
    for (const p of per) for (const r of p[key]) {
      const cur = m.get(r[id]) || { [id]: r[id] };
      for (const [k, v] of Object.entries(r)) if (typeof v === 'number') cur[k] = (cur[k] || 0) + v;
      m.set(r[id], cur);
    }
    return [...m.values()];
  };
  const RANK_ORDER = ['high', 'warn', 'info', 'ok'];
  const recs = per.flatMap((p, i) => p.recommendations
    .filter((r) => numbers.length === 1 || r.level !== 'ok')
    .map((r) => ({ ...r, number: numbers.length > 1 ? numbers[i].label : undefined })));
  const risk = per.map((p) => p.risk).sort((a, b) => RANK_ORDER.indexOf(a) - RANK_ORDER.indexOf(b))[0] || 'ok';
  const etas = per.map((p) => p.metrics.eta).filter(Boolean) as Date[];

  return {
    totals: sumObj(per.map((p) => p.totals)),
    funnel: sumObj(per.map((p) => p.funnel)),
    per_day: perDay,
    per_hour: perHour,
    by_event: merge('by_event', 'event_type').map((r: any) => ({ ...r, label: EVENT_LABELS[r.event_type] || r.event_type })),
    interactions: merge('interactions', 'action').sort((a: any, b: any) => b.n - a.n),
    metrics: {
      ...sumObj(per.map((p) => ({ ...p.metrics, eta: 0 }))),
      eta: etas.length ? new Date(Math.max(...etas.map((d) => d.getTime()))).toISOString() : null,
      failure_rate_7d: Math.max(...per.map((p) => p.metrics.failure_rate_7d)),
    },
    risk,
    recommendations: recs.length ? recs : [{ level: 'ok', title: 'Volumen saludable', detail: 'La cola va al día y el ritmo de envío es seguro.' }],
    numbers: numbers.map((n, i) => ({
      id: n.id, label: n.label, state: n.connection_state, number: n.connected_number, risk: per[i].risk,
      daily_cap: n.daily_cap, invite_daily_cap: n.invite_daily_cap, interval_sec: n.interval_sec, paused: n.paused,
    })),
    settings: { hour_start: s.hour_start, hour_end: s.hour_end, paused: s.paused, enabled: s.enabled },
  };
}

/** Resumen de todos los ISP con el módulo (solo super admin). */
export async function getOverview() {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, COALESCE(t.enable_whatsapp, false) AS module, COALESCE(t.wa_max_numbers, 1) AS max_numbers,
            s.enabled, s.paused,
            (SELECT count(*) FROM wa_numbers n WHERE n.tenant_id = t.id)::int AS numbers,
            (SELECT count(*) FROM wa_numbers n WHERE n.tenant_id = t.id AND n.connection_state = 'open')::int AS connected,
            (SELECT count(*) FROM wa_queue w WHERE w.tenant_id = t.id AND w.status = 'pending')::int AS pending,
            (SELECT count(*) FROM wa_queue w WHERE w.tenant_id = t.id AND w.status = 'waiting')::int AS waiting,
            (SELECT count(*) FROM wa_queue w WHERE w.tenant_id = t.id AND w.status = 'sent' AND w.sent_at > now() - interval '24 hours')::int AS sent_24h,
            (SELECT count(*) FROM wa_queue w WHERE w.tenant_id = t.id AND w.status = 'failed' AND w.updated_at > now() - interval '7 days')::int AS failed_7d
       FROM tenants t LEFT JOIN wa_settings s ON s.tenant_id = t.id
      WHERE COALESCE(t.enable_whatsapp, false) OR s.tenant_id IS NOT NULL
      ORDER BY t.name`
  );
  return rows;
}
