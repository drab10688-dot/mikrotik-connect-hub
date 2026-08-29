import { Router, Response } from 'express';
import { AuthRequest, requireRole } from '../middleware/auth';
import { pool } from '../lib/db';

/**
 * Acceso web directo a las ONUs (sin TR-069).
 *
 * El VPS entra por la VPN a la IP WAN/gestión de la ONU, hace login en su
 * interfaz web y envía SOLO los formularios de WiFi y PPPoE.
 *
 * Como cada modelo/firmware tiene su propia web, el panel "aprende":
 *   1. /probe   → detecta modelo, tipo de login y los formularios disponibles.
 *   2. /profiles→ guarda ese aprendizaje como perfil reutilizable.
 *   3. /apply   → aplica la configuración usando el perfil del modelo.
 * El perfil aprendido se reutiliza automáticamente en todas las demás ONUs
 * del mismo modelo.
 */
export const onuWebRouter = Router();

const TIMEOUT = 12000;

// ─── Helpers ────────────────────────────────────────────────
async function currentTenantId(req: AuthRequest): Promise<string | null> {
  if (req.tenantId) return req.tenantId;
  const { rows } = await pool.query(`SELECT id FROM tenants ORDER BY created_at LIMIT 1`);
  return rows[0]?.id || null;
}

function baseUrl(ip: string, port?: number | null, protocol?: string | null) {
  const proto = protocol === 'https' ? 'https' : 'http';
  const p = port && Number(port) > 0 ? Number(port) : proto === 'https' ? 443 : 80;
  const isDefault = (proto === 'http' && p === 80) || (proto === 'https' && p === 443);
  return `${proto}://${ip}${isDefault ? '' : `:${p}`}`;
}

interface HttpResult {
  ok: boolean;
  status: number;
  body: string;
  headers: Record<string, string>;
}

/** fetch con cookies, timeout y sin lanzar por status. */
async function httpRequest(
  url: string,
  opts: { method?: string; body?: string; cookies?: string[]; auth?: string; referer?: string } = {}
): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (OmniSync ONU Manager)',
    Accept: 'text/html,application/xhtml+xml,*/*',
  };
  if (opts.body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (opts.cookies?.length) headers['Cookie'] = opts.cookies.join('; ');
  if (opts.auth) headers['Authorization'] = `Basic ${Buffer.from(opts.auth).toString('base64')}`;
  if (opts.referer) headers['Referer'] = opts.referer;

  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body,
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    const out: Record<string, string> = {};
    res.headers.forEach((v, k) => { out[k] = v; });
    const setCookie = (res.headers as any).getSetCookie?.() as string[] | undefined;
    if (setCookie?.length) out['set-cookie'] = setCookie.join(' , ');
    return { ok: res.ok, status: res.status, body: text, headers: out };
  } finally {
    clearTimeout(timer);
  }
}

function cookiesFromHeaders(headers: Record<string, string>): string[] {
  const raw = headers['set-cookie'];
  if (!raw) return [];
  return raw
    .split(' , ')
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean);
}

/** Extrae los formularios de un HTML (action, method, inputs). */
function parseForms(html: string) {
  const forms: Array<{ action: string; method: string; inputs: Array<{ name: string; type: string; value: string }> }> = [];
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let m: RegExpExecArray | null;
  while ((m = formRe.exec(html))) {
    const attrs = m[1] || '';
    const inner = m[2] || '';
    const action = /action\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] || '';
    const method = (/method\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] || 'post').toLowerCase();
    const inputs: Array<{ name: string; type: string; value: string }> = [];
    const inputRe = /<(input|select|textarea)\b([^>]*)>/gi;
    let i: RegExpExecArray | null;
    while ((i = inputRe.exec(inner))) {
      const a = i[2] || '';
      const name = /name\s*=\s*["']([^"']*)["']/i.exec(a)?.[1];
      if (!name) continue;
      inputs.push({
        name,
        type: (/type\s*=\s*["']([^"']*)["']/i.exec(a)?.[1] || i[1].toLowerCase()).toLowerCase(),
        value: /value\s*=\s*["']([^"']*)["']/i.exec(a)?.[1] || '',
      });
    }
    forms.push({ action, method, inputs });
  }
  return forms;
}

