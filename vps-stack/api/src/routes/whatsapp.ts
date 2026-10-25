import { Router, Request, Response } from 'express';
import { pool } from '../lib/db';
import { AuthRequest, requireRole } from '../middleware/auth';
import {
  getSettings, publicSettings, saveSettings, regenerateApiKey, tenantByApiKey,
  listNumbers, getNumber, publicNumber, createNumber, updateNumber, deleteNumber, setDefaultNumber, setNumberQr,
  connectNumber, logoutNumber, refreshState, listOrgs, assignOrg, listSubscribers,
  enqueue, enqueueTest, getStats, getOverview, handleEvolutionEvent, manualLink, MAX_ATTEMPTS,
  unlinkSubscriber, resetSubscriber, setNumberOrgs, syncOrgs, announceToNumber, setOrgMuted,
} from '../lib/whatsapp';

/**
 * WhatsApp por ISP (Evolution API). Cada ISP ve y maneja solo lo suyo; el
 * super admin sin ISP elige uno con ?tenant_id= y tiene un resumen global.
 * Rutas públicas: /api/public/whatsapp/enqueue (plugin UISP, clave por ISP) y
 * /api/public/whatsapp/evolution/:instancia (eventos internos de Evolution).
 */
export const whatsappRouter = Router();
export const whatsappPublicRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN = requireRole('super_admin', 'admin');

/** ISP sobre el que se actúa: el del usuario o, para el super admin, el elegido. */
function tenantOf(req: AuthRequest, res: Response): string | null {
  if (req.tenantId) return req.tenantId;
  const t = String(req.query.tenant_id || req.body?.tenant_id || '');
  if (req.userRole === 'super_admin' && UUID.test(t)) return t;
  res.status(400).json({ error: 'Elige un ISP' });
  return null;
}

const fail = (res: Response, e: any, status = 400) => {
  const code = Number(e?.status);
  res.status(code >= 400 && code < 600 ? (code === 404 && e?.body !== undefined ? 502 : code) : status)
    .json({ error: e?.message || String(e) });
};

/** Envuelve una ruta: resuelve el ISP y captura errores (Express 4 no captura async). */
const route = (fn: (t: string, req: AuthRequest, res: Response) => Promise<any>, status = 400) =>
  async (req: AuthRequest, res: Response) => {
    const t = tenantOf(req, res);
    if (!t) return;
    try {
      const data = await fn(t, req, res);
      if (!res.headersSent) res.json({ data });
    } catch (e) { fail(res, e, status); }
  };

const numId = (req: AuthRequest) => Number(req.params.id) || 0;

// ── Resumen de todos los ISP (super admin) ──
whatsappRouter.get('/overview', requireRole('super_admin'), async (_req: AuthRequest, res: Response) => {
  try { res.json({ data: await getOverview() }); } catch (e) { fail(res, e, 500); }
});

// ── Reglas del ISP ──
whatsappRouter.get('/settings', route(async (t) => {
  const s = publicSettings(await getSettings(t) as any);
  const { rows } = await pool.query(`SELECT COALESCE(wa_max_numbers, 1) AS max_numbers FROM tenants WHERE id = $1`, [t]);
  return { ...s, max_numbers: rows[0]?.max_numbers ?? 1 };
}, 500));
whatsappRouter.put('/settings', ADMIN, route(async (t, req) => publicSettings(await saveSettings(t, req.body || {}) as any)));
whatsappRouter.post('/pause', route(async (t, req) => {
  await getSettings(t);
  const paused = req.body?.paused !== false;
  await pool.query(`UPDATE wa_settings SET paused = $2, updated_at = now() WHERE tenant_id = $1`, [t, paused]);
  return { paused };
}, 500));
whatsappRouter.post('/api-key', ADMIN, route(async (t) => ({ api_key: await regenerateApiKey(t) }), 500));

// ── Números ──
whatsappRouter.get('/numbers', route(async (t) => (await listNumbers(t)).map(publicNumber), 500));
whatsappRouter.post('/numbers', ADMIN, route(async (t, req) => publicNumber(await createNumber(t, req.body || {}))));
whatsappRouter.put('/numbers/:id', ADMIN, route(async (t, req) => publicNumber(await updateNumber(t, numId(req), req.body || {}))));
whatsappRouter.delete('/numbers/:id', ADMIN, route(async (t, req) => { await deleteNumber(t, numId(req)); return { ok: true }; }));
whatsappRouter.post('/numbers/:id/default', ADMIN, route(async (t, req) => { await setDefaultNumber(t, numId(req)); return { ok: true }; }));
whatsappRouter.post('/numbers/:id/pause', route(async (t, req) =>
  publicNumber(await updateNumber(t, numId(req), { paused: req.body?.paused !== false }))));

