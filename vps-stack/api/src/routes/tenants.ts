import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../lib/db';
import { AuthRequest, requireRole } from '../middleware/auth';
import { applyTenantOnuLimit } from '../lib/acs-tenant';
import { seedTenantPermissions } from './isp';

export const tenantsPublicRouter = Router();
export const tenantsRouter = Router();

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

// ─── Público: branding por slug (login personalizado por ISP) ─────────
tenantsPublicRouter.get('/:slug', async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT slug, name, logo_url, primary_color
       FROM tenants WHERE slug = $1 AND COALESCE(is_active, true) = true LIMIT 1`,
      [String(req.params.slug).toLowerCase()]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ISP no encontrado' });
    res.json({ data: rows[0] });
  } catch (error) {
    // Instalación sin tabla tenants todavía: no romper el login.
    res.status(404).json({ error: 'ISP no encontrado' });
  }
});

// ─── Tenant del usuario autenticado (branding del panel) ──────────────
tenantsRouter.get('/me', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.tenantId) return res.json({ data: null });
    const { rows } = await pool.query(
      `SELECT id, slug, name, logo_url, primary_color,
              COALESCE(enable_onus, true) AS enable_onus,
              COALESCE(enable_mikrotik, true) AS enable_mikrotik,
              COALESCE(enable_tr069, true) AS enable_tr069,
              COALESCE(enable_onu_web, true) AS enable_onu_web,
              web_ports
         FROM tenants WHERE id = $1`,
      [req.tenantId]
    );
    res.json({ data: rows[0] || null });
  } catch {
    res.json({ data: null });
  }
});

// Actualiza el branding del propio ISP (admin del ISP)
tenantsRouter.put('/me', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.tenantId) return res.status(400).json({ error: 'Tu usuario no pertenece a ningún ISP' });
    const { name, logo_url, primary_color } = req.body;
    const { rows } = await pool.query(
      `UPDATE tenants SET
         name = COALESCE($2, name),
         logo_url = COALESCE($3, logo_url),
         primary_color = COALESCE($4, primary_color),
         updated_at = now()
       WHERE id = $1 RETURNING id, slug, name, logo_url, primary_color`,
      [req.tenantId, name || null, logo_url || null, primary_color || null]
    );
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Gestión global (solo super_admin) ────────────────────────────────
tenantsRouter.get('/', requireRole('super_admin'), async (_req: AuthRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS users_count,
              (SELECT COUNT(*) FROM mikrotik_devices d WHERE d.tenant_id = t.id) AS devices_count,
              (SELECT COUNT(*) FROM acs_device_owners o
                WHERE o.tenant_id = t.id AND o.status = 'active') AS onus_used,
              (SELECT COUNT(*) FROM acs_device_owners o
                WHERE o.tenant_id = t.id AND o.status = 'blocked') AS onus_blocked,
              (SELECT COUNT(*) FROM tenant_vpn_peers p WHERE p.tenant_id = t.id) AS vpn_count
       FROM tenants t ORDER BY t.name`
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

tenantsRouter.post('/', requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const { name, slug, logo_url, primary_color, onu_limit, admin_email, admin_password, admin_name,
            enable_onus, enable_mikrotik } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });

    const finalSlug = slugify(slug || name);
    if (!finalSlug) return res.status(400).json({ error: 'Slug inválido' });

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO tenants (name, slug, logo_url, primary_color, onu_limit,
                            enable_onus, enable_mikrotik,
                            acs_token, vpn_subnet)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               encode(gen_random_bytes(8), 'hex'),
               '10.13.' || (13 + (SELECT COUNT(*) + 1 FROM tenants))::text || '.0/24')
       RETURNING *`,
      [name, finalSlug, logo_url || null, primary_color || null,
       Number.isFinite(Number(onu_limit)) && Number(onu_limit) > 0 ? Math.floor(Number(onu_limit)) : null,
       enable_onus !== false, enable_mikrotik !== false]
    );
    const tenant = rows[0];

    // Cada ISP nuevo arranca con su matriz de permisos por rol.
    await seedTenantPermissions(client, tenant.id).catch(() => undefined);

    if (admin_email && admin_password) {
      const password_hash = await bcrypt.hash(admin_password, await bcrypt.genSalt(12));
      const userRes = await client.query(
        `INSERT INTO users (email, password_hash, full_name, tenant_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [String(admin_email).toLowerCase(), password_hash, admin_name || name, tenant.id]
      );
      await client.query(
        `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin'::app_role)`,
        [userRes.rows[0].id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ data: tenant });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un ISP con ese slug o un usuario con ese email' });
    }
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

tenantsRouter.put('/:id', requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, slug, logo_url, primary_color, is_active, onu_limit,
            enable_onus, enable_mikrotik, web_ports, enable_tr069, enable_onu_web } = req.body;
    const { rows } = await pool.query(
      `UPDATE tenants SET
         name = COALESCE($2, name),
         slug = COALESCE($3, slug),
         logo_url = CASE WHEN $4::text IS NULL THEN logo_url
                         WHEN $4::text = '' THEN NULL ELSE $4::text END,
         primary_color = COALESCE($5, primary_color),
         is_active = COALESCE($6, is_active),
         onu_limit = CASE WHEN $7::int IS NULL THEN onu_limit
                          WHEN $7::int <= 0 THEN NULL ELSE $7::int END,
         enable_onus = COALESCE($8::boolean, enable_onus),
         enable_mikrotik = COALESCE($9::boolean, enable_mikrotik),
         web_ports = COALESCE($10::jsonb, web_ports),
         enable_tr069 = COALESCE($11::boolean, enable_tr069),
         enable_onu_web = COALESCE($12::boolean, enable_onu_web),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, name || null, slug ? slugify(slug) : null,
       logo_url === undefined || logo_url === null ? null : String(logo_url), primary_color || null,
       typeof is_active === 'boolean' ? is_active : null,
       onu_limit === undefined || onu_limit === null || onu_limit === '' ? null : Math.floor(Number(onu_limit)),
       typeof enable_onus === 'boolean' ? enable_onus : null,
       typeof enable_mikrotik === 'boolean' ? enable_mikrotik : null,
       web_ports ? JSON.stringify(web_ports) : null,
       typeof enable_tr069 === 'boolean' ? enable_tr069 : null,
       typeof enable_onu_web === 'boolean' ? enable_onu_web : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ISP no encontrado' });
    await applyTenantOnuLimit(rows[0].id).catch(() => undefined);
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

tenantsRouter.delete('/:id', requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM users WHERE tenant_id = $1`,
      [req.params.id]
    );
    if (rows[0].total > 0) {
      return res.status(400).json({ error: 'El ISP tiene usuarios asignados. Desactívalo en lugar de eliminarlo.' });
    }
    await pool.query('DELETE FROM tenants WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
