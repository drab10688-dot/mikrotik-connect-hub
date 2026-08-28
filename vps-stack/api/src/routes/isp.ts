import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../lib/db';
import { AuthRequest, requireRole } from '../middleware/auth';

export const ispRouter = Router();
export const ispPublicRouter = Router();

export const SECTIONS = ['onus', 'wifi', 'pppoe', 'red', 'firmware', 'vpn', 'usuarios'] as const;
export type Section = (typeof SECTIONS)[number];

const PUBLIC_HOST = process.env.PUBLIC_HOST || process.env.VPS_PUBLIC_IP || process.env.L2TP_HOST || '';
// VPN principal: L2TP/IPsec. El VPS es la IP local del túnel.
const VPN_SERVER_IP = process.env.VPN_SERVER_IP || '192.168.42.1';
const L2TP_TUNNEL_NET = process.env.L2TP_TUNNEL_NET || '192.168.42.0/24';
const L2TP_IPSEC_PSK = process.env.L2TP_IPSEC_PSK || '';


// ─── Helpers ────────────────────────────────────────────────
async function getTenant(tenantId: string) {
  const { rows } = await pool.query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
  return rows[0] || null;
}

/** Devuelve el ISP del usuario, generando token TR-069 y subred si faltan. */
async function ensureTenant(req: AuthRequest, res: Response) {
  const tenantId = (req.query.tenant_id as string) || req.tenantId;
  if (!tenantId) {
    res.status(400).json({ error: 'Tu usuario no pertenece a ningún ISP' });
    return null;
  }
  if (req.userRole !== 'super_admin' && tenantId !== req.tenantId) {
    res.status(403).json({ error: 'Sin acceso a este ISP' });
    return null;
  }

  let tenant = await getTenant(tenantId);
  if (!tenant) {
    res.status(404).json({ error: 'ISP no encontrado' });
    return null;
  }

  if (!tenant.acs_token || !tenant.vpn_subnet) {
    const token = tenant.acs_token || crypto.randomBytes(8).toString('hex');
    let subnet = tenant.vpn_subnet;
    if (!subnet) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM tenants WHERE vpn_subnet IS NOT NULL`
      );
      subnet = `10.13.${13 + rows[0].total + 1}.0/24`;
    }
    const { rows } = await pool.query(
      `UPDATE tenants SET acs_token = $2, vpn_subnet = $3, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [tenantId, token, subnet]
    );
    tenant = rows[0];
  }
  return tenant;
}

function acsUrls(tenant: any, req: Request) {
  const host = PUBLIC_HOST || req.get('host')?.split(':')[0] || 'ACS_HOST';
  return {
    token: tenant.acs_token,
    // URL pública por ISP (igual que hace CMS: un link TR-069 por cada ISP)
    public_url: `http://${host}/tr069/${tenant.acs_token}/`,
    // URL preferida: dentro del túnel VPN, más rápida y sin exponer el ACS
    vpn_url: `http://${VPN_SERVER_IP}:7547/tr069/${tenant.acs_token}/`,
    acs_username: 'omnisync',
    acs_password: tenant.acs_token,
    connection_request_username: 'omnisync',
    connection_request_password: tenant.acs_token,
    inform_interval: 60,
    stun_enable: false,
  };
}

// ─── Resolución pública del token (usada por el ACS/provisión) ───
ispPublicRouter.get('/tr069/:token', async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, slug, name FROM tenants
       WHERE acs_token = $1 AND COALESCE(is_active, true) = true LIMIT 1`,
      [String(req.params.token)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Token no válido' });
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── ACS: datos TR-069 del ISP ──────────────────────────────
ispRouter.get('/acs', async (req: AuthRequest, res: Response) => {
  const tenant = await ensureTenant(req, res);
  if (!tenant) return;
  res.json({
    data: {
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      vpn_subnet: tenant.vpn_subnet,
      ...acsUrls(tenant, req),
    },
  });
});

ispRouter.post('/acs/rotate', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const tenant = await ensureTenant(req, res);
  if (!tenant) return;
  const token = crypto.randomBytes(8).toString('hex');
  const { rows } = await pool.query(
    `UPDATE tenants SET acs_token = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [tenant.id, token]
  );
  res.json({ data: acsUrls(rows[0], req) });
});

// ─── Permisos por rol y sección ─────────────────────────────
ispRouter.get('/permissions', async (req: AuthRequest, res: Response) => {
  const tenant = await ensureTenant(req, res);
  if (!tenant) return;
  const { rows } = await pool.query(
    `SELECT role, section, can_view, can_edit FROM role_permissions WHERE tenant_id = $1`,
    [tenant.id]
  );
  res.json({ data: { sections: SECTIONS, permissions: rows } });
});

