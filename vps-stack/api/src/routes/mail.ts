import { Router, Response } from 'express';
import { AuthRequest, requireRole } from '../middleware/auth';
import { getSmtpScope, saveSmtpScope, maskSmtp, sendTestMail } from '../lib/mailer';

export const mailRouter = Router();

/**
 * El correo SMTP es único y global del sistema (tenant_id NULL).
 * Solo el super administrador puede verlo o modificarlo; se usa
 * únicamente para los enlaces de restablecimiento de contraseña.
 */
function resolveScope(_req: AuthRequest): { tenantId: string | null } {
  return { tenantId: null };
}

mailRouter.get('/settings', requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  const scope = resolveScope(req);
  try {
    const data = await getSmtpScope(scope.tenantId);
    res.json({ data: maskSmtp(data), scope: scope.tenantId ? 'tenant' : 'global' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

mailRouter.put('/settings', requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  const scope = resolveScope(req);
  const { host, port, secure, username, password, from_email, from_name, domain, is_active } = req.body || {};

  if (!host || !String(host).trim()) return res.status(400).json({ error: 'El servidor SMTP es obligatorio' });
  if (!from_email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(from_email))) {
    return res.status(400).json({ error: 'El correo remitente no es válido' });
  }

  try {
    const saved = await saveSmtpScope(scope.tenantId, {
      host: String(host).trim(),
      port: Number(port) || 587,
      secure: !!secure,
      username: username ? String(username).trim() : null,
      password: password ? String(password) : undefined,
      from_email: String(from_email).trim().toLowerCase(),
      from_name: from_name ? String(from_name).trim() : null,
      domain: domain ? String(domain).trim().toLowerCase().replace(/^https?:\/\//, '') : null,
      is_active: is_active !== false,
    });
    res.json({ data: maskSmtp(saved) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

mailRouter.post('/test', requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  const scope = resolveScope(req);
  const to = String(req.body?.to || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return res.status(400).json({ error: 'Indica un correo de destino válido' });
  }
  try {
    await sendTestMail(scope.tenantId, to);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'No se pudo enviar el correo' });
  }
});
