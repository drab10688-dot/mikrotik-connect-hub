import { Router, Response } from 'express';
import { pool } from '../lib/db';
import { AuthRequest, requireRole, getAccessibleDeviceIds, verifyDeviceAccess } from '../middleware/auth';
import { sendTelegram, STREAK_ALERT } from '../lib/net-monitor';

/**
 * Monitor de red: estado e historial de ping de cada MikroTik (cada ISP ve
 * solo los suyos) y alertas por Telegram del ISP. El super admin sin ISP
 * configura su propio bot, que recibe las alertas de todos los ISP.
 */
export const monitorRouter = Router();

/** Routers visibles para el usuario (su ISP / sus routers asignados). */
async function visibleDevices(req: AuthRequest) {
  const ids = await getAccessibleDeviceIds(req);
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.host, t.name AS tenant_name
       FROM mikrotik_devices d LEFT JOIN tenants t ON t.id = d.tenant_id
      WHERE ($1::uuid[] IS NULL OR d.id = ANY($1::uuid[]))
        AND ($2::uuid IS NULL OR d.tenant_id = $2::uuid)
      ORDER BY d.name`,
    [ids, req.tenantId || null]
  );
  return rows;
}

/** Estado actual de cada router + promedios de la última hora. */
monitorRouter.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const devices = await visibleDevices(req);
    const ids = devices.map((d: any) => d.id);
    if (!ids.length) return res.json({ data: { routers: [], streak_alert: STREAK_ALERT } });
    const [state, last, hour] = await Promise.all([
      pool.query(`SELECT * FROM net_monitor_state WHERE mikrotik_id = ANY($1::uuid[])`, [ids]),
      pool.query(
        `SELECT DISTINCT ON (mikrotik_id) * FROM net_monitor_samples
          WHERE mikrotik_id = ANY($1::uuid[]) AND at > now() - interval '10 minutes'
          ORDER BY mikrotik_id, at DESC`,
        [ids]
      ),
      pool.query(
        `SELECT mikrotik_id, avg(vpn_rtt) AS vpn_avg, avg(inet_rtt) AS inet_avg, max(inet_rtt) AS inet_max,
                avg(COALESCE(inet_loss, vpn_loss)) AS loss_avg,
                100.0 * count(*) FILTER (WHERE status = 'down') / NULLIF(count(*), 0) AS down_pct
           FROM net_monitor_samples
          WHERE mikrotik_id = ANY($1::uuid[]) AND at > now() - interval '1 hour'
          GROUP BY mikrotik_id`,
        [ids]
      ),
    ]);
    const by = (rows: any[]) => new Map<string, any>(rows.map((r) => [r.mikrotik_id, r]));
    const st = by(state.rows), ls = by(last.rows), hr = by(hour.rows);
    const n = (v: any) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
    res.json({
      data: {
        streak_alert: STREAK_ALERT,
        routers: devices.map((d: any) => {
          const s = st.get(d.id), l = ls.get(d.id), h = hr.get(d.id);
          return {
            id: d.id,
            name: d.name,
            host: d.host,
            tenant_name: d.tenant_name,
            status: l ? l.status : null,
            since: s?.since || null,
            alerted: s?.alerted_status || null,
            last_at: l?.at || null,
            vpn_rtt: n(l?.vpn_rtt), vpn_loss: l?.vpn_loss ?? null,
            inet_rtt: n(l?.inet_rtt), inet_loss: l?.inet_loss ?? null,
            hour: h ? { vpn_avg: n(h.vpn_avg), inet_avg: n(h.inet_avg), inet_max: n(h.inet_max), loss_avg: n(h.loss_avg), down_pct: n(h.down_pct) } : null,
          };
        }),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** Historial de un router, agrupado para que la gráfica tenga ≤ ~300 puntos. */
monitorRouter.get('/:mikrotikId/history', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.mikrotikId;
    if (!(await verifyDeviceAccess(req.userId!, req.userRole!, id))) return res.status(403).json({ error: 'Sin acceso al router' });
    const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
    const bucketSec = Math.max(60, Math.round((hours * 3600) / 300));
    const { rows } = await pool.query(
      `SELECT date_bin(make_interval(secs => $3), at, TIMESTAMPTZ '2000-01-01') AS t,
              avg(vpn_rtt) AS vpn_rtt, avg(inet_rtt) AS inet_rtt,
              max(COALESCE(inet_loss, vpn_loss)) AS loss,
              bool_or(status = 'down') AS down, bool_or(status = 'no_internet') AS no_internet
         FROM net_monitor_samples
        WHERE mikrotik_id = $1 AND at > now() - make_interval(hours => $2)
        GROUP BY 1 ORDER BY 1`,
      [id, hours, bucketSec]
    );
    const r1 = (v: any) => (v === null ? null : Math.round(Number(v) * 10) / 10);
    res.json({
      data: rows.map((r: any) => ({ t: r.t, vpn_rtt: r1(r.vpn_rtt), inet_rtt: r1(r.inet_rtt), loss: r.loss, down: r.down, no_internet: r.no_internet })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Ajustes de alertas (admin del ISP; super admin sin ISP = global) ───
const scopeOf = (req: AuthRequest) => req.tenantId || null;
const mask = (t?: string | null) => (t ? `…${t.slice(-4)}` : null);
const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/;
const CHAT_RE = /^(-?\d{1,20}|@[A-Za-z0-9_]{5,64})$/;

async function loadSettings(tenantId: string | null) {
  const { rows } = await pool.query(`SELECT * FROM monitor_settings WHERE tenant_id IS NOT DISTINCT FROM $1 LIMIT 1`, [tenantId]);
  return rows[0] || null;
}

monitorRouter.get('/settings', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const s = await loadSettings(scopeOf(req));
    res.json({
      data: {
        scope: scopeOf(req) ? 'isp' : 'global',
        enabled: Boolean(s?.enabled),
        has_token: Boolean(s?.telegram_token),
        token_hint: mask(s?.telegram_token),
        telegram_chat: s?.telegram_chat || '',
        rtt_ms: s?.rtt_ms ?? 150,
        loss_pct: s?.loss_pct ?? 20,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

monitorRouter.put('/settings', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = scopeOf(req);
    const b = req.body || {};
    const current = await loadSettings(tenantId);
    // El token solo se reemplaza si se escribe uno nuevo (nunca se devuelve)
    const token = typeof b.telegram_token === 'string' && b.telegram_token.trim() ? b.telegram_token.trim() : current?.telegram_token || null;
    const chat = String(b.telegram_chat ?? current?.telegram_chat ?? '').trim() || null;
    if (token && !TOKEN_RE.test(token)) return res.status(400).json({ error: 'El token del bot no tiene el formato de Telegram (123456:ABC…)' });
    if (chat && !CHAT_RE.test(chat)) return res.status(400).json({ error: 'El chat debe ser un número (ej. -1001234567890) o @canal' });
    const rtt = Math.min(5000, Math.max(20, Number(b.rtt_ms) || 150));
    const loss = Math.min(100, Math.max(1, Number(b.loss_pct) || 20));
    const enabled = Boolean(b.enabled) && Boolean(token && chat);
    if (current) {
      await pool.query(
        `UPDATE monitor_settings SET enabled = $2, telegram_token = $3, telegram_chat = $4, rtt_ms = $5, loss_pct = $6, updated_at = now() WHERE id = $1`,
        [current.id, enabled, token, chat, rtt, loss]
      );
    } else {
      await pool.query(
        `INSERT INTO monitor_settings (tenant_id, enabled, telegram_token, telegram_chat, rtt_ms, loss_pct) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, enabled, token, chat, rtt, loss]
      );
    }
    res.json({ data: { saved: true, enabled } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** Envía un mensaje de prueba con lo guardado. */
monitorRouter.post('/settings/test', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const s = await loadSettings(scopeOf(req));
    if (!s?.telegram_token || !s?.telegram_chat) return res.status(400).json({ error: 'Guarda primero el token del bot y el chat' });
    await sendTelegram(s.telegram_token, s.telegram_chat, '✅ Omnisync: las alertas del monitor de red llegarán a este chat.');
    res.json({ data: { sent: true } });
  } catch (error: any) {
    res.status(400).json({ error: `Telegram: ${error.message}` });
  }
});

/**
 * Ayuda a encontrar el chat: lee los últimos mensajes que recibió el bot
 * (el usuario le escribe primero, o lo agrega al grupo) y lista los chats.
 */
monitorRouter.post('/settings/detect-chat', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const typed = typeof req.body?.telegram_token === 'string' ? req.body.telegram_token.trim() : '';
    const token = typed || (await loadSettings(scopeOf(req)))?.telegram_token;
    if (!token || !TOKEN_RE.test(token)) return res.status(400).json({ error: 'Escribe el token del bot' });
    const r = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates?limit=50`, { signal: AbortSignal.timeout(10_000) });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok || data?.ok === false) return res.status(400).json({ error: `Telegram: ${data?.description || r.status}` });
    const chats = new Map<string, string>();
    for (const u of data.result || []) {
      const c = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
      if (c?.id) chats.set(String(c.id), c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id));
    }
    res.json({ data: [...chats.entries()].map(([id, name]) => ({ id, name })) });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});
