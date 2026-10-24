import { Router, Request, Response } from 'express';
import { pool } from '../lib/db';
import { AuthRequest, requireRole } from '../middleware/auth';
import {
  getSettings, publicSettings, saveSettings, regenerateApiKey, tenantByApiKey,
  connectSession, logoutSession, refreshState, enqueue, getStats, getOverview,
  handleEvolutionEvent, normalizePhone, MAX_ATTEMPTS,
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

/** ISP sobre el que se actúa: el del usuario o, para el super admin, el elegido. */
function tenantOf(req: AuthRequest, res: Response): string | null {
  if (req.tenantId) return req.tenantId;
  const t = String(req.query.tenant_id || req.body?.tenant_id || '');
  if (req.userRole === 'super_admin' && UUID.test(t)) return t;
  res.status(400).json({ error: 'Elige un ISP' });
  return null;
}

const fail = (res: Response, e: any, status = 400) =>
  res.status(e?.status && e.status >= 400 && e.status < 600 ? (e.status === 404 ? 502 : e.status) : status)
    .json({ error: e?.message || String(e) });

// ── Resumen de todos los ISP (super admin) ──
whatsappRouter.get('/overview', requireRole('super_admin'), async (_req: AuthRequest, res: Response) => {
  try { res.json({ data: await getOverview() }); } catch (e) { fail(res, e, 500); }
});

// ── Configuración ──
whatsappRouter.get('/settings', async (req: AuthRequest, res: Response) => {
  const t = tenantOf(req, res); if (!t) return;
  try { res.json({ data: publicSettings(await getSettings(t)) }); } catch (e) { fail(res, e, 500); }
});

whatsappRouter.put('/settings', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const t = tenantOf(req, res); if (!t) return;
  try { res.json({ data: publicSettings(await saveSettings(t, req.body || {})) }); } catch (e) { fail(res, e); }
});

whatsappRouter.post('/pause', async (req: AuthRequest, res: Response) => {
  const t = tenantOf(req, res); if (!t) return;
  try {
    await getSettings(t);
    const paused = req.body?.paused !== false;
    await pool.query(`UPDATE wa_settings SET paused = $2, updated_at = now() WHERE tenant_id = $1`, [t, paused]);
    res.json({ data: { paused } });
  } catch (e) { fail(res, e, 500); }
});

whatsappRouter.post('/api-key', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const t = tenantOf(req, res); if (!t) return;
  try { res.json({ data: { api_key: await regenerateApiKey(t) } }); } catch (e) { fail(res, e, 500); }
});

// ── Sesión / QR ──
whatsappRouter.get('/session', async (req: AuthRequest, res: Response) => {
  const t = tenantOf(req, res); if (!t) return;
  try {
    const state = await refreshState(t);
    const s = await getSettings(t);
    res.json({ data: { state, number: s.connected_number, since: s.state_changed_at, instance: s.instance_name } });
  } catch (e) { fail(res, e, 500); }
});

whatsappRouter.post('/session/connect', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const t = tenantOf(req, res); if (!t) return;
  try { res.json({ data: await connectSession(t) }); } catch (e) { fail(res, e, 502); }
});

whatsappRouter.post('/session/logout', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const t = tenantOf(req, res); if (!t) return;
  try { await logoutSession(t); res.json({ data: { state: 'close' } }); } catch (e) { fail(res, e, 502); }
});

// ── Cola ──
const STATUSES = new Set(['pending', 'sending', 'sent', 'failed', 'cancelled', 'skipped']);

whatsappRouter.get('/queue', async (req: AuthRequest, res: Response) => {
  const t = tenantOf(req, res); if (!t) return;
  try {
    const status = STATUSES.has(String(req.query.status)) ? String(req.query.status) : null;
    const search = String(req.query.q || '').trim().slice(0, 60) || null;
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const { rows } = await pool.query(
      `SELECT id, phone, message, event_type, priority, status, attempts, last_error, source, client_ref,
              created_at, sent_at, not_before, count(*) OVER () AS total
         FROM wa_queue
        WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2)
          AND ($3::text IS NULL OR phone LIKE '%' || $3 || '%' OR client_ref = $3 OR message ILIKE '%' || $3 || '%')
        ORDER BY CASE WHEN status IN ('pending','sending') THEN 0 ELSE 1 END,
                 CASE WHEN status IN ('pending','sending') THEN priority END,
                 CASE WHEN status IN ('pending','sending') THEN created_at END,
                 COALESCE(sent_at, created_at) DESC
        LIMIT $4 OFFSET $5`,
      [t, status, search, limit, offset]
    );
    res.json({ data: { items: rows.map(({ total, ...r }) => r), total: Number(rows[0]?.total || 0), max_attempts: MAX_ATTEMPTS } });
  } catch (e) { fail(res, e, 500); }
});

