/**
 * RADIUS Manager - Gestión centralizada estilo "User Manager" de MikroTik
 *
 * Endpoints sobre el MariaDB de FreeRADIUS:
 *  - /users     CRUD radcheck + radusergroup + radreply
 *  - /groups    CRUD radgroupreply (perfiles con velocidad, cuota, timeouts)
 *  - /sessions  Sesiones activas y accounting (radacct)
 *  - /nas       Routers RADIUS (tabla nas)
 *  - /provision Configuración automática del MikroTik vía REST + script .rsc
 */
import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { rq, rwrite } from '../lib/radius-db';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { pool } from '../lib/db';

export const radiusRouter = Router();

// ─── Helpers ───────────────────────────────────────────────
const ALLOWED_REPLY_ATTRS = new Set([
  'Mikrotik-Rate-Limit',
  'Mikrotik-Group',
  'Mikrotik-Address-List',
  'Session-Timeout',
  'Idle-Timeout',
  'Acct-Interim-Interval',
  'Mikrotik-Total-Limit',
  'Framed-Pool',
  'Framed-IP-Address',
  'WISPr-Bandwidth-Max-Up',
  'WISPr-Bandwidth-Max-Down',
]);

function pickAttrs(obj: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (ALLOWED_REPLY_ATTRS.has(k) && v != null && String(v).trim() !== '') {
      out[k] = String(v);
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// USERS  (radcheck + radusergroup + radreply)
// ═══════════════════════════════════════════════════════════

/** GET /api/radius/users?search=&group=&limit= */
radiusRouter.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const search = String(req.query.search || '').trim();
    const group = String(req.query.group || '').trim();
    const limit = Math.min(parseInt(String(req.query.limit || '500'), 10) || 500, 2000);

    const where: string[] = [`rc.attribute IN ('Cleartext-Password','User-Password')`];
    const params: any[] = [];

    if (search) {
      where.push(`rc.username LIKE ?`);
      params.push(`%${search}%`);
    }
    if (group) {
      where.push(`EXISTS (SELECT 1 FROM radusergroup ug WHERE ug.username = rc.username AND ug.groupname = ?)`);
      params.push(group);
    }

    const sql = `
      SELECT
        rc.id, rc.username, rc.value AS password, rc.attribute,
        (SELECT GROUP_CONCAT(ug.groupname) FROM radusergroup ug WHERE ug.username = rc.username) AS groups,
        (SELECT MAX(ra.acctstarttime) FROM radacct ra WHERE ra.username = rc.username) AS last_session,
        (SELECT COUNT(*) FROM radacct ra WHERE ra.username = rc.username AND ra.acctstoptime IS NULL) AS active_sessions,
        (SELECT COALESCE(SUM(ra.acctinputoctets + ra.acctoutputoctets),0) FROM radacct ra WHERE ra.username = rc.username) AS total_bytes
      FROM radcheck rc
      WHERE ${where.join(' AND ')}
      ORDER BY rc.username ASC
      LIMIT ?
    `;
    params.push(limit);
    const rows = await rq(sql, params);
    res.json({ data: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/radius/users/:username  - detalle con replies */
radiusRouter.get('/users/:username', async (req: AuthRequest, res: Response) => {
  try {
    const { username } = req.params;
    const [check] = await rq(
      `SELECT id, username, value AS password FROM radcheck
       WHERE username = ? AND attribute IN ('Cleartext-Password','User-Password') LIMIT 1`,
      [username]
    );
    if (!check) return res.status(404).json({ error: 'Usuario no encontrado' });

    const replies = await rq(`SELECT id, attribute, op, value FROM radreply WHERE username = ?`, [username]);
    const groups = await rq(`SELECT groupname, priority FROM radusergroup WHERE username = ? ORDER BY priority ASC`, [username]);
    const recent = await rq(
      `SELECT acctsessionid, nasipaddress, framedipaddress, callingstationid,
              acctstarttime, acctstoptime, acctsessiontime, acctinputoctets, acctoutputoctets, acctterminatecause
       FROM radacct WHERE username = ? ORDER BY acctstarttime DESC LIMIT 20`,
      [username]
    );

    res.json({ data: { ...check, replies, groups, recent_sessions: recent } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/radius/users  { username, password, group?, attributes? } */
radiusRouter.post('/users', async (req: AuthRequest, res: Response) => {
  try {
    const { username, password, group, attributes } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username y password son requeridos' });
    }

    // 1) password en radcheck
    await rwrite(
      `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?)`,
      [username, password]
    );

    // 2) grupo (perfil)
    if (group) {
      await rwrite(
        `INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)`,
        [username, group]
      );
    }

    // 3) reply attributes opcionales (ej. IP fija, rate-limit individual)
    const attrs = pickAttrs(attributes || {});
    for (const [attr, val] of Object.entries(attrs)) {
      await rwrite(
        `INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, '=', ?)`,
        [username, attr, val]
      );
    }

    res.status(201).json({ data: { username, group: group || null } });
  } catch (e: any) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El usuario ya existe' });
    res.status(500).json({ error: e.message });
  }
});

/** PUT /api/radius/users/:username  { password?, group?, attributes? } */
radiusRouter.put('/users/:username', async (req: AuthRequest, res: Response) => {
  try {
    const { username } = req.params;
    const { password, group, attributes } = req.body || {};

    if (password) {
      await rwrite(
        `UPDATE radcheck SET value = ? WHERE username = ? AND attribute IN ('Cleartext-Password','User-Password')`,
        [password, username]
      );
    }

    if (group !== undefined) {
      await rwrite(`DELETE FROM radusergroup WHERE username = ?`, [username]);
      if (group) {
        await rwrite(
          `INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)`,
          [username, group]
        );
      }
    }

    if (attributes) {
      await rwrite(`DELETE FROM radreply WHERE username = ?`, [username]);
      const attrs = pickAttrs(attributes);
      for (const [attr, val] of Object.entries(attrs)) {
        await rwrite(
          `INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, '=', ?)`,
          [username, attr, val]
        );
      }
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** DELETE /api/radius/users/:username  - elimina TODO rastro del usuario */
radiusRouter.delete('/users/:username', async (req: AuthRequest, res: Response) => {
  try {
    const { username } = req.params;
    await rwrite(`DELETE FROM radcheck WHERE username = ?`, [username]);
    await rwrite(`DELETE FROM radreply WHERE username = ?`, [username]);
    await rwrite(`DELETE FROM radusergroup WHERE username = ?`, [username]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// GROUPS / PROFILES  (radgroupreply + radgroupcheck)
// ═══════════════════════════════════════════════════════════

/** GET /api/radius/groups */
radiusRouter.get('/groups', async (_req: AuthRequest, res: Response) => {
  try {
    const groups = await rq(
      `SELECT groupname,
              GROUP_CONCAT(CONCAT(attribute,':',value) SEPARATOR '||') AS attrs,
              (SELECT COUNT(DISTINCT username) FROM radusergroup ug WHERE ug.groupname = grp.groupname) AS user_count
       FROM radgroupreply grp
       GROUP BY groupname
       ORDER BY groupname ASC`
    );
    const data = groups.map((g: any) => {
      const attributes: Record<string, string> = {};
      String(g.attrs || '')
        .split('||')
        .filter(Boolean)
        .forEach((pair: string) => {
          const idx = pair.indexOf(':');
          if (idx > 0) attributes[pair.slice(0, idx)] = pair.slice(idx + 1);
        });
      return {
        groupname: g.groupname,
        user_count: g.user_count,
        attributes,
        rate_limit: attributes['Mikrotik-Rate-Limit'] || null,
        session_timeout: attributes['Session-Timeout'] || null,
        idle_timeout: attributes['Idle-Timeout'] || null,
        total_limit: attributes['Mikrotik-Total-Limit'] || null,
      };
    });
    res.json({ data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/radius/groups  { groupname, attributes:{...} } */
radiusRouter.post('/groups', async (req: AuthRequest, res: Response) => {
  try {
    const { groupname, attributes } = req.body || {};
    if (!groupname) return res.status(400).json({ error: 'groupname es requerido' });

    const attrs = pickAttrs(attributes || {});
    if (Object.keys(attrs).length === 0) {
      return res.status(400).json({ error: 'Debe incluir al menos un atributo (rate-limit, timeout, etc.)' });
    }

    for (const [attr, val] of Object.entries(attrs)) {
      await rwrite(
        `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, '=', ?)`,
        [groupname, attr, val]
      );
    }
    res.status(201).json({ data: { groupname, attributes: attrs } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** PUT /api/radius/groups/:groupname  - reemplaza atributos */
radiusRouter.put('/groups/:groupname', async (req: AuthRequest, res: Response) => {
  try {
    const { groupname } = req.params;
    const { attributes } = req.body || {};
    await rwrite(`DELETE FROM radgroupreply WHERE groupname = ?`, [groupname]);
    const attrs = pickAttrs(attributes || {});
    for (const [attr, val] of Object.entries(attrs)) {
      await rwrite(
        `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, '=', ?)`,
        [groupname, attr, val]
      );
    }
    res.json({ success: true, attributes: attrs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** DELETE /api/radius/groups/:groupname */
radiusRouter.delete('/groups/:groupname', async (req: AuthRequest, res: Response) => {
  try {
    const { groupname } = req.params;
    await rwrite(`DELETE FROM radgroupreply WHERE groupname = ?`, [groupname]);
    await rwrite(`DELETE FROM radgroupcheck WHERE groupname = ?`, [groupname]);
    await rwrite(`DELETE FROM radusergroup WHERE groupname = ?`, [groupname]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// SESSIONS / ACCOUNTING (radacct)
// ═══════════════════════════════════════════════════════════

/** GET /api/radius/sessions/active */
radiusRouter.get('/sessions/active', async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await rq(
      `SELECT radacctid, username, nasipaddress, framedipaddress, callingstationid, calledstationid,
              acctstarttime, acctsessiontime, acctinputoctets, acctoutputoctets
       FROM radacct
       WHERE acctstoptime IS NULL
       ORDER BY acctstarttime DESC
       LIMIT 500`
    );
    res.json({ data: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/radius/sessions/history?username=&limit= */
radiusRouter.get('/sessions/history', async (req: AuthRequest, res: Response) => {
  try {
    const username = String(req.query.username || '').trim();
    const limit = Math.min(parseInt(String(req.query.limit || '200'), 10) || 200, 1000);
    const where: string[] = [];
    const params: any[] = [];
    if (username) {
      where.push(`username LIKE ?`);
      params.push(`%${username}%`);
    }
    const sql = `
      SELECT radacctid, username, nasipaddress, framedipaddress, callingstationid,
             acctstarttime, acctstoptime, acctsessiontime,
             acctinputoctets, acctoutputoctets, acctterminatecause
      FROM radacct
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY acctstarttime DESC
      LIMIT ?
    `;
    params.push(limit);
    const rows = await rq(sql, params);
    res.json({ data: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/radius/sessions/stats - resumen general */
radiusRouter.get('/sessions/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const [totals] = await rq(
      `SELECT
         (SELECT COUNT(*) FROM radcheck WHERE attribute IN ('Cleartext-Password','User-Password')) AS total_users,
         (SELECT COUNT(DISTINCT groupname) FROM radgroupreply) AS total_groups,
         (SELECT COUNT(*) FROM radacct WHERE acctstoptime IS NULL) AS active_sessions,
         (SELECT COUNT(*) FROM nas) AS total_nas,
         (SELECT COALESCE(SUM(acctinputoctets+acctoutputoctets),0)
           FROM radacct WHERE acctstarttime >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS bytes_30d`
    );
    res.json({ data: totals });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/radius/sessions/:id/disconnect - marca como cerrada (requiere CoA en MikroTik para drop real) */
radiusRouter.post('/sessions/:id/disconnect', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await rwrite(
      `UPDATE radacct SET acctstoptime = NOW(), acctterminatecause = 'Admin-Reset'
       WHERE radacctid = ? AND acctstoptime IS NULL`,
      [id]
    );
    res.json({ success: true, note: 'Sesión cerrada en accounting. Para desconectar al usuario en vivo configura CoA en el MikroTik.' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// NAS  (tabla nas - clientes RADIUS / routers MikroTik)
// ═══════════════════════════════════════════════════════════

/** GET /api/radius/nas */
radiusRouter.get('/nas', async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await rq(
      `SELECT id, nasname, shortname, type, ports, secret, server, community, description
       FROM nas ORDER BY id DESC`
    );
    res.json({ data: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/radius/nas  { nasname, shortname, secret, type?, description? } */
radiusRouter.post('/nas', async (req: AuthRequest, res: Response) => {
  try {
    const { nasname, shortname, secret, type, description } = req.body || {};
    if (!nasname || !shortname || !secret) {
      return res.status(400).json({ error: 'nasname, shortname y secret son requeridos' });
    }
    const result = await rwrite(
      `INSERT INTO nas (nasname, shortname, type, secret, description)
       VALUES (?, ?, ?, ?, ?)`,
      [nasname, shortname, type || 'mikrotik', secret, description || 'Registered via OmniSync RADIUS Manager']
    );
    res.status(201).json({ data: { id: result.insertId, nasname, shortname } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** PUT /api/radius/nas/:id */
radiusRouter.put('/nas/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { nasname, shortname, secret, type, description } = req.body || {};
    await rwrite(
      `UPDATE nas SET nasname = COALESCE(?,nasname), shortname = COALESCE(?,shortname),
                     secret = COALESCE(?,secret), type = COALESCE(?,type),
                     description = COALESCE(?,description)
       WHERE id = ?`,
      [nasname, shortname, secret, type, description, id]
    );
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** DELETE /api/radius/nas/:id */
radiusRouter.delete('/nas/:id', async (req: AuthRequest, res: Response) => {
  try {
    await rwrite(`DELETE FROM nas WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// PROVISION  - Auto-config MikroTik para usar este RADIUS
// ═══════════════════════════════════════════════════════════

/**
 * GET /api/radius/provision/:mikrotikId/script
 * Devuelve el script .rsc para pegar manualmente en RouterOS.
 */
radiusRouter.get('/provision/:mikrotikId/script', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const radiusHost = String(req.query.radius_host || process.env.RADIUS_PUBLIC_HOST || '');
    const secret = String(req.query.secret || process.env.RADIUS_SECRET || 'testing123');
    const services = String(req.query.services || 'hotspot,ppp');

    if (!radiusHost) {
      return res.status(400).json({
        error: 'Define radius_host (?radius_host=IP_DEL_VPS o IP del túnel WireGuard del VPS)',
      });
    }

    const script = `# OmniSync RADIUS Provisioning Script
# Generated: ${new Date().toISOString()}
# RADIUS Server: ${radiusHost}

/radius
add address=${radiusHost} secret=${secret} service=${services} timeout=3s comment="OmniSync RADIUS"

/radius incoming
set accept=yes

/ip hotspot profile
set [find default=yes] use-radius=yes radius-accounting=yes

/ppp aaa
set use-radius=yes accounting=yes
`;
    res.type('text/plain').send(script);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/radius/provision/:mikrotikId/auto
 * Configura el MikroTik vía REST para que apunte al RADIUS.
 * Body: { radius_host, secret?, services? ('hotspot,ppp'), enable_hotspot?, enable_ppp? }
 */
radiusRouter.post('/provision/:mikrotikId/auto', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);
    const {
      radius_host,
      secret = process.env.RADIUS_SECRET || 'testing123',
      services = 'hotspot,ppp',
      enable_hotspot = true,
      enable_ppp = true,
      register_nas = true,
    } = req.body || {};

    if (!radius_host) return res.status(400).json({ error: 'radius_host es requerido' });

    const log: string[] = [];

    // 1) Agregar /radius (si ya existe, ignorar)
    try {
      await mikrotikRequest(config, '/rest/radius/add', 'POST', {
        address: radius_host,
        secret,
        service: services,
        timeout: '3s',
        comment: 'OmniSync RADIUS',
      });
      log.push('✓ RADIUS server agregado');
    } catch (e: any) {
      log.push(`⚠ RADIUS add: ${e.message}`);
    }

    // 2) Habilitar incoming (CoA)
    try {
      await mikrotikRequest(config, '/rest/radius/incoming/set', 'POST', { accept: 'yes' });
      log.push('✓ RADIUS CoA (incoming) habilitado');
    } catch (e: any) {
      log.push(`⚠ CoA: ${e.message}`);
    }

    // 3) Hotspot profile use-radius
    if (enable_hotspot) {
      try {
        const profiles: any = await mikrotikRequest(config, '/rest/ip/hotspot/profile');
        const def = (profiles || []).find((p: any) => p.default === 'true' || p.name === 'default');
        if (def) {
          await mikrotikRequest(config, '/rest/ip/hotspot/profile/set', 'POST', {
            '.id': def['.id'],
            'use-radius': 'yes',
            'radius-accounting': 'yes',
          });
          log.push(`✓ Hotspot profile "${def.name}" usa RADIUS`);
        }
      } catch (e: any) {
        log.push(`⚠ Hotspot profile: ${e.message}`);
      }
    }

    // 4) PPP AAA use-radius
    if (enable_ppp) {
      try {
        await mikrotikRequest(config, '/rest/ppp/aaa/set', 'POST', {
          'use-radius': 'yes',
          accounting: 'yes',
        });
        log.push('✓ PPP AAA usa RADIUS');
      } catch (e: any) {
        log.push(`⚠ PPP AAA: ${e.message}`);
      }
    }

    // 5) Registrar NAS en la tabla del RADIUS
    if (register_nas) {
      try {
        const shortname = `mt-${mikrotikId.slice(0, 8)}`;
        await rwrite(
          `INSERT IGNORE INTO nas (nasname, shortname, type, secret, description)
           VALUES (?, ?, 'mikrotik', ?, ?)`,
          [config.host, shortname, secret, `Auto-registered for device ${mikrotikId}`]
        );
        log.push(`✓ NAS registrado: ${config.host}`);
      } catch (e: any) {
        log.push(`⚠ NAS register: ${e.message}`);
      }
    }

    res.json({ success: true, log });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
