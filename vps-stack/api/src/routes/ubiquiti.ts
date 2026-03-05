import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const router = Router();

// ─── airOS HTTP Client ─────────────────────────
interface AirOsSession {
  cookie: string;
}

async function airOsLogin(host: string, username: string, password: string): Promise<AirOsSession> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`http://${host}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
      signal: controller.signal,
      redirect: 'manual',
    });

    const setCookie = res.headers.get('set-cookie') || '';
    const match = setCookie.match(/AIROS_SESSIONID=([^;]+)/);
    if (!match) {
      // Try alternative login for older firmware
      const altRes = await fetch(`http://${host}/login.cgi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&Submit=Login`,
        signal: controller.signal,
        redirect: 'manual',
      });
      const altCookie = altRes.headers.get('set-cookie') || '';
      const altMatch = altCookie.match(/AIROS_SESSIONID=([^;]+)/);
      if (!altMatch) throw new Error('airOS authentication failed');
      return { cookie: `AIROS_SESSIONID=${altMatch[1]}` };
    }
    return { cookie: `AIROS_SESSIONID=${match[1]}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function airOsRequest(host: string, path: string, session: AirOsSession): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`http://${host}${path}`, {
      headers: { Cookie: session.cookie },
      signal: controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function airOsReboot(host: string, session: AirOsSession): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`http://${host}/api/v1.0/system/reboot`, {
      method: 'POST',
      headers: { Cookie: session.cookie },
      signal: controller.signal,
    });
    return res.ok;
  } finally {
    clearTimeout(timeout);
  }
}

function getPool(req: Request): Pool {
  return (req as any).app.get('pool') || (req as any).pool;
}