ispRouter.put('/permissions', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const tenant = await ensureTenant(req, res);
  if (!tenant) return;
  const items = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
  if (!items.length) return res.status(400).json({ error: 'Sin permisos que guardar' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      if (!SECTIONS.includes(item.section)) continue;
      if (!['admin', 'user', 'secretary', 'reseller'].includes(item.role)) continue;
      await client.query(
        `INSERT INTO role_permissions (tenant_id, role, section, can_view, can_edit)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, role, section)
         DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit, updated_at = now()`,
        [tenant.id, item.role, item.section, !!item.can_view, !!item.can_edit]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

/** Middleware: exige permiso de sección (super_admin siempre pasa). */
export function requireSection(section: Section, edit = false) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.userRole === 'super_admin') return next();
    if (!req.tenantId) return next(); // instalación sin multi-ISP
    try {
      const { rows } = await pool.query(
        `SELECT can_view, can_edit FROM role_permissions
         WHERE tenant_id = $1 AND role = $2 AND section = $3 LIMIT 1`,
        [req.tenantId, req.userRole, section]
      );
      const perm = rows[0];
      if (!perm) return res.status(403).json({ error: `Sin permiso para ${section}` });
      if (edit ? perm.can_edit : perm.can_view) return next();
      return res.status(403).json({ error: `Sin permiso para ${section}` });
    } catch {
      return next(); // tabla ausente: no romper instalaciones antiguas
    }
  };
}

// ─── VPN del ISP: peer + script RouterOS listo para pegar ───
ispRouter.get('/vpn', async (req: AuthRequest, res: Response) => {
  const tenant = await ensureTenant(req, res);
  if (!tenant) return;
  const { rows } = await pool.query(
    `SELECT id, name, vpn_type, tunnel_ip, username, onu_networks, is_active, last_handshake, created_at
     FROM tenant_vpn_peers WHERE tenant_id = $1 ORDER BY created_at`,
    [tenant.id]
  );
  res.json({ data: { subnet: tenant.vpn_subnet, peers: rows } });
});

ispRouter.post('/vpn/script', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const tenant = await ensureTenant(req, res);
  if (!tenant) return;

  const name: string = (req.body?.name || 'mikrotik-1').toString().replace(/[^a-zA-Z0-9_-]/g, '');
  const onuNetworks: string = (req.body?.onu_networks || '10.82.0.0/21').toString();
  const serverHost = PUBLIC_HOST || req.get('host')?.split(':')[0] || 'IP_DEL_VPS';

  // Credenciales persistentes: si el peer ya existe, se reutilizan.
  const existing = await pool.query(
    `SELECT * FROM tenant_vpn_peers WHERE tenant_id = $1 AND name = $2`,
    [tenant.id, name]
  );

  let peer = existing.rows[0];
  if (!peer) {
    // IP fija dentro del pool L2TP (única en todo el servidor VPN)
    const base = L2TP_TUNNEL_NET.split('/')[0].split('.').slice(0, 3).join('.');
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tenant_vpn_peers`
    );
    const tunnelIp = `${base}.${10 + countRows[0].total}`;
    const { rows } = await pool.query(
      `INSERT INTO tenant_vpn_peers (tenant_id, name, vpn_type, tunnel_ip, psk, username, password, onu_networks)
       VALUES ($1, $2, 'l2tp', $3, $4, $5, $6, $7) RETURNING *`,
      [
        tenant.id,
        name,
        tunnelIp,
        L2TP_IPSEC_PSK || crypto.randomBytes(16).toString('hex'),
        `${tenant.slug}-${name}`,
        crypto.randomBytes(12).toString('hex'),
        onuNetworks,
      ]
    );
    peer = rows[0];
  } else if (onuNetworks && onuNetworks !== peer.onu_networks) {
    const { rows } = await pool.query(
      `UPDATE tenant_vpn_peers SET onu_networks = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [peer.id, onuNetworks]
    );
    peer = rows[0];
  }

  // El servidor L2TP usa un único IPsec PSK compartido para todos los routers.
  const psk = L2TP_IPSEC_PSK || peer.psk;
  const acs = acsUrls(tenant, req);
  const script = `# ============================================================
# OmniACS — ${tenant.name}
# VPN L2TP/IPsec + ruta hacia el ACS + NAT hacia las ONUs
# Pegar completo en la terminal de RouterOS v6/v7
# ============================================================

# 1) Túnel L2TP/IPsec hacia el VPS
/interface l2tp-client
remove [find name="OmniACS-VPN"]
add name="OmniACS-VPN" connect-to=${serverHost} user="${peer.username}" password="${peer.password}" \\
    profile=default-encryption use-ipsec=yes ipsec-secret="${psk}" \\
    add-default-route=no allow=mschap2 keepalive-timeout=30 disabled=no comment="OmniACS VPN"

# 2) Ruta hacia el ACS (VPS) por el túnel
/ip route
add dst-address=${VPN_SERVER_IP}/32 gateway="OmniACS-VPN" comment="Ruta hacia ACS"

# 3) NAT para que el ACS llegue directo al segmento de las ONUs
/ip firewall nat
add chain=srcnat out-interface="OmniACS-VPN" action=masquerade comment="NAT TR-069 OmniACS"

# 4) TR-069 de las ONUs de este ISP
#   ACS URL (por VPN) : ${acs.vpn_url}
#   ACS URL (público) : ${acs.public_url}
#   Usuario / clave   : ${acs.acs_username} / ${acs.acs_password}
#   Connection Req.   : ${acs.connection_request_username} / ${acs.connection_request_password}
#   Inform periódico  : 60s   |   STUN: desactivado (se usa la VPN)
# ============================================================
:put "OmniACS: tunel L2TP configurado hacia ${serverHost}"
`;


  res.json({
    data: {
      peer: {
        name: peer.name,
        tunnel_ip: peer.tunnel_ip,
        username: peer.username,
        onu_networks: peer.onu_networks,
      },
      acs,
      script,
    },
  });
});

ispRouter.delete('/vpn/:id', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const tenant = await ensureTenant(req, res);
  if (!tenant) return;
  await pool.query(`DELETE FROM tenant_vpn_peers WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenant.id]);
  res.json({ success: true });
});