const NAME_HINTS = {
  user: [/^user(name)?$/i, /login/i, /admin_?user/i, /account/i],
  pass: [/^pass(word|wd)?$/i, /admin_?pass/i, /pwd/i],
  ssid: [/ssid/i, /wl.*name/i, /wifi.*name/i],
  wifi_pass: [/(wpa|wl|wifi|wlan).*(key|pass|psk)/i, /pre.?shared/i, /passphrase/i],
  pppoe_user: [/(ppp|pppoe|wan).*(user|account)/i, /^usrname$/i],
  pppoe_pass: [/(ppp|pppoe|wan).*(pass|pwd)/i],
};

function matchField(inputs: Array<{ name: string }>, hints: RegExp[]) {
  for (const h of hints) {
    const found = inputs.find((i) => h.test(i.name));
    if (found) return found.name;
  }
  return null;
}

function detectModel(html: string, headers: Record<string, string>) {
  const title = /<title[^>]*>([\s\S]{0,120}?)<\/title>/i.exec(html)?.[1]?.trim() || '';
  const realm = /realm="([^"]+)"/i.exec(headers['www-authenticate'] || '')?.[1] || '';
  const server = headers['server'] || '';
  const text = `${title} ${realm} ${server}`;
  let brand = 'desconocida';
  if (/zyxel|pmg|vmg/i.test(text)) brand = 'zyxel';
  else if (/huawei|echolife|hg8/i.test(text)) brand = 'huawei';
  else if (/zte|f6|f6\d{2}/i.test(text)) brand = 'zte';
  else if (/v-?sol|vsol/i.test(text)) brand = 'vsol';
  else if (/c-?data|cdata/i.test(text)) brand = 'cdata';
  else if (/tp-?link/i.test(text)) brand = 'tplink';
  else if (/nokia|alcatel/i.test(text)) brand = 'nokia';
  const model = /(?:model|modelo)[^a-z0-9]{0,3}([A-Z0-9][A-Z0-9\-_]{3,20})/i.exec(html)?.[1] || title || '';
  return { brand, model: model.slice(0, 60), title, realm, server };
}

