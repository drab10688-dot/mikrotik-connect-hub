import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, mikrotikRequestWithFallback, getDeviceConfig } from '../lib/mikrotik';
import { pool } from '../lib/db';

export const antennasRouter = Router();

// ─── List all MikroTik devices (as antennas) ───
antennasRouter.get('/devices', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const role = req.userRole!;

    let result;
    if (role === 'super_admin') {
      result = await pool.query(
        `SELECT md.id, md.name, md.host, md.port, md.version, md.status,
                md.created_at
         FROM mikrotik_devices md
         ORDER BY md.name ASC`
      );
    } else {
      result = await pool.query(
        `SELECT md.id, md.name, md.host, md.port, md.version, md.status,
                md.created_at
         FROM mikrotik_devices md
         JOIN user_mikrotik_access uma ON uma.mikrotik_id = md.id AND uma.user_id = $1
         ORDER BY md.name ASC`,
        [userId]
      );
    }

    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get wireless registration table for a device ───
antennasRouter.get('/devices/:id([0-9a-fA-F-]{36})/wireless', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.params.id;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);

    // Get wireless registration table (connected clients/stations)
    let registrations: any[] = [];
    try {
      const { data } = await mikrotikRequestWithFallback(config, '/rest/interface/wireless/registration-table');
      registrations = Array.isArray(data) ? data : [];
    } catch {
      try {
        const data = await mikrotikRequest(config, '/rest/interface/wireless/registration-table');
        registrations = Array.isArray(data) ? data : [];
      } catch { /* no wireless interface */ }
    }

    // Get wireless interfaces info
    let interfaces: any[] = [];
    try {
      const { data } = await mikrotikRequestWithFallback(config, '/rest/interface/wireless');
      interfaces = Array.isArray(data) ? data : [];
    } catch {
      try {
        const data = await mikrotikRequest(config, '/rest/interface/wireless');
        interfaces = Array.isArray(data) ? data : [];
      } catch { /* ignore */ }
    }

    // Get system resource
    let systemResource: any = {};
    try {
      const { data } = await mikrotikRequestWithFallback(config, '/rest/system/resource');
      systemResource = Array.isArray(data) ? data[0] : data;
    } catch {
      try {
        const data = await mikrotikRequest(config, '/rest/system/resource');
        systemResource = Array.isArray(data) ? data[0] : data;
      } catch { /* ignore */ }
    }

    // Get system identity
    let identity = '';
    try {
      const { data } = await mikrotikRequestWithFallback(config, '/rest/system/identity');
      const idData = Array.isArray(data) ? data[0] : data;
      identity = idData?.name || '';
    } catch { /* ignore */ }

    // Parse registration data
    const clients = registrations.map((r: any) => ({
      mac_address: r['mac-address'] || r.mac_address || '',
      interface: r.interface || '',
      signal_strength: parseInt(r['signal-strength'] || r.signal_strength || '0'),
      signal_to_noise: parseInt(r['signal-to-noise'] || r.signal_to_noise || '0'),
      tx_signal_strength: parseInt(r['tx-signal-strength'] || r.tx_signal_strength || '0'),
      noise_floor: parseInt(r['noise-floor'] || r.noise_floor || '0'),
      tx_ccq: parseInt(r['tx-ccq'] || r.tx_ccq || '0'),
      rx_ccq: parseInt(r['rx-ccq'] || r.rx_ccq || '0'),
      tx_rate: r['tx-rate'] || r.tx_rate || '',
      rx_rate: r['rx-rate'] || r.rx_rate || '',
      uptime: r.uptime || '',
      last_ip: r['last-ip'] || r.last_ip || '',
      bytes: r.bytes || '',
      packets: r.packets || '',
      distance: parseInt(r.distance || '0'),
      tx_power: parseInt(r['tx-power'] || r.tx_power || '0'),
      radio_name: r['radio-name'] || r.radio_name || '',
    }));

    // Parse wireless interface info
    const wirelessInfo = interfaces.map((w: any) => ({
      name: w.name || '',
      mode: w.mode || '',
      ssid: w.ssid || '',
      band: w.band || '',
      frequency: w.frequency || '',
      channel_width: w['channel-width'] || w.channel_width || '',
      tx_power: w['tx-power'] || w.tx_power || '',
      noise_floor: parseInt(w['noise-floor'] || w.noise_floor || '0'),
      running: w.running === 'true' || w.running === true,
      disabled: w.disabled === 'true' || w.disabled === true,
    }));

    res.json({
      device_name: identity || config.host,
      host: config.host,
      uptime: systemResource.uptime || '',
      cpu_load: parseInt(systemResource['cpu-load'] || systemResource.cpu_load || '0'),
      free_memory: parseInt(systemResource['free-memory'] || systemResource.free_memory || '0'),
      total_memory: parseInt(systemResource['total-memory'] || systemResource.total_memory || '0'),
      board_name: systemResource['board-name'] || systemResource.board_name || '',
      version: systemResource.version || '',
      architecture: systemResource['architecture-name'] || systemResource.architecture_name || '',
      wireless_interfaces: wirelessInfo,
      clients,
    });
  } catch (err: any) {
    res.status(500).json({ error: `No se pudo conectar: ${err.message}` });
  }
});

