import { Router, Response, Request } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { pool } from '../lib/db';

export const telegramBotRouter = Router();

const GENIEACS_NBI = process.env.GENIEACS_NBI_URL || 'http://genieacs:7557';

// ─── Schema bootstrap (idempotente, para instalaciones existentes) ───
let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_technicians (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
      chat_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(mikrotik_id, chat_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_bot_sessions (
      chat_id TEXT PRIMARY KEY,
      mikrotik_id UUID,
      step TEXT,
      data JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS telegram_provisions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      mikrotik_id UUID,
      technician_chat_id TEXT,
      technician_name TEXT,
      client_name TEXT,
      pppoe_username TEXT,
      pppoe_password TEXT,
      profile TEXT,
      wifi_ssid TEXT,
      wifi_password TEXT,
      onu_serial TEXT,
      onu_device_id TEXT,
      status TEXT,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  schemaReady = true;
}

// ─── Helpers ─────────────────────────────────────────────
async function tg(botToken: string, method: string, body: any) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

async function say(botToken: string, chatId: number | string, text: string, extra: any = {}) {
  return tg(botToken, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

async function genieFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${GENIEACS_NBI}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`GenieACS (${res.status}): ${await res.text()}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

async function getSession(chatId: string) {
  const { rows } = await pool.query('SELECT * FROM telegram_bot_sessions WHERE chat_id = $1', [chatId]);
  return rows[0] || null;
}

async function setSession(chatId: string, mikrotikId: string | null, step: string | null, data: any) {
  await pool.query(
    `INSERT INTO telegram_bot_sessions (chat_id, mikrotik_id, step, data, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (chat_id) DO UPDATE SET mikrotik_id = $2, step = $3, data = $4, updated_at = now()`,
    [chatId, mikrotikId, step, JSON.stringify(data || {})]
  );
}

async function clearSession(chatId: string) {
  await pool.query('DELETE FROM telegram_bot_sessions WHERE chat_id = $1', [chatId]);
}

function randomPassword(len = 10) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Localiza la ONU en GenieACS por número de serie
async function findOnuBySerial(serial: string): Promise<string | null> {
  const clean = serial.trim();
  const queries = [
    { _deviceId: { _SerialNumber: clean } },
    { _deviceId: { _SerialNumber: clean.toUpperCase() } },
    { _id: { $regex: clean } },
  ];
  for (const q of queries) {
    try {
      const devices: any = await genieFetch(
        `/devices/?query=${encodeURIComponent(JSON.stringify(q))}&projection=_id&limit=1`
      );
      if (Array.isArray(devices) && devices[0]?._id) return devices[0]._id;
    } catch {
      /* siguiente intento */
    }
  }
  return null;
}

async function pushOnuTask(deviceId: string, parameterValues: [string, string, string][]) {
  return genieFetch(`/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`, {
    method: 'POST',
    body: JSON.stringify({ name: 'setParameterValues', parameterValues }),
  });
}

// ─── Provisionamiento completo ───────────────────────────
async function provision(mikrotikId: string, tech: any, d: any) {
  const result: any = { pppoe: false, onu: false, onuDeviceId: null, warnings: [] as string[] };

  // 1. Crear secret PPPoE en la MikroTik
  const config = await getDeviceConfig(pool, mikrotikId);
  await mikrotikRequest(config, '/rest/ppp/secret/add', 'POST', {
    name: d.username,
    password: d.password,
    service: 'pppoe',
    profile: d.profile || 'default',
    comment: `${d.clientName} · alta por bot (${tech.full_name})`,
  });
  result.pppoe = true;

  // 2. Configurar la ONU vía TR-069 (GenieACS)
  if (d.serial && d.serial !== '-') {
    const deviceId = await findOnuBySerial(d.serial);
    if (!deviceId) {
      result.warnings.push(`No se encontró la ONU con serial <code>${d.serial}</code> en el ACS. Verifica que esté encendida y con TR-069 activo.`);
    } else {
      result.onuDeviceId = deviceId;
      const wanBase = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
      const wlan24 = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1';
      const wlan5 = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2';
      const params: [string, string, string][] = [
        [`${wanBase}.Username`, d.username, 'xsd:string'],
        [`${wanBase}.Password`, d.password, 'xsd:string'],
        [`${wlan24}.SSID`, d.ssid, 'xsd:string'],
        [`${wlan24}.PreSharedKey.1.PreSharedKey`, d.wifiPassword, 'xsd:string'],
        [`${wlan24}.KeyPassphrase`, d.wifiPassword, 'xsd:string'],
      ];
      try {
        await pushOnuTask(deviceId, params);
        // 5 GHz en tarea aparte: muchas ONU no la exponen y fallaría todo el lote
        try {
          await pushOnuTask(deviceId, [
            [`${wlan5}.SSID`, `${d.ssid}_5G`, 'xsd:string'],
            [`${wlan5}.PreSharedKey.1.PreSharedKey`, d.wifiPassword, 'xsd:string'],
            [`${wlan5}.KeyPassphrase`, d.wifiPassword, 'xsd:string'],
          ]);
        } catch {
          result.warnings.push('La ONU no aceptó la configuración de 5 GHz (solo se aplicó 2.4 GHz).');
        }
        result.onu = true;
      } catch (err: any) {
        result.warnings.push(`Error al configurar la ONU: ${err.message}`);
      }
    }
  }

  // 3. Registrar cliente en la plataforma
  try {
    await pool.query(
      `INSERT INTO isp_clients (mikrotik_id, created_by, client_name, username, connection_type, plan_or_speed)
       VALUES ($1, $2, $3, $4, 'pppoe', $5)`,
      [mikrotikId, tech.created_by, d.clientName, d.username, d.profile || 'default']
    );
  } catch (err: any) {
    result.warnings.push(`No se pudo registrar el cliente en la plataforma: ${err.message}`);
  }

  return result;
}

// ─── Conversación del bot ────────────────────────────────
const STEPS = ['clientName', 'username', 'password', 'profile', 'ssid', 'wifiPassword', 'serial', 'confirm'] as const;

function summary(d: any) {
  return (
    `<b>Resumen de la instalación</b>\n\n` +
    `👤 Cliente: <b>${d.clientName}</b>\n` +
    `🔑 Usuario PPPoE: <code>${d.username}</code>\n` +
    `🔒 Clave PPPoE: <code>${d.password}</code>\n` +
    `📶 Perfil/Plan: <b>${d.profile}</b>\n` +
    `📡 Nombre WiFi: <b>${d.ssid}</b>\n` +
    `🔐 Clave WiFi: <code>${d.wifiPassword}</code>\n` +
    `🏷 Serial ONU: <code>${d.serial || '-'}</code>\n\n` +
    `Responde <b>SI</b> para aplicar o <b>NO</b> para cancelar.`
  );
}

async function handleUpdate(botToken: string, mikrotikId: string, update: any) {
  const message = update.message || update.edited_message;
  if (!message?.chat?.id) return;

  const chatId = String(message.chat.id);
  const text = (message.text || '').trim();

  // Autorización: solo técnicos registrados y activos
  const { rows: techRows } = await pool.query(
    'SELECT * FROM telegram_technicians WHERE mikrotik_id = $1 AND chat_id = $2 AND is_active = true',
    [mikrotikId, chatId]
  );
  const tech = techRows[0];

  if (!tech) {
    if (text.startsWith('/start') || text.startsWith('/nuevo') || text.startsWith('/id')) {
      await say(
        botToken,
        chatId,
        `⛔ Este bot es de uso exclusivo para técnicos autorizados.\n\n` +
          `Tu Chat ID es: <code>${chatId}</code>\n` +
          `Envíalo al administrador para que te dé acceso.`
      );
    }
    return;
  }

  // Comandos
  if (text === '/cancelar') {
    await clearSession(chatId);
    await say(botToken, chatId, '❌ Instalación cancelada. Usa /nuevo para empezar de nuevo.');
    return;
  }

  if (text.startsWith('/start') || text === '/ayuda') {
    await clearSession(chatId);
    await say(
      botToken,
      chatId,
      `👷 Hola <b>${tech.full_name}</b>.\n\n` +
        `Comandos disponibles:\n` +
        `/nuevo — Crear usuario PPPoE y configurar la ONU\n` +
        `/cancelar — Cancelar la instalación en curso\n` +
        `/id — Ver tu Chat ID`
    );
    return;
  }

  if (text === '/id') {
    await say(botToken, chatId, `Tu Chat ID: <code>${chatId}</code>`);
    return;
  }

  if (text.startsWith('/nuevo')) {
    await setSession(chatId, mikrotikId, 'clientName', {});
    await say(botToken, chatId, '📝 <b>Nueva instalación</b>\n\nPaso 1/7 — Escribe el <b>nombre del cliente</b>:\n\n(/cancelar para salir)');
    return;
  }

  const session = await getSession(chatId);
  if (!session?.step) {
    await say(botToken, chatId, 'Usa /nuevo para iniciar una instalación.');
    return;
  }

  const d = session.data || {};

  switch (session.step) {
    case 'clientName':
      if (!text) return;
      d.clientName = text;
      await setSession(chatId, mikrotikId, 'username', d);
      await say(botToken, chatId, 'Paso 2/7 — Escribe el <b>usuario PPPoE</b> (ej: juan.perez):');
      return;

    case 'username': {
      const username = text.replace(/\s+/g, '');
      if (!username) return;
      const { rows: dup } = await pool.query(
        'SELECT 1 FROM isp_clients WHERE mikrotik_id = $1 AND username = $2 LIMIT 1',
        [mikrotikId, username]
      );
      if (dup[0]) {
        await say(botToken, chatId, `⚠️ El usuario <code>${username}</code> ya existe. Escribe otro:`);
        return;
      }
      d.username = username;
      await setSession(chatId, mikrotikId, 'password', d);
      await say(botToken, chatId, 'Paso 3/7 — Escribe la <b>clave PPPoE</b> o envía <b>auto</b> para generarla:');
      return;
    }

    case 'password': {
      d.password = /^auto$/i.test(text) ? randomPassword() : text;
      await setSession(chatId, mikrotikId, 'profile', d);
      let list = '';
      try {
        const config = await getDeviceConfig(pool, mikrotikId);
        const profiles: any = await mikrotikRequest(config, '/rest/ppp/profile', 'GET');
        const names = (Array.isArray(profiles) ? profiles : []).map((p: any) => p.name).filter(Boolean);
        if (names.length) list = `\n\nPerfiles disponibles:\n${names.map((n: string) => `• ${n}`).join('\n')}`;
      } catch {
        /* si la MikroTik no responde, el técnico escribe el perfil a mano */
      }
      await say(botToken, chatId, `Paso 4/7 — Escribe el <b>perfil/plan PPPoE</b>:${list}`);
      return;
    }

    case 'profile':
      d.profile = text || 'default';
      await setSession(chatId, mikrotikId, 'ssid', d);
      await say(botToken, chatId, 'Paso 5/7 — Escribe el <b>nombre de la red WiFi (SSID)</b> que pidió el cliente:');
      return;

    case 'ssid':
      if (!text) return;
      d.ssid = text;
      await setSession(chatId, mikrotikId, 'wifiPassword', d);
      await say(botToken, chatId, 'Paso 6/7 — Escribe la <b>clave WiFi</b> (mínimo 8 caracteres):');
      return;

    case 'wifiPassword':
      if (text.length < 8) {
        await say(botToken, chatId, '⚠️ La clave WiFi debe tener al menos 8 caracteres. Intenta de nuevo:');
        return;
      }
      d.wifiPassword = text;
      await setSession(chatId, mikrotikId, 'serial', d);
      await say(botToken, chatId, 'Paso 7/7 — Escribe el <b>serial de la ONU</b> (viene en la etiqueta) o envía <b>omitir</b>:');
      return;

    case 'serial':
      d.serial = /^omitir$/i.test(text) ? '' : text.replace(/\s+/g, '');
      await setSession(chatId, mikrotikId, 'confirm', d);
      await say(botToken, chatId, summary(d));
      return;

    case 'confirm': {
      if (/^no$/i.test(text)) {
        await clearSession(chatId);
        await say(botToken, chatId, '❌ Cancelado. Usa /nuevo para empezar de nuevo.');
        return;
      }
      if (!/^si$|^sí$/i.test(text)) {
        await say(botToken, chatId, 'Responde <b>SI</b> para aplicar o <b>NO</b> para cancelar.');
        return;
      }

      await say(botToken, chatId, '⏳ Aplicando configuración, espera un momento...');
      try {
        const r = await provision(mikrotikId, tech, d);
        await pool.query(
          `INSERT INTO telegram_provisions
           (mikrotik_id, technician_chat_id, technician_name, client_name, pppoe_username, pppoe_password,
            profile, wifi_ssid, wifi_password, onu_serial, onu_device_id, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [mikrotikId, chatId, tech.full_name, d.clientName, d.username, d.password, d.profile,
           d.ssid, d.wifiPassword, d.serial || null, r.onuDeviceId, r.warnings.length ? 'partial' : 'ok']
        );
        await clearSession(chatId);

        let msg =
          `✅ <b>Instalación completada</b>\n\n` +
          `👤 ${d.clientName}\n` +
          `🔑 PPPoE: <code>${d.username}</code> / <code>${d.password}</code>\n` +
          `📶 Plan: ${d.profile}\n` +
          `📡 WiFi: <b>${d.ssid}</b>\n` +
          `🔐 Clave WiFi: <code>${d.wifiPassword}</code>\n\n` +
          `${r.pppoe ? '✔️ Usuario PPPoE creado en la MikroTik' : ''}\n` +
          `${r.onu ? '✔️ ONU configurada por TR-069' : d.serial ? '⚠️ ONU no configurada' : 'ℹ️ Sin ONU (omitida)'}`;
        if (r.warnings.length) msg += `\n\n<b>Avisos:</b>\n${r.warnings.map((w: string) => `• ${w}`).join('\n')}`;
        await say(botToken, chatId, msg);
      } catch (err: any) {
        await pool.query(
          `INSERT INTO telegram_provisions
           (mikrotik_id, technician_chat_id, technician_name, client_name, pppoe_username,
            profile, wifi_ssid, onu_serial, status, error)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'error',$9)`,
          [mikrotikId, chatId, tech.full_name, d.clientName, d.username, d.profile, d.ssid, d.serial || null, err.message]
        );
        await say(botToken, chatId, `❌ Error al aplicar la configuración:\n<code>${err.message}</code>\n\nUsa /nuevo para reintentar.`);
      }
      return;
    }
  }
}

// ─── Webhook público (Telegram no envía JWT) ─────────────
telegramBotRouter.post('/webhook/:configId', async (req: Request, res: Response) => {
  // Responder rápido siempre: Telegram reintenta ante errores
  res.json({ ok: true });
  try {
    await ensureSchema();
    const { configId } = req.params;
    const { rows } = await pool.query(
      'SELECT bot_token, mikrotik_id FROM telegram_config WHERE id = $1 AND is_active = true',
      [configId]
    );
    if (!rows[0]?.bot_token) return;
    await handleUpdate(rows[0].bot_token, rows[0].mikrotik_id, req.body);
  } catch (err: any) {
    console.error('[telegram-bot] webhook error:', err.message);
  }
});

// ─── Gestión de técnicos (protegido) ─────────────────────
telegramBotRouter.get('/technicians', async (req: AuthRequest, res: Response) => {
  try {
    await ensureSchema();
    const mikrotikId = req.query.mikrotik_id as string;
    if (!mikrotikId) return res.status(400).json({ error: 'mikrotik_id requerido' });
    if (!(await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId)))
      return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      'SELECT * FROM telegram_technicians WHERE mikrotik_id = $1 ORDER BY created_at DESC',
      [mikrotikId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

telegramBotRouter.post('/technicians', async (req: AuthRequest, res: Response) => {
  try {
    await ensureSchema();
    const { mikrotik_id, chat_id, full_name } = req.body;
    if (!mikrotik_id || !chat_id || !full_name)
      return res.status(400).json({ error: 'mikrotik_id, chat_id y full_name requeridos' });
    if (!/^-?\d+$/.test(String(chat_id).trim()))
      return res.status(400).json({ error: 'El Chat ID debe ser numérico' });
    if (!(await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id)))
      return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `INSERT INTO telegram_technicians (mikrotik_id, chat_id, full_name, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (mikrotik_id, chat_id)
       DO UPDATE SET full_name = EXCLUDED.full_name, is_active = true
       RETURNING *`,
      [mikrotik_id, String(chat_id).trim(), full_name, req.userId]
    );
    res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

telegramBotRouter.put('/technicians/:id', async (req: AuthRequest, res: Response) => {
  try {
    await ensureSchema();
    const { is_active, full_name } = req.body;
    const { rows: current } = await pool.query('SELECT mikrotik_id FROM telegram_technicians WHERE id = $1', [req.params.id]);
    if (!current[0]) return res.status(404).json({ error: 'Técnico no encontrado' });
    if (!(await verifyDeviceAccess(req.userId!, req.userRole!, current[0].mikrotik_id)))
      return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `UPDATE telegram_technicians
       SET is_active = COALESCE($1, is_active), full_name = COALESCE($2, full_name)
       WHERE id = $3 RETURNING *`,
      [is_active, full_name, req.params.id]
    );
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

telegramBotRouter.delete('/technicians/:id', async (req: AuthRequest, res: Response) => {
  try {
    await ensureSchema();
    const { rows: current } = await pool.query('SELECT mikrotik_id FROM telegram_technicians WHERE id = $1', [req.params.id]);
    if (!current[0]) return res.status(404).json({ error: 'Técnico no encontrado' });
    if (!(await verifyDeviceAccess(req.userId!, req.userRole!, current[0].mikrotik_id)))
      return res.status(403).json({ error: 'Sin acceso' });

    await pool.query('DELETE FROM telegram_technicians WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Historial de instalaciones hechas por el bot ────────
telegramBotRouter.get('/provisions', async (req: AuthRequest, res: Response) => {
  try {
    await ensureSchema();
    const mikrotikId = req.query.mikrotik_id as string;
    if (!mikrotikId) return res.status(400).json({ error: 'mikrotik_id requerido' });
    if (!(await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId)))
      return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      'SELECT * FROM telegram_provisions WHERE mikrotik_id = $1 ORDER BY created_at DESC LIMIT 100',
      [mikrotikId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Registrar el webhook en Telegram ────────────────────
telegramBotRouter.post('/setup-webhook', async (req: AuthRequest, res: Response) => {
  try {
    await ensureSchema();
    const { mikrotik_id, public_url } = req.body;
    if (!mikrotik_id || !public_url)
      return res.status(400).json({ error: 'mikrotik_id y public_url requeridos' });
    if (!(await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id)))
      return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      'SELECT id, bot_token FROM telegram_config WHERE mikrotik_id = $1',
      [mikrotik_id]
    );
    if (!rows[0]?.bot_token) return res.status(404).json({ error: 'Configura primero el Bot Token' });

    const webhookUrl = `${String(public_url).replace(/\/+$/, '')}/api/telegram-bot/webhook/${rows[0].id}`;
    const result: any = await tg(rows[0].bot_token, 'setWebhook', {
      url: webhookUrl,
      allowed_updates: ['message', 'edited_message'],
    });

    if (!result?.ok) {
      return res.status(400).json({ error: result?.description || 'Telegram rechazó el webhook', webhookUrl });
    }
    res.json({ success: true, webhookUrl, data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