function absolute(base: string, path: string) {
  if (!path) return base;
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Credenciales aplicables a una IP: excepción por IP > global del ISP. */
async function credentialsFor(tenantId: string | null, ip: string) {
  const { rows } = await pool.query(
    `SELECT * FROM onu_web_credentials
      WHERE ($1::uuid IS NULL OR tenant_id = $1::uuid)
        AND (ip = $2 OR ip IS NULL)
      ORDER BY (ip IS NULL) ASC LIMIT 1`,
    [tenantId, ip]
  );
  return rows[0] || null;
}

async function logEvent(tenantId: string | null, ip: string, type: string, detail: string, userId?: string) {
  await pool
    .query(
      `INSERT INTO onu_web_events (tenant_id, ip, event_type, detail, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, ip, type, detail?.slice(0, 500) || null, userId || null]
    )
    .catch(() => undefined);
}

/** Login según el perfil. Devuelve cookies y/o cabecera básica. */
async function login(base: string, profile: any, user: string, pass: string) {
  if (!profile || profile.login_type === 'basic' || !profile.login_path) {
    return { cookies: [] as string[], auth: `${user}:${pass}`, detail: 'basic' };
  }
  const url = absolute(base, profile.login_path);
  const fields: Record<string, string> = { ...(profile.login_extra || {}) };
  fields[profile.user_field || 'username'] = user;
  fields[profile.pass_field || 'password'] = pass;
  const body = new URLSearchParams(fields).toString();
  const res = await httpRequest(url, {
    method: (profile.login_method || 'post').toUpperCase(),
    body,
    referer: base,
  });
  const cookies = cookiesFromHeaders(res.headers);
  const failed = /login|contrase|password.*incorrect|invalid/i.test(res.body) && !cookies.length;
  return { cookies, auth: failed ? `${user}:${pass}` : undefined, detail: `status ${res.status}` };
}

function fillTemplate(map: Record<string, string> | null, values: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [field, token] of Object.entries(map || {})) {
    const key = String(token).replace(/[{}]/g, '').trim();
    out[field] = key in values ? values[key] : String(token);
  }
  return out;
}

// ─── Credenciales ───────────────────────────────────────────
onuWebRouter.get('/credentials', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await currentTenantId(req);
    const { rows } = await pool.query(
      `SELECT id, ip, name, username, port, protocol, profile_id, model, updated_at
         FROM onu_web_credentials
        WHERE ($1::uuid IS NULL OR tenant_id = $1::uuid)
        ORDER BY (ip IS NULL) DESC, ip`,
      [tenantId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

onuWebRouter.put('/credentials', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await currentTenantId(req);
    const b = req.body || {};
    const ip = b.ip && String(b.ip).trim() ? String(b.ip).trim() : null; // null = credencial global
    const { rows } = await pool.query(
      `INSERT INTO onu_web_credentials (tenant_id, ip, name, username, password, port, protocol, profile_id, model)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, ip) DO UPDATE SET
         name = EXCLUDED.name,
         username = EXCLUDED.username,
         password = COALESCE(NULLIF(EXCLUDED.password, ''), onu_web_credentials.password),
         port = EXCLUDED.port,
         protocol = EXCLUDED.protocol,
         profile_id = COALESCE(EXCLUDED.profile_id, onu_web_credentials.profile_id),
         model = COALESCE(EXCLUDED.model, onu_web_credentials.model),
         updated_at = now()
       RETURNING id, ip, name, username, port, protocol, profile_id, model`,
      [
        tenantId, ip, b.name || null, b.username || 'admin', b.password || '',
        Number(b.port) > 0 ? Math.floor(Number(b.port)) : null,
        b.protocol === 'https' ? 'https' : 'http',
        b.profile_id || null, b.model || null,
      ]
    );
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

onuWebRouter.delete('/credentials/:id', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await currentTenantId(req);
    await pool.query(
      `DELETE FROM onu_web_credentials WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2::uuid)`,
      [req.params.id, tenantId]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Perfiles aprendidos ────────────────────────────────────
onuWebRouter.get('/profiles', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await currentTenantId(req);
    const { rows } = await pool.query(
      `SELECT * FROM onu_web_profiles
        WHERE tenant_id IS NULL OR tenant_id = $1::uuid
        ORDER BY verified DESC, times_used DESC, name`,
      [tenantId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

onuWebRouter.post('/profiles', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await currentTenantId(req);
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'El perfil necesita un nombre' });
    const { rows } = await pool.query(
      `INSERT INTO onu_web_profiles
         (tenant_id, name, brand, model_match, login_type, login_path, login_method,
          user_field, pass_field, login_extra, wifi_path, wifi_method, wifi_fields,
          pppoe_path, pppoe_method, pppoe_fields, success_hint, learned_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        tenantId, b.name, b.brand || 'desconocida', b.model_match || null,
        b.login_type || 'form', b.login_path || null, b.login_method || 'post',
        b.user_field || 'username', b.pass_field || 'password',
        b.login_extra ? JSON.stringify(b.login_extra) : null,
        b.wifi_path || null, b.wifi_method || 'post',
        b.wifi_fields ? JSON.stringify(b.wifi_fields) : null,
        b.pppoe_path || null, b.pppoe_method || 'post',
        b.pppoe_fields ? JSON.stringify(b.pppoe_fields) : null,
        b.success_hint || null, b.learned_from || null,
      ]
    );
    res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