/** Imagen del QR de pago (para el menú "Medios de pago"). */
whatsappRouter.get('/numbers/:id/qr', route(async (t, req) => ({ image: (await getNumber(t, numId(req))).qr_image }), 500));
whatsappRouter.put('/numbers/:id/qr', ADMIN, route(async (t, req) => {
  await setNumberQr(t, numId(req), req.body?.image ?? null);
  return { ok: true };
}));

// Sesión del número (QR de WhatsApp)
whatsappRouter.get('/numbers/:id/session', route(async (t, req) => {
  const n = await getNumber(t, numId(req));
  const state = await refreshState(n);
  return { state, number: n.connected_number, since: n.state_changed_at, instance: n.instance_name };
}, 500));
whatsappRouter.post('/numbers/:id/connect', ADMIN, route(async (t, req) => connectNumber(t, numId(req)), 502));
whatsappRouter.post('/numbers/:id/logout', ADMIN, route(async (t, req) => { await logoutNumber(t, numId(req)); return { state: 'close' }; }, 502));

/** Mensaje de prueba: sale de inmediato y no exige que el número haya aceptado. */
whatsappRouter.post('/numbers/:id/test', route(async (t, req) => ({
  id: await enqueueTest(t, numId(req), req.body?.phone, String(req.body?.message || '').trim()),
})));

// ── Organizaciones de UISP ──
whatsappRouter.get('/orgs', route(async (t) => listOrgs(t), 500));
whatsappRouter.post('/orgs/sync', ADMIN, route(async (t) => syncOrgs(t)));
/** Organizaciones que atiende un número (no se puede repetir una organización en dos números). */
whatsappRouter.put('/numbers/:id/orgs', ADMIN, route(async (t, req) => {
  await setNumberOrgs(t, numId(req), Array.isArray(req.body?.org_ids) ? req.body.org_ids : []);
  return { ok: true };
}));
/** Anuncio a todos los suscritos del número (p. ej. cambio de número), con la pausa normal. */
whatsappRouter.post('/numbers/:id/announce', ADMIN, route(async (t, req) =>
  announceToNumber(t, numId(req), String(req.body?.message || ''))));
whatsappRouter.put('/orgs/:id', ADMIN, route(async (t, req) => {
  // { number_id } asigna número (o null = por defecto); { muted } pausa o activa la organización
  if (typeof req.body?.muted === 'boolean') await setOrgMuted(t, numId(req), req.body.muted);
  if (req.body && 'number_id' in req.body) {
    const n = req.body.number_id;
    await assignOrg(t, numId(req), n === null || n === '' || n === undefined ? null : Number(n));
  }
  return { ok: true };
}));

// ── Suscriptores ──
const SUB_STATUSES = new Set(['new', 'invited', 'subscribed', 'declined', 'no_reply', 'opted_out', 'unlinked']);

/** Vincular a mano un WhatsApp con un ID de cliente del CRM (se verifica con el plugin si está). */
whatsappRouter.post('/subscribers/link', route(async (t, req) =>
  manualLink(t, Number(req.body?.number_id) || 0, String(req.body?.phone || ''), Number(req.body?.client_id))));
/** Quitar la vinculación (se verifica de nuevo con su próximo mensaje). */
whatsappRouter.post('/subscribers/unlink', route(async (t, req) => {
  await unlinkSubscriber(t, Number(req.body?.number_id) || 0, String(req.body?.phone || ''));
  return { ok: true };
}));
/** Reiniciar para pruebas: queda como nuevo y sus avisos omitidos recientes vuelven a la cola. */
whatsappRouter.post('/subscribers/reset', ADMIN, route(async (t, req) =>
  resetSubscriber(t, Number(req.body?.number_id) || 0, String(req.body?.phone || ''))));
whatsappRouter.get('/subscribers', route(async (t, req) => listSubscribers(t, {
  number_id: Number(req.query.number_id) || null,
  status: SUB_STATUSES.has(String(req.query.status)) ? String(req.query.status) : null,
  q: String(req.query.q || '').trim().slice(0, 60) || null,
  limit: Math.min(200, Math.max(10, Number(req.query.limit) || 50)),
  offset: Math.max(0, Number(req.query.offset) || 0),
}), 500));

// ── Cola ──
const STATUSES = new Set(['pending', 'waiting', 'sending', 'sent', 'failed', 'cancelled', 'skipped']);

