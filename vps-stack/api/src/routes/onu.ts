import { Router, Response } from 'express';
import { AuthRequest, authMiddleware, verifyDeviceAccess } from '../middleware/auth';
import { mikrotikRequest, getDeviceConfig } from '../lib/mikrotik';
import { pool } from '../server';

export const onuRouter = Router();
onuRouter.use(authMiddleware);

// ─── Helper ──────────────────────────────────────────────
async function getVerifiedConfig(req: AuthRequest, res: Response) {
  const { mikrotikId } = req.params;
  const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
  if (!hasAccess) { res.status(403).json({ error: 'Sin acceso' }); return null; }
  return await getDeviceConfig(pool, mikrotikId);
}

// ─── List ONUs ───────────────────────────────────────────
onuRouter.get('/:mikrotikId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const result = await pool.query(
      `SELECT o.*, c.client_name, c.username as client_username, c.plan_or_speed
       FROM onu_devices o
       LEFT JOIN isp_clients c ON c.id = o.client_id
       WHERE o.mikrotik_id = $1
       ORDER BY o.created_at DESC`,
      [mikrotikId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get single ONU ─────────────────────────────────────
onuRouter.get('/:mikrotikId/:onuId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, onuId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const result = await pool.query(
      `SELECT o.*, c.client_name, c.username as client_username, c.plan_or_speed
       FROM onu_devices o
       LEFT JOIN isp_clients c ON c.id = o.client_id
       WHERE o.id = $1 AND o.mikrotik_id = $2`,
      [onuId, mikrotikId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'ONU no encontrada' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Create ONU ──────────────────────────────────────────
onuRouter.post('/:mikrotikId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const {
      client_id, serial_number, mac_address, brand, model,
      management_ip, olt_port, wifi_ssid, wifi_password,
      pppoe_username, pppoe_password, pppoe_profile, notes,
      auto_create_pppoe
    } = req.body;

    if (!serial_number || !brand) {
      return res.status(400).json({ error: 'serial_number y brand son requeridos' });
    }

    const result = await pool.query(
      `INSERT INTO onu_devices (
        mikrotik_id, client_id, created_by, serial_number, mac_address,
        brand, model, management_ip, olt_port, wifi_ssid, wifi_password,
        pppoe_username, pppoe_password, pppoe_profile, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        mikrotikId, client_id || null, req.userId, serial_number, mac_address || null,
        brand, model || null, management_ip || null, olt_port || null,
        wifi_ssid || null, wifi_password || null,
        pppoe_username || null, pppoe_password || null, pppoe_profile || null,
        notes || null
      ]
    );

    // Auto-create PPPoE secret in MikroTik if requested
    if (auto_create_pppoe && pppoe_username && pppoe_password && pppoe_profile) {
      try {
        const config = await getDeviceConfig(pool, mikrotikId);
        await mikrotikRequest(config, '/rest/ppp/secret/add', 'POST', {
          name: pppoe_username,
          password: pppoe_password,
          profile: pppoe_profile,
          service: 'pppoe',
          comment: `ONU: ${serial_number} - ${brand} ${model || ''}`
        });
        // Update ONU status
        await pool.query(
          `UPDATE onu_devices SET status = 'provisioned' WHERE id = $1`,
          [result.rows[0].id]
        );
        result.rows[0].status = 'provisioned';
      } catch (pppoeErr: any) {
        console.error('Error creating PPPoE:', pppoeErr.message);
        // ONU created but PPPoE failed - return warning
        return res.json({
          success: true,
          data: result.rows[0],
          warning: `ONU registrada pero falló crear PPPoE: ${pppoeErr.message}`
        });
      }
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update ONU ──────────────────────────────────────────
onuRouter.put('/:mikrotikId/:onuId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, onuId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const fields = [
      'client_id', 'serial_number', 'mac_address', 'brand', 'model',
      'management_ip', 'olt_port', 'wifi_ssid', 'wifi_password',
      'pppoe_username', 'pppoe_password', 'pppoe_profile', 'status', 'notes'
    ];
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        values.push(req.body[field]);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

    values.push(onuId, mikrotikId);
    const result = await pool.query(
      `UPDATE onu_devices SET ${updates.join(', ')} WHERE id = $${idx++} AND mikrotik_id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'ONU no encontrada' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete ONU ──────────────────────────────────────────
onuRouter.delete('/:mikrotikId/:onuId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, onuId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const result = await pool.query(
      'DELETE FROM onu_devices WHERE id = $1 AND mikrotik_id = $2 RETURNING id',
      [onuId, mikrotikId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'ONU no encontrada' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Change WiFi via MikroTik /tool/fetch proxy ─────────
onuRouter.post('/:mikrotikId/:onuId/wifi', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, onuId } = req.params;
    const { wifi_ssid, wifi_password } = req.body;

    if (!wifi_ssid && !wifi_password) {
      return res.status(400).json({ error: 'Debe enviar wifi_ssid o wifi_password' });
    }

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    // Get ONU data
    const onuResult = await pool.query(
      'SELECT * FROM onu_devices WHERE id = $1 AND mikrotik_id = $2',
      [onuId, mikrotikId]
    );
    if (onuResult.rows.length === 0) return res.status(404).json({ error: 'ONU no encontrada' });

    const onu = onuResult.rows[0];
    if (!onu.management_ip) {
      return res.status(400).json({ error: 'La ONU no tiene IP de gestión configurada' });
    }

    const config = await getDeviceConfig(pool, mikrotikId);

    // Use MikroTik /tool/fetch to reach ONU's web GUI
    // This creates a script on MikroTik that uses fetch to configure the ONU
    // The actual URL/params depend on brand
    const brand = (onu.brand || '').toLowerCase();
    let fetchUrl = '';
    let fetchData = '';

    if (brand === 'zte') {
      // ZTE F660/F670 typical WiFi config endpoint
      fetchUrl = `http://${onu.management_ip}/getpage.gch?pid=1002&nextpage=net_wlanm_ess498498.gch`;
      fetchData = `ESSID=${encodeURIComponent(wifi_ssid || onu.wifi_ssid)}&KeyPassphrase=${encodeURIComponent(wifi_password || onu.wifi_password)}`;
    } else if (brand === 'huawei') {
      // Huawei HG8xxx typical WiFi config
      fetchUrl = `http://${onu.management_ip}/api/system/deviceinfo`;
      fetchData = JSON.stringify({ ssid: wifi_ssid || onu.wifi_ssid, password: wifi_password || onu.wifi_password });
    } else {
      // Latic / Generic - store config for manual application
      // Update DB and return tech sheet
      await pool.query(
        `UPDATE onu_devices SET 
          wifi_ssid = COALESCE($1, wifi_ssid), 
          wifi_password = COALESCE($2, wifi_password) 
        WHERE id = $3`,
        [wifi_ssid || null, wifi_password || null, onuId]
      );
      return res.json({
        success: true,
        method: 'manual',
        message: 'Configuración WiFi actualizada en el sistema. Aplique manualmente en la ONU.',
        data: {
          management_ip: onu.management_ip,
          wifi_ssid: wifi_ssid || onu.wifi_ssid,
          wifi_password: wifi_password || onu.wifi_password,
          brand: onu.brand
        }
      });
    }

    // Try to apply via MikroTik /tool/fetch
    try {
      await mikrotikRequest(config, '/rest/tool/fetch', 'POST', {
        url: fetchUrl,
        mode: 'http',
        'http-method': 'post',
        'http-data': fetchData,
        'as-value': '',
        'output': 'none'
      });

      // Update DB
      await pool.query(
        `UPDATE onu_devices SET 
          wifi_ssid = COALESCE($1, wifi_ssid), 
          wifi_password = COALESCE($2, wifi_password) 
        WHERE id = $3`,
        [wifi_ssid || null, wifi_password || null, onuId]
      );

      res.json({
        success: true,
        method: 'remote',
        message: 'Comando enviado a la ONU via MikroTik. Verifique que se aplicó correctamente.'
      });
    } catch (fetchErr: any) {
      // Fallback: save to DB for manual config
      await pool.query(
        `UPDATE onu_devices SET 
          wifi_ssid = COALESCE($1, wifi_ssid), 
          wifi_password = COALESCE($2, wifi_password) 
        WHERE id = $3`,
        [wifi_ssid || null, wifi_password || null, onuId]
      );

      res.json({
        success: true,
        method: 'manual',
        message: `No se pudo alcanzar la ONU remotamente (${fetchErr.message}). Config guardada para aplicar manualmente.`,
        data: {
          management_ip: onu.management_ip,
          wifi_ssid: wifi_ssid || onu.wifi_ssid,
          wifi_password: wifi_password || onu.wifi_password
        }
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Config Templates CRUD ──────────────────────────────
onuRouter.get('/:mikrotikId/templates/list', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const result = await pool.query(
      `SELECT * FROM onu_config_templates 
       WHERE mikrotik_id = $1 OR mikrotik_id IS NULL
       ORDER BY brand, name`,
      [mikrotikId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

onuRouter.post('/:mikrotikId/templates', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { name, brand, template_content, file_format, description, is_default } = req.body;
    if (!name || !brand || !template_content) {
      return res.status(400).json({ error: 'name, brand y template_content son requeridos' });
    }

    const result = await pool.query(
      `INSERT INTO onu_config_templates (mikrotik_id, created_by, name, brand, template_content, file_format, description, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [mikrotikId, req.userId, name, brand, template_content, file_format || 'xml', description || null, is_default || false]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

onuRouter.delete('/:mikrotikId/templates/:templateId', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId, templateId } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    await pool.query('DELETE FROM onu_config_templates WHERE id = $1', [templateId]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
