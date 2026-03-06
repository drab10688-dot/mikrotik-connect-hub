import { Router, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { pool } from '../lib/db';
import { getDeviceConfig, mikrotikRequest } from '../lib/mikrotik';

export const clientsRouter = Router();

// List clients
clientsRouter.get('/:mikrotikId([0-9a-fA-F-]{36})', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const isPotential = req.query.is_potential_client === 'true';

    const { rows } = await pool.query(
      `SELECT c.*, bs.monthly_amount, bs.is_suspended, bs.billing_day, bs.next_billing_date
       FROM isp_clients c
       LEFT JOIN client_billing_settings bs ON bs.client_id = c.id
       WHERE c.mikrotik_id = $1 AND c.is_potential_client = $2
       ORDER BY c.client_name`,
      [mikrotikId, isPotential]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single client by ID
clientsRouter.get('/detail/:clientId', async (req: AuthRequest, res: Response) => {
  try {
    const { clientId } = req.params;
    const { rows } = await pool.query(
      `SELECT c.*, bs.monthly_amount, bs.is_suspended, bs.billing_day, bs.next_billing_date
       FROM isp_clients c
       LEFT JOIN client_billing_settings bs ON bs.client_id = c.id
       WHERE c.id = $1`,
      [clientId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
clientsRouter.post('/register', async (req: AuthRequest, res: Response) => {
  try {
    const {
      mikrotik_id, use_simple_queues, username, password,
      plan, upload_speed, download_speed,
      client_name, identification_number, phone, email,
      telegram_chat_id, address, city, latitude, longitude,
      is_potential_client, comment, service_option, service_price,
      total_monthly_price, nap_box, nap_port
    } = req.body;

    if (!mikrotik_id) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const connectionType = use_simple_queues ? 'static' : 'pppoe';
    let remoteIP = '';
    let generatedPassword = password || Math.random().toString(36).slice(2, 10);
    let resultType = use_simple_queues ? 'queue' : 'pppoe';
    let mikrotikCreated = false;
    let mikrotikError = '';

    // Create on MikroTik if not potential client
    if (!is_potential_client) {
      try {
        const config = await getDeviceConfig(pool, mikrotik_id);
        const useTls = config.port === 443 || config.port === 8729;

        if (use_simple_queues) {
          const speed = `${upload_speed}/${download_speed}`;
          await mikrotikRequest({ ...config, useTls }, '/rest/queue/simple/add', 'POST', {
            name: username,
            target: '',
            'max-limit': speed,
            comment: client_name,
          });
        } else {
          // Auto-detect next available remote IP from existing PPP secrets
          try {
            const existingSecrets = await mikrotikRequest({ ...config, useTls }, '/rest/ppp/secret/print') as any[];
            const remoteIPs = (existingSecrets || [])
              .map((s: any) => s['remote-address'] || '')
              .filter((ip: string) => ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip));

            if (remoteIPs.length > 0) {
              // Find the highest last octet in the same subnet
              const parsed = remoteIPs.map((ip: string) => {
                const parts = ip.split('.').map(Number);
                return { prefix: parts.slice(0, 3).join('.'), last: parts[3] };
              });
              // Use the most common prefix (subnet)
              const prefixCounts: Record<string, number> = {};
              parsed.forEach((p: any) => { prefixCounts[p.prefix] = (prefixCounts[p.prefix] || 0) + 1; });
              const mostCommonPrefix = Object.entries(prefixCounts).sort((a, b) => b[1] - a[1])[0][0];
              
              const maxLast = parsed
                .filter((p: any) => p.prefix === mostCommonPrefix)
                .reduce((max: number, p: any) => Math.max(max, p.last), 0);
              
              const nextLast = maxLast + 1;
              if (nextLast <= 254) {
                remoteIP = `${mostCommonPrefix}.${nextLast}`;
              }
            }
          } catch (scanErr: any) {
            console.warn('Could not scan existing PPP secrets for IP assignment:', scanErr.message);
          }

          const secretPayload: any = {
            name: username,
            password: generatedPassword,
            service: 'pppoe',
            profile: plan || 'default',
            comment: client_name,
          };
          if (remoteIP) secretPayload['remote-address'] = remoteIP;

          await mikrotikRequest({ ...config, useTls }, '/rest/ppp/secret/add', 'POST', secretPayload);
        }
        mikrotikCreated = true;
      } catch (mkError: any) {
        console.error('MikroTik create error:', mkError.message);
        mikrotikError = mkError.message || 'Error desconocido al crear en MikroTik';
      }
    }

    // Save in database
    const { rows } = await pool.query(
      `INSERT INTO isp_clients (
        mikrotik_id, created_by, client_name, identification_number, username,
        connection_type, plan_or_speed, assigned_ip, phone, email, address,
        city, latitude, longitude, comment, service_option, service_price,
        total_monthly_price, telegram_chat_id, is_potential_client
      ) VALUES ($1,$2,$3,$4,$5,$6::connection_type,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING *`,
      [mikrotik_id, req.userId, client_name, identification_number, username,
       connectionType, plan || `${download_speed}/${upload_speed}`, remoteIP,
       phone, email, address, city, latitude, longitude, comment,
       service_option, service_price || 0, total_monthly_price || 0,
       telegram_chat_id, is_potential_client || false]
    );

    // Auto-create billing settings
    if (total_monthly_price && total_monthly_price > 0) {
      await pool.query(
        `INSERT INTO client_billing_settings (client_id, mikrotik_id, monthly_amount)
         VALUES ($1, $2, $3)`,
        [rows[0].id, mikrotik_id, total_monthly_price]
      );
    }

    // If MikroTik creation failed for a non-potential client, report it
    if (!is_potential_client && !mikrotikCreated) {
      return res.status(207).json({
        data: rows[0],
        type: resultType,
        clientName: client_name,
        username,
        password: generatedPassword,
        remoteIP,
        speed: `${download_speed}/${upload_speed}`,
        mikrotikCreated: false,
        mikrotikError,
        warning: `Cliente guardado en base de datos pero NO se pudo crear en MikroTik: ${mikrotikError}`,
      });
    }

    res.status(201).json({
      data: rows[0],
      type: resultType,
      clientName: client_name,
      username,
      password: generatedPassword,
      remoteIP,
      speed: `${download_speed}/${upload_speed}`,
      mikrotikCreated: is_potential_client ? null : true,
    });
  } catch (error: any) {
    console.error('Register client error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add client (direct DB insert)
clientsRouter.post('/:mikrotikId([0-9a-fA-F-]{36})', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const {
      client_name, identification_number, username, connection_type,
      plan_or_speed, assigned_ip, phone, email, address, city,
      latitude, longitude, comment, service_option, service_price,
      total_monthly_price
    } = req.body;

    // Normalize connection_type to valid enum
    const validTypes = ['pppoe', 'hotspot', 'static', 'dhcp'];
    const normalizedType = validTypes.includes(connection_type) ? connection_type : 'pppoe';

    const { rows } = await pool.query(
      `INSERT INTO isp_clients (
        mikrotik_id, created_by, client_name, identification_number, username,
        connection_type, plan_or_speed, assigned_ip, phone, email, address,
        city, latitude, longitude, comment, service_option, service_price,
        total_monthly_price
      ) VALUES ($1,$2,$3,$4,$5,$6::connection_type,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *`,
      [mikrotikId, req.userId, client_name, identification_number, username,
       normalizedType, plan_or_speed, assigned_ip, phone, email, address,
       city, latitude, longitude, comment, service_option, service_price || 0,
       total_monthly_price || 0]
    );

    // Auto-create billing settings
    if (total_monthly_price && total_monthly_price > 0) {
      await pool.query(
        `INSERT INTO client_billing_settings (client_id, mikrotik_id, monthly_amount)
         VALUES ($1, $2, $3)`,
        [rows[0].id, mikrotikId, total_monthly_price]
      );
    }

    res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update client
clientsRouter.put('/:mikrotikId([0-9a-fA-F-]{36})/:clientId([0-9a-fA-F-]{36})', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, clientId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const fields = req.body;
    const setClauses: string[] = [];
    const values: any[] = [];
    let i = 1;

    // Filter out mikrotik_id from update fields
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'mikrotik_id') continue;
      if (key === 'connection_type') {
        const validTypes = ['pppoe', 'hotspot', 'static', 'dhcp'];
        setClauses.push(`${key} = $${i}::connection_type`);
        values.push(validTypes.includes(value as string) ? value : 'pppoe');
      } else {
        setClauses.push(`${key} = $${i}`);
        values.push(value);
      }
      i++;
    }

    if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(clientId, mikrotikId);
    const { rows } = await pool.query(
      `UPDATE isp_clients SET ${setClauses.join(', ')} WHERE id = $${i} AND mikrotik_id = $${i + 1} RETURNING *`,
      values
    );

    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete client
clientsRouter.delete('/:mikrotikId([0-9a-fA-F-]{36})/:clientId([0-9a-fA-F-]{36})', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, clientId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    await pool.query('DELETE FROM isp_clients WHERE id = $1 AND mikrotik_id = $2', [clientId, mikrotikId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Search client by identification
clientsRouter.get('/search/identification/:identification', async (req: AuthRequest, res: Response) => {
  try {
    const { identification } = req.params;
    const { rows } = await pool.query(
      `SELECT c.*, bs.monthly_amount, bs.is_suspended, bs.billing_day
       FROM isp_clients c
       LEFT JOIN client_billing_settings bs ON bs.client_id = c.id
       WHERE c.identification_number = $1 AND c.is_potential_client = false`,
      [identification]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Scan MikroTik clients
clientsRouter.post('/scan', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id, scan_type } = req.body;
    if (!mikrotik_id) return res.status(400).json({ error: 'mikrotik_id requerido' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const normalizedScanType = scan_type === 'queue' ? 'queues' : scan_type;
    const config = await getDeviceConfig(pool, mikrotik_id);
    const useTls = config.port === 443 || config.port === 8729;

    let scannedClients: any[] = [];

    if (normalizedScanType === 'pppoe' || normalizedScanType === 'all') {
      try {
        const secrets = await mikrotikRequest({ ...config, useTls }, '/rest/ppp/secret/print') as any[];
        scannedClients.push(
          ...(secrets || []).map((s: any) => ({
            name: s.name,
            ip: s['remote-address'] || s['caller-id'] || '',
            type: 'pppoe',
            profile: s.profile || 'default',
            comment: s.comment || '',
            disabled: s.disabled === true || s.disabled === 'true',
          }))
        );
      } catch (e) { /* skip */ }
    }

    if (normalizedScanType === 'queues' || normalizedScanType === 'all') {
      try {
        const queues = await mikrotikRequest({ ...config, useTls }, '/rest/queue/simple/print') as any[];
        scannedClients.push(
          ...(queues || []).map((q: any) => ({
            name: q.name,
            ip: typeof q.target === 'string' ? q.target.split('/')[0] : '',
            type: 'queue',
            speed: q['max-limit'] || '',
            comment: q.comment || '',
            disabled: q.disabled === true || q.disabled === 'true',
          }))
        );
      } catch (e) { /* skip */ }
    }

    const uniqueScanned = Array.from(
      new Map(
        scannedClients
          .filter((client) => typeof client.name === 'string' && client.name.trim().length > 0)
          .map((client) => [`${client.type}-${client.name.toLowerCase()}`, client])
      ).values()
    );

    const { rows: registeredRows } = await pool.query(
      'SELECT username FROM isp_clients WHERE mikrotik_id = $1',
      [mikrotik_id]
    );

    const registeredUsernames = new Set(
      registeredRows
        .map((row: any) => String(row.username || '').toLowerCase())
        .filter(Boolean)
    );

    const unregistered = uniqueScanned.filter((client) => !registeredUsernames.has(client.name.toLowerCase()));

    res.json({
      total: uniqueScanned.length,
      registered: uniqueScanned.length - unregistered.length,
      unregistered,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Import clients from scan
clientsRouter.post('/import', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotik_id, clients } = req.body;
    if (!mikrotik_id || !clients?.length) return res.status(400).json({ error: 'mikrotik_id y clients requeridos' });

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotik_id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    let imported = 0;
    const errors: string[] = [];

    for (const client of clients) {
      try {
        const username = String(client.username || client.name || '').trim();
        if (!username) {
          errors.push('Cliente omitido: username vacío');
          continue;
        }

        const inferredType = client.type === 'queue' ? 'static' : 'pppoe';
        const connType = ['pppoe', 'hotspot', 'static', 'dhcp'].includes(client.connection_type)
          ? client.connection_type
          : inferredType;

        await pool.query(
          `INSERT INTO isp_clients (mikrotik_id, created_by, client_name, username, connection_type, plan_or_speed, assigned_ip, comment)
           VALUES ($1, $2, $3, $4, $5::connection_type, $6, $7, $8)
           ON CONFLICT DO NOTHING`,
          [
            mikrotik_id,
            req.userId,
            client.client_name || client.name || username,
            username,
            connType,
            client.plan_or_speed || client.profile || client.speed || '',
            client.assigned_ip || client.ip || '',
            client.comment || '',
          ]
        );

        imported++;
      } catch (e: any) {
        errors.push(e?.message || 'Error al importar cliente');
      }
    }

    res.json({ success: imported, total: clients.length, errors, imported });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
