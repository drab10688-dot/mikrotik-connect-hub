import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../lib/db';
import { AuthRequest, requireRole } from '../middleware/auth';
import { upsertL2tpUser, removeL2tpUser } from '../lib/l2tp';
import { tenantOnuQuota } from '../lib/acs-tenant';


export const ispRouter = Router();
export const ispPublicRouter = Router();

export const SECTIONS = [
  'dashboard',
  'onus',
  'onu_web',
  'mikrotik',
  'topology',
  'acs',
  'wifi',
  'pppoe',
  'red',
  'vpn',
  'configuracion',
  'diagnostico',
  'usuarios',
  'roles',
] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  onus: 'Gestion de ONUs',
  onu_web: 'Mini-panel de equipos',
  mikrotik: 'Conexion MikroTik',
  topology: 'Mapa de red',
  acs: 'ACS / TR-069',
  wifi: 'Wi-Fi dual band',
  pppoe: 'PPPoE / clientes',
  red: 'Red, APs y senal',
  vpn: 'Credenciales y VPN',
  configuracion: 'Configuracion',
  diagnostico: 'Diagnostico API',
  usuarios: 'Usuarios',
  roles: 'Roles y permisos',
};

export type RoleName = 'admin' | 'user' | 'secretary' | 'reseller';
export const ROLE_NAMES: RoleName[] = ['admin', 'user', 'secretary', 'reseller'];

/**
 * Permisos por defecto que recibe cada ISP nuevo.
 * view = ver la seccion | edit = puede modificar.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, { view: string[]; edit: string[] }> = {
  admin: { view: [...SECTIONS], edit: [...SECTIONS] },
  user: {
    view: ['dashboard', 'onus', 'onu_web', 'mikrotik', 'topology', 'acs', 'wifi', 'pppoe', 'red', 'vpn', 'diagnostico'],
    edit: ['onus', 'onu_web', 'wifi', 'pppoe', 'red'],
  },
  secretary: {
    view: ['dashboard', 'onus', 'onu_web', 'topology', 'pppoe', 'red'],
    edit: ['onus', 'pppoe'],
  },
  reseller: {
    view: ['dashboard', 'onus', 'topology', 'red'],
    edit: [],
  },
};

/** Crea la matriz de permisos por defecto de un ISP (idempotente). */
export async function seedTenantPermissions(db: { query: Function }, tenantId: string) {
  for (const role of ROLE_NAMES) {
    const def = DEFAULT_ROLE_PERMISSIONS[role];
    for (const section of SECTIONS) {
      const canEdit = def.edit.includes(section);
      const canView = canEdit || def.view.includes(section);
      await db.query(
        `INSERT INTO role_permissions (tenant_id, role, section, can_view, can_edit)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, role, section) DO NOTHING`,
        [tenantId, role, section, canView, canEdit]
      );
    }
  }
}

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
  let tenantId = (req.query.tenant_id as string) || req.tenantId;

  // Instalación de un solo ISP: si el usuario no tiene ISP asignado se usa
  // (o se crea) el ISP por defecto, para no dejar la página cargando.
  if (!tenantId) {
    const { rows } = await pool.query(`SELECT id FROM tenants ORDER BY created_at LIMIT 1`);
    if (rows[0]) {
      tenantId = rows[0].id;
    } else {
      const created = await pool.query(
        `INSERT INTO tenants (name, slug) VALUES ('OmniSync', 'omnisync') RETURNING id`
      );
      tenantId = created.rows[0].id;
    }
  } else if (req.userRole !== 'super_admin' && tenantId !== req.tenantId) {
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
    // Acceso directo al CWMP sin VPN (ONU tras NAT, usando STUN)
    nat_url: `http://${host}:7547/tr069/${tenant.acs_token}/`,
    // URL preferida: dentro del túnel VPN, más rápida y sin exponer el ACS
    vpn_url: `http://${VPN_SERVER_IP}:7547/tr069/${tenant.acs_token}/`,
    acs_username: tenant.acs_username || 'omnisync',
    acs_password: tenant.acs_password || tenant.acs_token,
    connection_request_username: tenant.cr_username || 'omnisync',
    connection_request_password: tenant.cr_password || tenant.acs_token,
    inform_interval: tenant.inform_interval || 60,
    stun_enable: false,
    stun_host: tenant.stun_host || host,
    stun_port: tenant.stun_port || 3478,
    stun_username: tenant.stun_username || 'acs',
    stun_password: tenant.stun_password || 'acs',
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
  const quota = await tenantOnuQuota(tenant.id).catch(() => null);
  res.json({
    data: {
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      vpn_subnet: tenant.vpn_subnet,
      onu_quota: quota,
      ...acsUrls(tenant, req),
    },
  });
});