// ─── Reboot a MikroTik device ───
antennasRouter.post('/devices/:id([0-9a-fA-F-]{36})/reboot', async (req: AuthRequest, res: Response) => {
  try {
    const mikrotikId = req.params.id;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const config = await getDeviceConfig(pool, mikrotikId);

    try {
      await mikrotikRequestWithFallback(config, '/system/reboot/print', 'POST');
    } catch {
      await mikrotikRequest(config, '/rest/system/reboot', 'POST');
    }

    res.json({ success: true, message: 'Equipo reiniciándose' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk wireless status for all devices ───
antennasRouter.get('/status/all', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const role = req.userRole!;

    let result;
    if (role === 'super_admin') {
      result = await pool.query('SELECT id, name, host, port, version FROM mikrotik_devices ORDER BY name');
    } else {
      result = await pool.query(
        `SELECT md.id, md.name, md.host, md.port, md.version
         FROM mikrotik_devices md
         JOIN user_mikrotik_access uma ON uma.mikrotik_id = md.id AND uma.user_id = $1
         ORDER BY md.name`,
        [userId]
      );
    }

    const statuses = await Promise.allSettled(
      result.rows.map(async (dev: any) => {
        try {
          const config = await getDeviceConfig(pool, dev.id);

          // Get registration table
          let registrations: any[] = [];
          try {
            const { data } = await mikrotikRequestWithFallback(config, '/interface/wireless/registration-table/print');
            registrations = Array.isArray(data) ? data : [];
          } catch { /* ignore */ }

          // Get system resource
          let sysRes: any = {};
          try {
            const { data } = await mikrotikRequestWithFallback(config, '/system/resource/print');
            sysRes = Array.isArray(data) ? data[0] : data;
          } catch { /* ignore */ }

          // Get identity
          let identity = dev.name;
          try {
            const { data } = await mikrotikRequestWithFallback(config, '/system/identity/print');
            const idData = Array.isArray(data) ? data[0] : data;
            identity = idData?.name || dev.name;
          } catch { /* ignore */ }

          // Aggregate signal from registrations
          const avgSignal = registrations.length > 0
            ? Math.round(registrations.reduce((sum: number, r: any) =>
              sum + parseInt(r['signal-strength'] || r.signal_strength || '0'), 0) / registrations.length)
            : null;

          const avgCcq = registrations.length > 0
            ? Math.round(registrations.reduce((sum: number, r: any) =>
              sum + parseInt(r['tx-ccq'] || r.tx_ccq || '0'), 0) / registrations.length)
            : null;

          const avgNoise = registrations.length > 0
            ? Math.round(registrations.reduce((sum: number, r: any) =>
              sum + parseInt(r['noise-floor'] || r.noise_floor || '0'), 0) / registrations.length)
            : null;

          return {
            id: dev.id,
            name: identity,
            host: dev.host,
            status: 'online',
            connected_clients: registrations.length,
            signal: avgSignal,
            noise: avgNoise,
            ccq: avgCcq,
            uptime: sysRes.uptime || '',
            cpu: parseInt(sysRes['cpu-load'] || sysRes.cpu_load || '0'),
            board: sysRes['board-name'] || sysRes.board_name || '',
            version: sysRes.version || dev.version,
          };
        } catch {
          return {
            id: dev.id,
            name: dev.name,
            host: dev.host,
            status: 'offline',
            connected_clients: 0,
            signal: null,
            noise: null,
            ccq: null,
          };
        }
      })
    );

    const data = statuses.map((r) => r.status === 'fulfilled' ? r.value : { status: 'error' });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