whatsappRouter.get('/queue', route(async (t, req) => {
  const status = STATUSES.has(String(req.query.status)) ? String(req.query.status) : null;
  const search = String(req.query.q || '').trim().slice(0, 60) || null;
  const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const { rows } = await pool.query(
    `SELECT q.id, q.number_id, n.label AS number_label, q.kind, q.phone, q.message, q.event_type, q.priority, q.status,
            q.attempts, q.last_error, q.source, q.client_ref, q.created_at, q.sent_at, q.not_before, count(*) OVER () AS total
       FROM wa_queue q LEFT JOIN wa_numbers n ON n.id = q.number_id
      WHERE q.tenant_id = $1 AND ($2::text IS NULL OR q.status = $2) AND ($6::int IS NULL OR q.number_id = $6)
        AND ($3::text IS NULL OR q.phone LIKE '%' || $3 || '%' OR q.client_ref = $3 OR q.message ILIKE '%' || $3 || '%')
      ORDER BY CASE WHEN q.status IN ('pending','sending','waiting') THEN 0 ELSE 1 END,
               CASE WHEN q.status IN ('pending','sending','waiting') THEN q.priority END,
               CASE WHEN q.status IN ('pending','sending','waiting') THEN q.created_at END,
               COALESCE(q.sent_at, q.created_at) DESC
      LIMIT $4 OFFSET $5`,
    [t, status, search, limit, offset, Number(req.query.number_id) || null]
  );
  return { items: rows.map(({ total, ...r }) => r), total: Number(rows[0]?.total || 0), max_attempts: MAX_ATTEMPTS };
}, 500));

whatsappRouter.post('/queue/:id/retry', route(async (t, req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE wa_queue SET status = 'pending', attempts = 0, last_error = NULL, not_before = now(), updated_at = now()
      WHERE id = $1 AND tenant_id = $2 AND kind = 'notice' AND status IN ('failed','cancelled','skipped')`,
    [numId(req), t]
  );
  if (!rowCount) return void res.status(404).json({ error: 'No se puede reintentar ese mensaje' });
  return { ok: true };
}));

whatsappRouter.post('/queue/:id/cancel', route(async (t, req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE wa_queue SET status = 'cancelled', updated_at = now() WHERE id = $1 AND tenant_id = $2 AND status IN ('pending','waiting')`,
    [numId(req), t]
  );
  if (!rowCount) return void res.status(404).json({ error: 'Ese mensaje ya no está pendiente' });
  return { ok: true };
}));

/** Cancela en bloque los pendientes (opcional: solo de un tipo de aviso o de un número). */
whatsappRouter.post('/queue/cancel-pending', ADMIN, route(async (t, req) => {
  const event = /^[a-z_]{2,40}$/.test(String(req.body?.event_type || '')) ? String(req.body.event_type) : null;
  const { rowCount } = await pool.query(
    `UPDATE wa_queue SET status = 'cancelled', updated_at = now()
      WHERE tenant_id = $1 AND status IN ('pending','waiting') AND kind = 'notice'
        AND ($2::text IS NULL OR event_type = $2) AND ($3::int IS NULL OR number_id = $3)`,
    [t, event, Number(req.body?.number_id) || null]
  );
  return { cancelled: rowCount || 0 };
}, 500));

// ── Estadísticas, panel y recomendaciones ──
whatsappRouter.get('/stats', route(async (t, req) =>
  getStats(t, Number(req.query.days) || 30, Number(req.query.number_id) || null), 500));

// ───────────────────────── Públicas ─────────────────────────

/**
 * Plugin UISP: encola un aviso. Clave del ISP en X-Api-Key (o Bearer).
 * Cuerpo: { phone, message, event, client_id, client_name, organization: { id, name },
 *           uisp, context: { invoice_number, due_date, amount, balance, month }, dedupe_key }
 */
whatsappPublicRouter.post('/enqueue', async (req: Request, res: Response) => {
  const key = String(req.headers['x-api-key'] || '').trim()
    || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  try {
    const tenantId = await tenantByApiKey(key);
    if (!tenantId) return res.status(401).json({ error: 'Clave de API inválida o módulo WhatsApp apagado' });
    const b = req.body || {};
    const org = b.organization && typeof b.organization === 'object'
      ? b.organization
      : (b.organization_id != null ? { id: b.organization_id, name: b.organization_name } : null);
    const r = await enqueue(tenantId, {
      phone: b.phone, message: b.message, event: b.event,
      client_ref: b.client_id ?? b.client_ref, client_name: b.client_name,
      organization: org, uisp: b.uisp, context: b.context,
      dedupe_key: b.dedupe_key, source: String(b.source || 'uisp').slice(0, 30), lookup_url: b.lookup_url,
    });
    res.status(r.duplicate ? 200 : 201).json({ data: r });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/** Eventos de Evolution (solo red interna; protegido por el secreto de cada número). */
whatsappPublicRouter.post('/evolution/:instance', async (req: Request, res: Response) => {
  try {
    const ok = await handleEvolutionEvent(String(req.params.instance), String(req.query.s || ''), req.body);
    res.status(ok ? 200 : 401).json({ ok });
  } catch (e: any) {
    console.error('[WA] evento Evolution:', e.message);
    res.status(200).json({ ok: false }); // no hacer que Evolution reintente en bucle
  }
});