// Edición manual de credenciales TR-069 / STUN (el token NO se rota).
ispRouter.put('/acs/credentials', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const tenant = await ensureTenant(req, res);
  if (!tenant) return;
  const b = req.body || {};
  const str = (v: any) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const num = (v: any) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : null);
  try {
    const { rows } = await pool.query(
      `UPDATE tenants SET
         acs_username = COALESCE($2, acs_username),
         acs_password = COALESCE($3, acs_password),
         cr_username = COALESCE($4, cr_username),
         cr_password = COALESCE($5, cr_password),
         stun_host = COALESCE($6, stun_host),
         stun_port = COALESCE($7, stun_port),
         stun_username = COALESCE($8, stun_username),
         stun_password = COALESCE($9, stun_password),
         inform_interval = COALESCE($10, inform_interval),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        tenant.id,
        str(b.acs_username),
        str(b.acs_password),
        str(b.connection_request_username),
        str(b.connection_request_password),
        str(b.stun_host),
        num(b.stun_port),
        str(b.stun_username),
        str(b.stun_password),
        num(b.inform_interval),
      ]
    );
    res.json({ data: acsUrls(rows[0], req) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Permisos por rol y sección ─────────────────────────────
ispRouter.get('/permissions', async (req: AuthRequest, res: Response) => {
  const tenant = await ensureTenant(req, res);
  if (!tenant) return;
  let { rows } = await pool.query(
    `SELECT role, section, can_view, can_edit FROM role_permissions WHERE tenant_id = $1`,
    [tenant.id]
  );
  // ISP sin matriz de permisos (recien creado o migrado): sembrar defaults.
  if (!rows.length) {
    await seedTenantPermissions(pool, tenant.id).catch(() => undefined);
    ({ rows } = await pool.query(
      `SELECT role, section, can_view, can_edit FROM role_permissions WHERE tenant_id = $1`,
      [tenant.id]
    ));
  }
  res.json({ data: { sections: SECTIONS, labels: SECTION_LABELS, permissions: rows } });
});

/** Permisos efectivos del usuario autenticado (rol + anulaciones individuales). */
ispRouter.get('/my-permissions', async (req: AuthRequest, res: Response) => {
  const empty = { sections: SECTIONS, labels: SECTION_LABELS, permissions: [] as any[], full_access: false };
  try {
    if (req.userRole === 'super_admin' || !req.tenantId) {
      return res.json({ data: { ...empty, full_access: true } });
    }
    const { rows: rolePerms } = await pool.query(
      `SELECT section, can_view, can_edit FROM role_permissions
        WHERE tenant_id = $1 AND role = $2`,
      [req.tenantId, req.userRole]
    );
    if (!rolePerms.length) {
      await seedTenantPermissions(pool, req.tenantId).catch(() => undefined);
    }
    const { rows: fresh } = await pool.query(
      `SELECT section, can_view, can_edit FROM role_permissions
        WHERE tenant_id = $1 AND role = $2`,
      [req.tenantId, req.userRole]
    );
    const { rows: own } = await pool.query(
      `SELECT section, can_view, can_edit FROM user_permissions
        WHERE user_id = $1 AND (tenant_id IS NULL OR tenant_id = $2)`,
      [req.userId, req.tenantId]
    );
    const map = new Map<string, any>();
    for (const p of fresh) map.set(p.section, { ...p });
    for (const p of own) map.set(p.section, { ...p });
    res.json({
      data: { sections: SECTIONS, labels: SECTION_LABELS, permissions: [...map.values()], full_access: false },
    });
  } catch {
    // Instalaciones antiguas sin tablas: no bloquear el panel.
    res.json({ data: { ...empty, full_access: true } });
  }
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
      if (!ROLE_NAMES.includes(item.role)) continue;
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

// ─── Permisos individuales por usuario (anulan los del rol) ─
ispRouter.get('/user-permissions/:userId', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const tenant = await ensureTenant(req, res);
  if (!tenant) return;
  const { rows } = await pool.query(
    `SELECT section, can_view, can_edit FROM user_permissions
      WHERE user_id = $1 AND (tenant_id IS NULL OR tenant_id = $2)`,
    [req.params.userId, tenant.id]
  );
  res.json({ data: { sections: SECTIONS, labels: SECTION_LABELS, permissions: rows } });
});

ispRouter.put('/user-permissions/:userId', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  const tenant = await ensureTenant(req, res);
  if (!tenant) return;
  const items = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      if (!SECTIONS.includes(item.section)) continue;
      await client.query(
        `INSERT INTO user_permissions (user_id, tenant_id, section, can_view, can_edit)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, section)
         DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit,
                       tenant_id = EXCLUDED.tenant_id, updated_at = now()`,
        [req.params.userId, tenant.id, item.section, !!item.can_view, !!item.can_edit]
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
      // 1) Permiso individual del usuario (tiene prioridad)
      const { rows: own } = await pool.query(
        `SELECT can_view, can_edit FROM user_permissions
          WHERE user_id = $1 AND section = $2 LIMIT 1`,
        [req.userId, section]
      ).catch(() => ({ rows: [] as any[] }) as any);
      if (own[0]) {
        if (edit ? own[0].can_edit : own[0].can_view) return next();
        return res.status(403).json({ error: `Sin permiso para ${section}` });
      }

      // 2) Permiso del rol dentro del ISP
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

/** Middleware: exige que el ISP tenga activo el módulo (TR-069 / web ONU). */
export function requireModule(column: 'enable_tr069' | 'enable_onu_web' | 'enable_onus' | 'enable_mikrotik') {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.tenantId) return next();
    try {
      const { rows } = await pool.query(
        `SELECT COALESCE(${column}, true) AS enabled FROM tenants WHERE id = $1`,
        [req.tenantId]
      );
      if (rows[0] && rows[0].enabled === false) {
        return res.status(403).json({
          error: column === 'enable_tr069'
            ? 'TR-069 está desactivado para este ISP'
            : column === 'enable_onus'
            ? 'La gestión de ONUs está desactivada para este ISP'
            : column === 'enable_mikrotik'
            ? 'El módulo MikroTik está desactivado para este ISP'
            : 'El acceso web directo a ONUs está desactivado para este ISP',
        });
      }
      return next();
    } catch {
      return next();
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
  const mode: string = (req.body?.mode || 'vpn').toString();

  // ── Modo sin VPN: la ONU llega al ACS por IP pública + STUN (tras NAT) ──
  if (mode === 'nat') {
    const acsNat = acsUrls(tenant, req);
    const natScript = `# ============================================================
# OmniACS — ${tenant.name}
# Modo SIN VPN: la ONU se conecta al ACS por IP pública (tras NAT)
# No requiere túnel. Configura estos datos en el TR-069 de cada ONU.
# ============================================================
#
#   ACS URL           : ${acsNat.nat_url}
#   Usuario / clave   : ${acsNat.acs_username} / ${acsNat.acs_password}
#   Connection Req.   : ${acsNat.connection_request_username} / ${acsNat.connection_request_password}
#   Inform periódico  : ${acsNat.inform_interval}s
#   STUN              : habilitado
#     Servidor STUN   : ${acsNat.stun_host}
#     Puerto STUN     : ${acsNat.stun_port}
#     Usuario / clave : ${acsNat.stun_username} / ${acsNat.stun_password}
#
# Opcional en la MikroTik: permitir la salida al ACS y al STUN
/ip firewall filter
add chain=forward action=accept protocol=tcp dst-address=${serverHost} dst-port=7547 comment="OmniACS TR-069"
add chain=forward action=accept protocol=udp dst-address=${serverHost} dst-port=3478 comment="OmniACS STUN"
:put "OmniACS: modo sin VPN (NAT + STUN) hacia ${serverHost}"
`;
    return res.json({ data: { mode: 'nat', peer: null, acs: acsNat, script: natScript } });
  }



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
    await upsertL2tpUser(peer.username, peer.password, peer.tunnel_ip, peer.onu_networks);
  } else if (onuNetworks && onuNetworks !== peer.onu_networks) {
    const { rows } = await pool.query(
      `UPDATE tenant_vpn_peers SET onu_networks = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [peer.id, onuNetworks]
    );
    peer = rows[0];
    await upsertL2tpUser(peer.username, peer.password, peer.tunnel_ip, peer.onu_networks);
  } else {
    // Reaplica la cuenta por si el servidor VPN se reinstaló
    await upsertL2tpUser(peer.username, peer.password, peer.tunnel_ip, peer.onu_networks);
  }

  // L2TP sin IPsec (plain L2TP en UDP 1701): más simple y evita problemas
  // de IKE/ESP en MikroTik detrás de NAT.
  const acs = acsUrls(tenant, req);
  const script = `# ============================================================
# OmniACS — ${tenant.name}
# VPN L2TP (sin IPsec) + ruta hacia el ACS + NAT hacia las ONUs
# Pegar completo en la terminal de RouterOS v6/v7
# ============================================================

# 1) Túnel L2TP hacia el VPS (sin IPsec)
/interface l2tp-client
remove [find name="OmniACS-VPN"]
add name="OmniACS-VPN" connect-to=${serverHost} user="${peer.username}" password="${peer.password}" \\
    profile=default-encryption use-ipsec=no \\
    add-default-route=no allow=mschap2 keepalive-timeout=30 dial-on-demand=no \
    disabled=no comment="OmniACS VPN"

# 2) Ruta hacia el ACS (VPS) por el túnel
/ip route
remove [find comment="Ruta hacia ACS"]
add dst-address=${VPN_SERVER_IP}/32 gateway="OmniACS-VPN" comment="Ruta hacia ACS"

# 3) NAT para que el ACS llegue directo al segmento de las ONUs
/ip firewall nat
remove [find comment="NAT TR-069 OmniACS"]
add chain=srcnat out-interface="OmniACS-VPN" action=masquerade comment="NAT TR-069 OmniACS"

# 4) RouterOS reconecta L2TP de forma nativa. Se eliminan watchdogs antiguos
# para no manipular la interfaz mientras está negociando.
/system script
remove [find name="OmniACS-VPN-Watchdog"]
/system scheduler
remove [find name="OmniACS-VPN-Watchdog"]

# 5) TR-069 de las ONUs de este ISP
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
  const { rows } = await pool.query(
    `DELETE FROM tenant_vpn_peers WHERE id = $1 AND tenant_id = $2 RETURNING username`,
    [req.params.id, tenant.id]
  );
  if (rows[0]?.username) await removeL2tpUser(rows[0].username, rows[0].tunnel_ip);
  res.json({ success: true });
});
