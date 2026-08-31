import nodemailer, { Transporter } from 'nodemailer';
import { pool } from './db';

/**
 * Configuración SMTP por ISP (tenant_id) o global del sistema (tenant_id NULL).
 * Se usa para restablecer contraseñas y avisos del panel.
 */
export interface SmtpSettings {
  id?: string;
  tenant_id: string | null;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
  from_email: string;
  from_name: string | null;
  domain: string | null;
  is_active: boolean;
}

const GLOBAL_KEY = '00000000-0000-0000-0000-000000000000';

/** Devuelve la configuración del ISP; si no existe, la global del sistema. */
export async function getSmtpSettings(tenantId?: string | null): Promise<SmtpSettings | null> {
  try {
    if (tenantId) {
      const { rows } = await pool.query(
        `SELECT * FROM smtp_settings WHERE tenant_id = $1 AND COALESCE(is_active, true) = true LIMIT 1`,
        [tenantId]
      );
      if (rows[0]?.host) return rows[0];
    }
    const { rows } = await pool.query(
      `SELECT * FROM smtp_settings WHERE tenant_id IS NULL AND COALESCE(is_active, true) = true LIMIT 1`
    );
    return rows[0]?.host ? rows[0] : null;
  } catch (error: any) {
    console.warn('[MAIL] settings:', error.message);
    return null;
  }
}

/** Configuración cruda del ámbito exacto (sin herencia). Para la pantalla de ajustes. */
export async function getSmtpScope(tenantId: string | null): Promise<SmtpSettings | null> {
  const { rows } = tenantId
    ? await pool.query(`SELECT * FROM smtp_settings WHERE tenant_id = $1 LIMIT 1`, [tenantId])
    : await pool.query(`SELECT * FROM smtp_settings WHERE tenant_id IS NULL LIMIT 1`);
  return rows[0] || null;
}

/** Crea/actualiza la configuración de un ámbito (ISP o global). */
export async function saveSmtpScope(
  tenantId: string | null,
  data: Partial<SmtpSettings>
): Promise<SmtpSettings> {
  const existing = await getSmtpScope(tenantId);
  const merged = {
    host: (data.host ?? existing?.host ?? '').trim(),
    port: Number(data.port ?? existing?.port ?? 587) || 587,
    secure: typeof data.secure === 'boolean' ? data.secure : existing?.secure ?? false,
    username: data.username ?? existing?.username ?? null,
    // Si llega vacío se conserva la contraseña guardada (la UI nunca la muestra).
    password: data.password ? String(data.password) : existing?.password ?? null,
    from_email: (data.from_email ?? existing?.from_email ?? '').trim(),
    from_name: data.from_name ?? existing?.from_name ?? null,
    domain: data.domain ?? existing?.domain ?? null,
    is_active: typeof data.is_active === 'boolean' ? data.is_active : existing?.is_active ?? true,
  };

  if (existing) {
    const { rows } = await pool.query(
      `UPDATE smtp_settings SET host=$2, port=$3, secure=$4, username=$5, password=$6,
              from_email=$7, from_name=$8, domain=$9, is_active=$10, updated_at=now()
       WHERE id = $1 RETURNING *`,
      [existing.id, merged.host, merged.port, merged.secure, merged.username, merged.password,
       merged.from_email, merged.from_name, merged.domain, merged.is_active]
    );
    return rows[0];
  }

  const { rows } = await pool.query(
    `INSERT INTO smtp_settings (tenant_id, host, port, secure, username, password,
                                from_email, from_name, domain, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [tenantId, merged.host, merged.port, merged.secure, merged.username, merged.password,
     merged.from_email, merged.from_name, merged.domain, merged.is_active]
  );
  return rows[0];
}

/** Oculta la contraseña antes de enviarla al panel. */
export function maskSmtp(s: SmtpSettings | null) {
  if (!s) return null;
  const { password, ...rest } = s as any;
  return { ...rest, has_password: !!password };
}

function buildTransport(s: SmtpSettings): Transporter {
  return nodemailer.createTransport({
    host: s.host,
    port: Number(s.port) || 587,
    secure: !!s.secure,
    auth: s.username ? { user: s.username, pass: s.password || '' } : undefined,
    tls: { rejectUnauthorized: false },
  });
}

export interface MailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/** Envía un correo con la configuración del ISP (o la global). */
export async function sendMail(tenantId: string | null, payload: MailPayload) {
  const settings = await getSmtpSettings(tenantId);
  if (!settings?.host || !settings?.from_email) {
    throw new Error('No hay servidor de correo (SMTP) configurado');
  }
  const transporter = buildTransport(settings);
  const from = settings.from_name
    ? `"${settings.from_name}" <${settings.from_email}>`
    : settings.from_email;
  await transporter.sendMail({
    from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text || payload.html.replace(/<[^>]+>/g, ' '),
  });
}

/** Prueba la conexión SMTP de un ámbito enviando un correo de verificación. */
export async function sendTestMail(tenantId: string | null, to: string) {
  await sendMail(tenantId, {
    to,
    subject: 'Prueba de correo · OmniSync',
    html: `<p>Tu servidor de correo está configurado correctamente.</p>
           <p style="color:#64748b;font-size:12px">Enviado por OmniSync el ${new Date().toLocaleString('es-CO')}</p>`,
  });
}

/** Plantilla del correo de restablecimiento de contraseña. */
export function resetPasswordEmail(link: string, brand: string) {
  return {
    subject: `Restablecer contraseña · ${brand}`,
    html: `
<div style="font-family:Segoe UI,Arial,sans-serif;background:#0b1220;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#111c33;border:1px solid #1e2c4a;border-radius:14px;padding:28px;color:#e2e8f0">
    <h1 style="margin:0 0 8px;font-size:20px;color:#38bdf8">${brand}</h1>
    <p style="margin:0 0 18px;font-size:14px;color:#94a3b8">Recibimos una solicitud para restablecer tu contraseña.</p>
    <a href="${link}" style="display:inline-block;background:#0ea5e9;color:#04121f;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">Crear nueva contraseña</a>
    <p style="margin:20px 0 0;font-size:12px;color:#64748b">El enlace expira en 60 minutos. Si no lo solicitaste, ignora este correo.</p>
    <p style="margin:10px 0 0;font-size:11px;color:#475569;word-break:break-all">${link}</p>
  </div>
</div>`,
  };
}

export const SMTP_GLOBAL_KEY = GLOBAL_KEY;