// ─── Global Config ─────────────────────────────
router.get('/config', async (req: Request, res: Response) => {
  try {
    const pool = getPool(req);
    const userId = (req as any).user?.id;
    const result = await pool.query(
      'SELECT id, default_username, created_at, updated_at FROM ubiquiti_global_config WHERE created_by = $1 LIMIT 1',
      [userId]
    );
    res.json(result.rows[0] || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config', async (req: Request, res: Response) => {
  try {
    const pool = getPool(req);
    const userId = (req as any).user?.id;
    const { default_username, default_password } = req.body;

    if (!default_username || !default_password) {
      return res.status(400).json({ error: 'Username y password son requeridos' });
    }

    const existing = await pool.query(
      'SELECT id FROM ubiquiti_global_config WHERE created_by = $1',
      [userId]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE ubiquiti_global_config SET default_username = $1, default_password = $2, updated_at = now() WHERE created_by = $3`,
        [default_username, default_password, userId]
      );
    } else {
      await pool.query(
        `INSERT INTO ubiquiti_global_config (created_by, default_username, default_password) VALUES ($1, $2, $3)`,
        [userId, default_username, default_password]
      );
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Devices CRUD ──────────────────────────────
router.get('/devices', async (req: Request, res: Response) => {
  try {
    const pool = getPool(req);
    const userId = (req as any).user?.id;
    const result = await pool.query(
      `SELECT ud.*, ic.client_name 
       FROM ubiquiti_devices ud
       LEFT JOIN isp_clients ic ON ic.id = ud.client_id
       WHERE ud.created_by = $1
       ORDER BY ud.name ASC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices', async (req: Request, res: Response) => {
  try {
    const pool = getPool(req);
    const userId = (req as any).user?.id;
    const { name, ip_address, username, password, model, mac_address, client_id, notes } = req.body;

    if (!name || !ip_address) {
      return res.status(400).json({ error: 'Nombre e IP son requeridos' });
    }

    const result = await pool.query(
      `INSERT INTO ubiquiti_devices (name, ip_address, username, password, model, mac_address, client_id, created_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [name, ip_address, username || null, password || null, model || null, mac_address || null, client_id || null, userId, notes || null]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/devices/:id([0-9a-fA-F-]{36})', async (req: Request, res: Response) => {
  try {
    const pool = getPool(req);
    const userId = (req as any).user?.id;
    const { name, ip_address, username, password, model, mac_address, client_id, notes } = req.body;

    const result = await pool.query(
      `UPDATE ubiquiti_devices SET 
        name = COALESCE($1, name),
        ip_address = COALESCE($2, ip_address),
        username = $3,
        password = $4,
        model = COALESCE($5, model),
        mac_address = $6,
        client_id = $7,
        notes = $8,
        updated_at = now()
       WHERE id = $9 AND created_by = $10
       RETURNING *`,
      [name, ip_address, username || null, password || null, model, mac_address || null, client_id || null, notes || null, req.params.id, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/devices/:id([0-9a-fA-F-]{36})', async (req: Request, res: Response) => {
  try {
    const pool = getPool(req);
    const userId = (req as any).user?.id;
    const result = await pool.query(
      'DELETE FROM ubiquiti_devices WHERE id = $1 AND created_by = $2 RETURNING id',
      [req.params.id, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Device Status (Signal, Noise, CCQ) ────────
router.get('/devices/:id([0-9a-fA-F-]{36})/status', async (req: Request, res: Response) => {
  try {
    const pool = getPool(req);
    const userId = (req as any).user?.id;

    const device = await pool.query(
      'SELECT * FROM ubiquiti_devices WHERE id = $1 AND created_by = $2',
      [req.params.id, userId]
    );
    if (device.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });

    const dev = device.rows[0];
    let username = dev.username;
    let password = dev.password;

    // Fallback to global config
    if (!username || !password) {
      const global = await pool.query(
        'SELECT default_username, default_password FROM ubiquiti_global_config WHERE created_by = $1 LIMIT 1',
        [userId]
      );
      if (global.rows.length > 0) {
        username = username || global.rows[0].default_username;
        password = password || global.rows[0].default_password;
      }
    }

    if (!username || !password) {
      return res.status(400).json({ error: 'No hay credenciales configuradas (globales ni individuales)' });
    }

    const session = await airOsLogin(dev.ip_address, username, password);
    const status = await airOsRequest(dev.ip_address, '/status.cgi', session);

    // Extract relevant wireless info
    const wireless = status.wireless || {};
    const host = status.host || {};

    const signalData = {
      device_name: host.hostname || dev.name,
      firmware: host.fwversion || 'unknown',
      uptime: host.uptime || 'unknown',
      signal: wireless.signal || null,
      rssi: wireless.rssi || null,
      noise: wireless.noisef || wireless.noise || null,
      ccq: wireless.ccq || null,
      tx_rate: wireless.txrate || null,
      rx_rate: wireless.rxrate || null,
      frequency: wireless.frequency || null,
      channel_width: wireless.chwidth || null,
      distance: wireless.distance || null,
      tx_power: wireless.txpower || null,
      lan_speed: status.lan?.speed || null,
      cpu: host.cpuload || null,
      mem_total: host.totalmem || null,
      mem_free: host.freemem || null,
      temperature: host.temperature || null,
    };

    // Update last_seen and signal in DB
    await pool.query(
      `UPDATE ubiquiti_devices SET 
        last_signal = $1, last_noise = $2, last_ccq = $3, last_seen = now(), 
        model = COALESCE($4, model), updated_at = now()
       WHERE id = $5`,
      [
        signalData.signal,
        signalData.noise,
        signalData.ccq ? Math.round(signalData.ccq / 10) : null,
        host.hostname || null,
        req.params.id,
      ]
    );

    res.json(signalData);
  } catch (err: any) {
    res.status(500).json({ error: `No se pudo conectar al equipo: ${err.message}` });
  }
});

// ─── Reboot Device ─────────────────────────────
router.post('/devices/:id([0-9a-fA-F-]{36})/reboot', async (req: Request, res: Response) => {
  try {
    const pool = getPool(req);
    const userId = (req as any).user?.id;

    const device = await pool.query(
      'SELECT * FROM ubiquiti_devices WHERE id = $1 AND created_by = $2',
      [req.params.id, userId]
    );
    if (device.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });

    const dev = device.rows[0];
    let username = dev.username;
    let password = dev.password;

    if (!username || !password) {
      const global = await pool.query(
        'SELECT default_username, default_password FROM ubiquiti_global_config WHERE created_by = $1 LIMIT 1',
        [userId]
      );
      if (global.rows.length > 0) {
        username = username || global.rows[0].default_username;
        password = password || global.rows[0].default_password;
      }
    }

    if (!username || !password) {
      return res.status(400).json({ error: 'No hay credenciales configuradas' });
    }

    const session = await airOsLogin(dev.ip_address, username, password);
    const success = await airOsReboot(dev.ip_address, session);

    res.json({ success, message: success ? 'Equipo reiniciándose' : 'No se pudo reiniciar' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk Status (all devices at once) ─────────
router.get('/devices/status/all', async (req: Request, res: Response) => {
  try {
    const pool = getPool(req);
    const userId = (req as any).user?.id;

    const devices = await pool.query(
      'SELECT id, name, ip_address, username, password, last_signal, last_noise, last_ccq, last_seen FROM ubiquiti_devices WHERE created_by = $1',
      [userId]
    );

    const global = await pool.query(
      'SELECT default_username, default_password FROM ubiquiti_global_config WHERE created_by = $1 LIMIT 1',
      [userId]
    );
    const globalCreds = global.rows[0] || {};

    const results = await Promise.allSettled(
      devices.rows.map(async (dev: any) => {
        const user = dev.username || globalCreds.default_username;
        const pass = dev.password || globalCreds.default_password;
        if (!user || !pass) return { id: dev.id, name: dev.name, status: 'no_credentials' };

        try {
          const session = await airOsLogin(dev.ip_address, user, pass);
          const status = await airOsRequest(dev.ip_address, '/status.cgi', session);
          const w = status.wireless || {};
          const h = status.host || {};

          await pool.query(
            `UPDATE ubiquiti_devices SET last_signal = $1, last_noise = $2, last_ccq = $3, last_seen = now() WHERE id = $4`,
            [w.signal || null, w.noisef || w.noise || null, w.ccq ? Math.round(w.ccq / 10) : null, dev.id]
          );

          return {
            id: dev.id,
            name: dev.name,
            status: 'online',
            signal: w.signal,
            noise: w.noisef || w.noise,
            ccq: w.ccq ? Math.round(w.ccq / 10) : null,
            uptime: h.uptime,
            cpu: h.cpuload,
          };
        } catch {
          return { id: dev.id, name: dev.name, status: 'offline', last_signal: dev.last_signal, last_noise: dev.last_noise, last_ccq: dev.last_ccq, last_seen: dev.last_seen };
        }
      })
    );

    const data = results.map((r) => (r.status === 'fulfilled' ? r.value : { status: 'error' }));
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export const ubiquitiRouter = router;
