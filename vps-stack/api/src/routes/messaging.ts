import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { pool } from '../server';

export const messagingRouter = Router();

// ─── Telegram Config ──────────────────────────
messagingRouter.get('/telegram/config', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.query.mikrotik_id as string;
    if (!mikrotikId) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      'SELECT * FROM telegram_config WHERE mikrotik_id = $1',
      [mikrotikId]
    );
    res.json({ data: rows[0] || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

messagingRouter.put('/telegram/config', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id, bot_token, bot_username, is_active } = req.body;
    if (!mikrotik_id) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `INSERT INTO telegram_config (mikrotik_id, created_by, bot_token, bot_username, is_active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (mikrotik_id) DO UPDATE SET
         bot_token = EXCLUDED.bot_token,
         bot_username = EXCLUDED.bot_username,
         is_active = EXCLUDED.is_active
       RETURNING *`,
      [mikrotik_id, req.userId, bot_token, bot_username, is_active ?? true]
    );
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

messagingRouter.post('/telegram/send', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id, chat_id, message, client_id } = req.body;
    if (!mikrotik_id || !chat_id || !message) {
      return res.status(400).json({ error: 'mikrotik_id, chat_id y message requeridos' });
    }

    // Get bot token
    const { rows: configRows } = await pool.query(
      'SELECT bot_token FROM telegram_config WHERE mikrotik_id = $1 AND is_active = true',
      [mikrotik_id]
    );
    if (!configRows[0]) return res.status(404).json({ error: 'Telegram no configurado' });

    const botToken = configRows[0].bot_token;

    // Send via Telegram API
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text: message, parse_mode: 'HTML' }),
    });
    const result = await response.json() as any;

    // Log message
    await pool.query(
      `INSERT INTO telegram_messages (mikrotik_id, created_by, chat_id, message_content, status, telegram_message_id, client_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [mikrotik_id, req.userId, chat_id, message,
       result.ok ? 'sent' : 'failed',
       result.result?.message_id?.toString() || null,
       client_id || null]
    );

    res.json({ success: result.ok, data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── WhatsApp Config ──────────────────────────
messagingRouter.get('/whatsapp/config', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.query.mikrotik_id as string;
    if (!mikrotikId) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      'SELECT * FROM whatsapp_config WHERE mikrotik_id = $1',
      [mikrotikId]
    );
    res.json({ data: rows[0] || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

messagingRouter.put('/whatsapp/config', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id, access_token, phone_number_id, business_account_id, is_active } = req.body;
    if (!mikrotik_id) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `INSERT INTO whatsapp_config (mikrotik_id, created_by, access_token, phone_number_id, business_account_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (mikrotik_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         phone_number_id = EXCLUDED.phone_number_id,
         business_account_id = EXCLUDED.business_account_id,
         is_active = EXCLUDED.is_active
       RETURNING *`,
      [mikrotik_id, req.userId, access_token, phone_number_id, business_account_id, is_active ?? true]
    );
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

messagingRouter.post('/whatsapp/send', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id, phone_number, message, client_id } = req.body;
    if (!mikrotik_id || !phone_number || !message) {
      return res.status(400).json({ error: 'mikrotik_id, phone_number y message requeridos' });
    }

    const { rows: configRows } = await pool.query(
      'SELECT access_token, phone_number_id FROM whatsapp_config WHERE mikrotik_id = $1 AND is_active = true',
      [mikrotik_id]
    );
    if (!configRows[0]) return res.status(404).json({ error: 'WhatsApp no configurado' });

    const { access_token, phone_number_id } = configRows[0];

    const response = await fetch(`https://graph.facebook.com/v18.0/${phone_number_id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone_number,
        type: 'text',
        text: { body: message },
      }),
    });
    const result = await response.json() as any;

    await pool.query(
      `INSERT INTO whatsapp_messages (mikrotik_id, created_by, phone_number, message_content, status, whatsapp_message_id, client_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [mikrotik_id, req.userId, phone_number, message,
       result.messages ? 'sent' : 'failed',
       result.messages?.[0]?.id || null,
       client_id || null]
    );

    res.json({ success: !!result.messages, data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