whatsappRouter.post('/queue/:id/retry', async (req: AuthRequest, res: Response) => {
  const t = tenantOf(req, res); if (!t) return;
  const { rowCount } = await pool.query(
    `UPDATE wa_queue SET status = 'pending', attempts = 0, last_error = NULL, not_before = now(), updated_at = now()
      WHERE id = $1 AND tenant_id = $2 AND status IN ('failed','cancelled','skipped')`,
    [Number(req.params.id) || 0, t]
  ).catch(() => ({ rowCount: 0 }) as any);
  if (!rowCount) return res.status(404).json({ error: 'No se puede reintentar ese mensaje' });
  res.json({ data: { ok: true } });
});

whatsappRouter.post('/queue/:id/cancel', async (req: AuthRequest, res: Response) => {
  const t = tenantOf(req, res); if (!t) return;
  const { rowCount } = await pool.query(
    `UPDATE wa_queue SET status = 'cancelled', updated_at = now() WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`,
    [Number(req.params.id) || 0, t]
  ).catch(() => ({ rowCount: 0 }) as any);
  if (!rowCount) return res.status(404).json({ error: 'Ese mensaje ya no está pendiente' });
  res.json({ data: { ok: true } });
});

/** Cancela en bloque los pendientes (opcional: solo de un tipo de evento). */
whatsappRouter.post('/queue/cancel-pending', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const t = tenantOf(req, res); if (!t) return;
  const event = /^[a-z_]{2,40}$/.test(String(req.body?.event_type || '')) ? String(req.body.event_type) : null;
  try {
    const { rowCount } = await pool.query(
      `UPDATE wa_queue SET status = 'cancelled', updated_at = now()
        WHERE tenant_id = $1 AND status = 'pending' AND ($2::text IS NULL OR event_type = $2)`,
      [t, event]
    );
    res.json({ data: { cancelled: rowCount || 0 } });
  } catch (e) { fail(res, e, 500); }
});

/** Mensaje de prueba: entra con prioridad máxima y sin exigir que el número haya escrito. */
whatsappRouter.post('/test', async (req: AuthRequest, res: Response) => {
  const t = tenantOf(req, res); if (!t) return;
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: 'Teléfono inválido' });
    const r = await enqueue(t, {
      phone, event: 'test', source: 'panel',
      message: String(req.body?.message || '').trim() || '✅ Mensaje de prueba de Omnisync. Si lo recibes, WhatsApp está funcionando.',
    });
    res.json({ data: r });
  } catch (e) { fail(res, e); }
});

// ── Estadísticas, panel y recomendaciones ──
whatsappRouter.get('/stats', async (req: AuthRequest, res: Response) => {
  const t = tenantOf(req, res); if (!t) return;
  try { res.json({ data: await getStats(t, Number(req.query.days) || 30) }); } catch (e) { fail(res, e, 500); }
});

// ───────────────────────── Públicas ─────────────────────────

/** Plugin UISP: encola un aviso. Clave del ISP en X-Api-Key (o Bearer). */
whatsappPublicRouter.post('/enqueue', async (req: Request, res: Response) => {
  const key = String(req.headers['x-api-key'] || '').trim()
    || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  try {
    const tenantId = await tenantByApiKey(key);
    if (!tenantId) return res.status(401).json({ error: 'Clave de API inválida o módulo WhatsApp apagado' });
    const b = req.body || {};
    const r = await enqueue(tenantId, {
      phone: b.phone, message: b.message, event: b.event,
      client_ref: b.client_id ?? b.client_ref, dedupe_key: b.dedupe_key, source: String(b.source || 'uisp').slice(0, 30),
    });
    res.status(r.duplicate ? 200 : 201).json({ data: r });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/** Eventos de Evolution (solo red interna; protegido por el secreto de cada ISP). */
whatsappPublicRouter.post('/evolution/:instance', async (req: Request, res: Response) => {
  try {
    const ok = await handleEvolutionEvent(String(req.params.instance), String(req.query.s || ''), req.body);
    res.status(ok ? 200 : 401).json({ ok });
  } catch (e: any) {
    console.error('[WA] evento Evolution:', e.message);
    res.status(200).json({ ok: false }); // no hacer que Evolution reintente en bucle
  }
});