onuWebRouter.put('/profiles/:id', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await currentTenantId(req);
    const b = req.body || {};
    const { rows } = await pool.query(
      `UPDATE onu_web_profiles SET
         name = COALESCE($3, name),
         brand = COALESCE($4, brand),
         model_match = COALESCE($5, model_match),
         login_type = COALESCE($6, login_type),
         login_path = COALESCE($7, login_path),
         login_method = COALESCE($8, login_method),
         user_field = COALESCE($9, user_field),
         pass_field = COALESCE($10, pass_field),
         login_extra = COALESCE($11::jsonb, login_extra),
         wifi_path = COALESCE($12, wifi_path),
         wifi_method = COALESCE($13, wifi_method),
         wifi_fields = COALESCE($14::jsonb, wifi_fields),
         pppoe_path = COALESCE($15, pppoe_path),
         pppoe_method = COALESCE($16, pppoe_method),
         pppoe_fields = COALESCE($17::jsonb, pppoe_fields),
         success_hint = COALESCE($18, success_hint),
         updated_at = now()
       WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2::uuid)
       RETURNING *`,
      [
        req.params.id, tenantId, b.name || null, b.brand || null, b.model_match || null,
        b.login_type || null, b.login_path || null, b.login_method || null,
        b.user_field || null, b.pass_field || null,
        b.login_extra ? JSON.stringify(b.login_extra) : null,
        b.wifi_path || null, b.wifi_method || null,
        b.wifi_fields ? JSON.stringify(b.wifi_fields) : null,
        b.pppoe_path || null, b.pppoe_method || null,
        b.pppoe_fields ? JSON.stringify(b.pppoe_fields) : null,
        b.success_hint || null,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Perfil no encontrado' });
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

onuWebRouter.delete('/profiles/:id', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await currentTenantId(req);
    await pool.query(
      `DELETE FROM onu_web_profiles WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2::uuid)`,
      [req.params.id, tenantId]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Probe / aprendizaje ────────────────────────────────────
onuWebRouter.post('/probe', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await currentTenantId(req);
    const ip = String(req.body?.ip || '').trim();
    if (!ip) return res.status(400).json({ error: 'Indica la IP de la ONU' });

    const saved = await credentialsFor(tenantId, ip);
    const username = req.body?.username || saved?.username || 'admin';
    const password = req.body?.password || saved?.password || 'admin';
    const port = req.body?.port || saved?.port;
    const protocol = req.body?.protocol || saved?.protocol;
    const base = baseUrl(ip, port, protocol);

    const root = await httpRequest(base).catch((e) => ({ ok: false, status: 0, body: String(e.message), headers: {} } as HttpResult));
    if (!root.status) {
      await logEvent(tenantId, ip, 'probe_error', root.body, req.userId);
      return res.status(502).json({ error: `No se pudo alcanzar ${base}. ¿La VPN está arriba y el puerto web abierto?` });
    }

    const info = detectModel(root.body, root.headers);
    const needsBasic = root.status === 401;
    let html = root.body;
    let cookies: string[] = [];

    if (needsBasic) {
      const authed = await httpRequest(base, { auth: `${username}:${password}` });
      html = authed.body;
      cookies = cookiesFromHeaders(authed.headers);
    }

    const forms = parseForms(html);
    const loginForm = forms.find((f) => matchField(f.inputs, NAME_HINTS.pass) && matchField(f.inputs, NAME_HINTS.user));

    // Si hay login por formulario, entramos y volvemos a leer para ver los menús internos
    let insideForms = forms;
    if (!needsBasic && loginForm) {
      const body = new URLSearchParams({
        [matchField(loginForm.inputs, NAME_HINTS.user) || 'username']: username,
        [matchField(loginForm.inputs, NAME_HINTS.pass) || 'password']: password,
        ...Object.fromEntries(
          loginForm.inputs.filter((i) => i.type === 'hidden' && i.value).map((i) => [i.name, i.value])
        ),
      }).toString();
      const logged = await httpRequest(absolute(base, loginForm.action || '/'), {
        method: loginForm.method === 'get' ? 'GET' : 'POST',
        body: loginForm.method === 'get' ? undefined : body,
        referer: base,
      }).catch(() => null);
      if (logged) {
        cookies = cookiesFromHeaders(logged.headers);
        insideForms = [...forms, ...parseForms(logged.body)];
      }
    }

    const allInputs = insideForms.flatMap((f) => f.inputs);
    const suggestion = {
      brand: info.brand,
      model_match: info.model || info.title,
      login_type: needsBasic ? 'basic' : loginForm ? 'form' : 'basic',
      login_path: loginForm?.action || null,
      login_method: loginForm?.method || 'post',
      user_field: loginForm ? matchField(loginForm.inputs, NAME_HINTS.user) : null,
      pass_field: loginForm ? matchField(loginForm.inputs, NAME_HINTS.pass) : null,
      wifi_fields: {
        ...(matchField(allInputs, NAME_HINTS.ssid) ? { [matchField(allInputs, NAME_HINTS.ssid)!]: '{ssid}' } : {}),
        ...(matchField(allInputs, NAME_HINTS.wifi_pass) ? { [matchField(allInputs, NAME_HINTS.wifi_pass)!]: '{wifi_password}' } : {}),
      },
      pppoe_fields: {
        ...(matchField(allInputs, NAME_HINTS.pppoe_user) ? { [matchField(allInputs, NAME_HINTS.pppoe_user)!]: '{pppoe_username}' } : {}),
        ...(matchField(allInputs, NAME_HINTS.pppoe_pass) ? { [matchField(allInputs, NAME_HINTS.pppoe_pass)!]: '{pppoe_password}' } : {}),
      },
    };

    // Perfil ya aprendido para este modelo
    const { rows: known } = await pool.query(
      `SELECT * FROM onu_web_profiles
        WHERE (tenant_id IS NULL OR tenant_id = $1::uuid)
          AND ($2 = '' OR brand = $3 OR $2 ILIKE '%' || COALESCE(model_match, '@@') || '%')
        ORDER BY verified DESC, times_used DESC LIMIT 1`,
      [tenantId, suggestion.model_match || '', info.brand]
    );

    await logEvent(tenantId, ip, 'probe', `${info.brand} ${info.title}`, req.userId);

    res.json({
      data: {
        reachable: true,
        base_url: base,
        status: root.status,
        detected: info,
        auth_required: needsBasic || !!loginForm,
        forms: insideForms.map((f) => ({
          action: f.action,
          method: f.method,
          inputs: f.inputs.map((i) => ({ name: i.name, type: i.type })),
        })),
        suggestion,
        matched_profile: known[0] || null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Navegador embebido (para calibrar manualmente) ─────────
onuWebRouter.get('/browse', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await currentTenantId(req);
    const ip = String(req.query.ip || '').trim();
    if (!ip) return res.status(400).json({ error: 'IP requerida' });
    const saved = await credentialsFor(tenantId, ip);
    const base = baseUrl(ip, saved?.port, saved?.protocol);
    const path = String(req.query.path || '/');
    const result = await httpRequest(absolute(base, path), {
      auth: saved ? `${saved.username}:${saved.password}` : undefined,
    });
    const html = result.body.replace(/<head([^>]*)>/i, `<head$1><base href="${base}/">`);
    res.json({
      data: {
        status: result.status,
        content_type: result.headers['content-type'] || 'text/html',
        html: html.slice(0, 400000),
        forms: parseForms(result.body),
      },
    });
  } catch (error: any) {
    res.status(502).json({ error: error.message });
  }
});

// ─── Aplicar configuración (WiFi / PPPoE) ───────────────────
onuWebRouter.post('/apply', requireRole('super_admin', 'admin', 'secretary'), async (req: AuthRequest, res: Response) => {
  const tenantId = await currentTenantId(req);
  const b = req.body || {};
  const ip = String(b.ip || '').trim();
  if (!ip) return res.status(400).json({ error: 'Indica la IP de la ONU' });

  try {
    const saved = await credentialsFor(tenantId, ip);
    const username = b.username || saved?.username || 'admin';
    const password = b.password || saved?.password || 'admin';
    const base = baseUrl(ip, b.port || saved?.port, b.protocol || saved?.protocol);

    const profileId = b.profile_id || saved?.profile_id;
    if (!profileId) return res.status(400).json({ error: 'Esta ONU no tiene perfil asignado. Ejecuta primero "Detectar modelo".' });
    const { rows: pr } = await pool.query(
      `SELECT * FROM onu_web_profiles WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2::uuid)`,
      [profileId, tenantId]
    );
    const profile = pr[0];
    if (!profile) return res.status(404).json({ error: 'Perfil no encontrado' });

    const session = await login(base, profile, username, password);
    const results: Array<{ step: string; ok: boolean; status: number; detail?: string }> = [];

    const send = async (step: string, path: string | null, method: string, fields: Record<string, string>) => {
      if (!path || !Object.keys(fields).length) return;
      const url = absolute(base, path);
      const body = new URLSearchParams(fields).toString();
      const r = await httpRequest(url, {
        method: (method || 'post').toUpperCase(),
        body: (method || 'post').toLowerCase() === 'get' ? undefined : body,
        cookies: session.cookies,
        auth: session.auth,
        referer: base,
      });
      const hint = profile.success_hint;
      const ok = r.status < 400 && (!hint || new RegExp(hint, 'i').test(r.body));
      results.push({ step, ok, status: r.status, detail: ok ? undefined : r.body.slice(0, 200) });
    };

    if (b.wifi?.ssid || b.wifi?.password) {
      await send('wifi', profile.wifi_path, profile.wifi_method, fillTemplate(profile.wifi_fields, {
        ssid: b.wifi.ssid || '',
        wifi_password: b.wifi.password || '',
      }));
    }
    if (b.pppoe?.username || b.pppoe?.password) {
      await send('pppoe', profile.pppoe_path, profile.pppoe_method, fillTemplate(profile.pppoe_fields, {
        pppoe_username: b.pppoe.username || '',
        pppoe_password: b.pppoe.password || '',
      }));
    }

    if (!results.length) return res.status(400).json({ error: 'Nada que aplicar: el perfil no tiene rutas de WiFi ni PPPoE.' });

    const allOk = results.every((r) => r.ok);
    if (allOk) {
      // El perfil funcionó: se marca verificado y queda listo para las demás ONUs
      await pool.query(
        `UPDATE onu_web_profiles SET verified = true, times_used = times_used + 1, updated_at = now() WHERE id = $1`,
        [profile.id]
      );
      await pool.query(
        `UPDATE onu_web_credentials SET profile_id = $1, updated_at = now()
          WHERE ip = $2 AND ($3::uuid IS NULL OR tenant_id = $3::uuid)`,
        [profile.id, ip, tenantId]
      );
    }
    await logEvent(tenantId, ip, allOk ? 'apply_ok' : 'apply_error', JSON.stringify(results), req.userId);
    res.json({ data: { success: allOk, results } });
  } catch (error: any) {
    await logEvent(tenantId, ip, 'apply_error', error.message, req.userId);
    res.status(500).json({ error: error.message });
  }
});

// ─── Historial ──────────────────────────────────────────────
onuWebRouter.get('/events', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await currentTenantId(req);
    const { rows } = await pool.query(
      `SELECT e.ip, e.event_type, e.detail, e.created_at, u.email AS user_email
         FROM onu_web_events e
         LEFT JOIN users u ON u.id = e.created_by
        WHERE ($1::uuid IS NULL OR e.tenant_id = $1::uuid)
        ORDER BY e.created_at DESC LIMIT 100`,
      [tenantId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
