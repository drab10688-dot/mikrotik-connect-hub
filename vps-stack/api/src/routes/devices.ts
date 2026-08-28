import { Router, Response } from 'express';
import { connect as netConnect } from 'net';
import { pool } from '../lib/db';
import { AuthRequest, verifyDeviceAccess, requireRole } from '../middleware/auth';
import { mikrotikRequest, mikrotikRequestWithFallback, testNativeApiLogin, isNativeApiPort } from '../lib/mikrotik';

export const devicesRouter = Router();

type ConnectionDiagnosticCode =
  | 'ok'
  | 'port_unreachable'
  | 'dns_error'
  | 'credentials_error'
  | 'rest_api_unavailable'
  | 'tls_error'
  | 'timeout'
  | 'unknown_error';

interface ConnectionDiagnostic {
  code: ConnectionDiagnosticCode;
  message: string;
  raw_error?: string;
}

const testTcpConnection = async (host: string, port: number, timeoutMs = 5000) => {
  return await new Promise<{ success: boolean; latencyMs?: number; error?: string; code?: string }>((resolve) => {
    const startedAt = Date.now();
    const socket = netConnect({ host, port });

    let settled = false;

    const finalize = (result: { success: boolean; latencyMs?: number; error?: string; code?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      finalize({ success: true, latencyMs: Date.now() - startedAt });
    });

    socket.on('timeout', () => {
      finalize({ success: false, error: `Timeout TCP al puerto ${port}`, code: 'ETIMEDOUT' });
    });

    socket.on('error', (error: NodeJS.ErrnoException) => {
      finalize({ success: false, error: error.message, code: error.code });
    });
  });
};

const classifyMikrotikError = (error: unknown): ConnectionDiagnostic => {
  const raw = error instanceof Error ? error.message : String(error || 'Error desconocido');
  const message = raw.toLowerCase();

  if (message.includes('401') || message.includes('403')) {
    return {
      code: 'credentials_error',
      message: 'Credenciales inválidas o usuario sin permisos de API en MikroTik.',
      raw_error: raw,
    };
  }

  if (message.includes('404')) {
    return {
      code: 'rest_api_unavailable',
      message: 'La API REST no está disponible en este router/puerto o la versión no la soporta.',
      raw_error: raw,
    };
  }

  if (message.includes('certificate') || message.includes('tls') || message.includes('ssl')) {
    return {
      code: 'tls_error',
      message: 'Error TLS/SSL: revisa certificados, puerto HTTPS y configuración segura del router.',
      raw_error: raw,
    };
  }

  if (message.includes('timeout') || message.includes('timed out')) {
    return {
      code: 'timeout',
      message: 'El router tardó demasiado en responder a la API.',
      raw_error: raw,
    };
  }

  return {
    code: 'unknown_error',
    message: 'No se pudo completar la validación de API con el router.',
    raw_error: raw,
  };
};


// List devices user has access to
devicesRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    let query: string;
    let params: string[];

    if (req.userRole === 'super_admin') {
      query = 'SELECT * FROM mikrotik_devices ORDER BY name';
      params = [];
    } else {
      query = `
        SELECT md.* FROM mikrotik_devices md
        INNER JOIN user_mikrotik_access uma ON uma.mikrotik_id = md.id
        WHERE uma.user_id = $1 AND md.status = 'active'::device_status
        UNION
        SELECT md.* FROM mikrotik_devices md
        INNER JOIN secretary_assignments sa ON sa.mikrotik_id = md.id
        WHERE sa.secretary_id = $1 AND md.status = 'active'::device_status
        UNION
        SELECT md.* FROM mikrotik_devices md
        INNER JOIN secretary_assignments sa ON sa.assigned_by = md.created_by
        WHERE sa.secretary_id = $1 AND sa.mikrotik_id IS NULL
          AND md.status = 'active'::device_status
        UNION
        SELECT md.* FROM mikrotik_devices md
        INNER JOIN reseller_assignments ra ON ra.mikrotik_id = md.id
        WHERE ra.reseller_id = $1 AND md.status = 'active'::device_status
        ORDER BY name`;
      params = [req.userId!];
    }

    const { rows } = await pool.query(query, params);

    // Aislamiento multi-ISP estricto: un usuario de un ISP solo ve equipos de
    // su ISP; los usuarios globales solo ven equipos sin ISP asignado.
    const isGlobalSuperAdmin = req.userRole === 'super_admin' && !req.tenantId;
    const filtered = isGlobalSuperAdmin
      ? rows
      : rows.filter((d: any) =>
          req.tenantId ? d.tenant_id === req.tenantId : !d.tenant_id
        );


    res.json({ data: filtered });

  } catch (error) {
    console.error('Error listing devices:', error);
    res.status(500).json({ error: 'Error al listar dispositivos' });
  }
});

// Test connection
devicesRouter.post('/:id/connect', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso a este dispositivo' });

    const { rows } = await pool.query('SELECT host, port, username, password FROM mikrotik_devices WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Dispositivo no encontrado' });

    const config = rows[0];
    const useTls = config.port === 443 || config.port === 8729;
    const data = await mikrotikRequest(
      { ...config, useTls },
      '/rest/system/resource'
    );

    res.json({ success: true, data });
  } catch (error: unknown) {
    const diagnostic = classifyMikrotikError(error);
    res.status(500).json({
      success: false,
      error: diagnostic.message,
      error_code: diagnostic.code,
      technical_error: diagnostic.raw_error,
    });
  }
});

// Diagnóstico detallado de conexión con fallback automático
devicesRouter.post('/:id/connect/diagnose', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso a este dispositivo' });

    const { rows } = await pool.query(
      'SELECT id, name, host, port, username, password, version FROM mikrotik_devices WHERE id = $1',
      [id]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Dispositivo no encontrado' });

    const device = rows[0];

    // Try TCP on configured port first, then fallback ports
    const portsToTry = [device.port];
    if (device.port !== 443) portsToTry.push(443);
    if (device.port !== 80) portsToTry.push(80);
    if (device.port !== 8728) portsToTry.push(8728);

    let tcpOk = false;
    let tcpLatency: number | null = null;
    let tcpPort = device.port;
    let tcpError = '';
    let tcpCode = '';

    for (const port of portsToTry) {
      const check = await testTcpConnection(device.host, port, 5000);
      if (check.success) {
        tcpOk = true;
        tcpLatency = check.latencyMs ?? null;
        tcpPort = port;
        break;
      }
      if (port === device.port) {
        tcpError = check.error || '';
        tcpCode = check.code || '';
      }
    }

    if (!tcpOk) {
      const code: ConnectionDiagnosticCode = tcpCode === 'ENOTFOUND' ? 'dns_error' : 'port_unreachable';
      return res.json({
        success: true,
        data: {
          connected: false,
          panel_api: { ok: true, message: 'Panel/API operativo' },
          device: { id: device.id, name: device.name, host: device.host, port: device.port, version: device.version },
          checks: {
            tcp: {
              ok: false, latency_ms: null, code,
              message: code === 'dns_error'
                ? `El host "${device.host}" no se resuelve. Verifica que esté bien escrito o usa la IP directa.`
                : `No se pudo conectar a ${device.host} en puertos ${portsToTry.join(', ')}. Verifica firewall, IP pública y que el router esté encendido.`,
              technical_error: tcpError,
              ports_tried: portsToTry,
            },
            credentials: { ok: null, message: 'No evaluado (falló conexión de red).' },
            rest_api: { ok: null, message: 'No evaluado (falló conexión de red).' },
          },
          recommendations: [
            'Verifica que la IP/dominio del router sea accesible desde este servidor',
            'Revisa que los puertos 443, 80 u 8728 estén abiertos en el firewall del router',
            'Si usas IP privada, asegúrate que el VPS está en la misma red o usa un túnel',
          ],
        },
      });
    }

    // TCP OK - now try API with fallback
    // First try REST API
    try {
      const result = await mikrotikRequestWithFallback(
        { host: device.host, username: device.username, password: device.password, port: tcpPort },
        '/rest/system/identity'
      );

      const portChanged = tcpPort !== device.port;

      return res.json({
        success: true,
        data: {
          connected: true,
          panel_api: { ok: true, message: 'Panel/API operativo' },
          device: { id: device.id, name: device.name, host: device.host, port: device.port, version: device.version },
          checks: {
            tcp: {
              ok: true, latency_ms: tcpLatency, code: 'ok',
              message: portChanged
                ? `Conectado en puerto ${tcpPort} (configurado: ${device.port}). Considera actualizar el puerto.`
                : `Puerto ${tcpPort} accesible (${tcpLatency}ms)`,
            },
            credentials: { ok: true, code: 'ok', message: 'Credenciales válidas' },
            rest_api: {
              ok: true, code: 'ok',
              message: `API REST respondiendo vía ${result.usedConfig.protocol.toUpperCase()}:${result.usedConfig.port}`,
              sample: result.data,
            },
          },
          recommendations: portChanged
            ? [`El router respondió en el puerto ${tcpPort}. Actualiza la configuración del dispositivo para usar este puerto.`]
            : [],
          suggested_port: portChanged ? tcpPort : undefined,
        },
      });
    } catch (restError: unknown) {
      // REST API failed - try native API if port suggests it
      const nativePort = isNativeApiPort(tcpPort) ? tcpPort : (isNativeApiPort(device.port) ? device.port : null);
      
      if (nativePort) {
        try {
          const nativeResult = await testNativeApiLogin(device.host, nativePort, device.username, device.password);
          
          if (nativeResult.success) {
            return res.json({
              success: true,
              data: {
                connected: true,
                panel_api: { ok: true, message: 'Panel/API operativo' },
                device: { id: device.id, name: device.name, host: device.host, port: device.port, version: device.version },
                checks: {
                  tcp: {
                    ok: true, latency_ms: tcpLatency, code: 'ok',
                    message: `Puerto ${nativePort} accesible (${tcpLatency}ms)`,
                  },
                  credentials: { ok: true, code: 'ok', message: 'Credenciales válidas (API nativa)' },
                  rest_api: {
                    ok: true, code: 'ok',
                    message: `API nativa MikroTik respondiendo en puerto ${nativePort} (modo v6)`,
                  },
                },
                recommendations: device.version !== 'v6'
                  ? ['Tu router usa API nativa. Cambia la versión del dispositivo a "v6" para mejor compatibilidad.']
                  : [],
              },
            });
          } else {
            // Native API connected but login failed
            return res.json({
              success: true,
              data: {
                connected: false,
                panel_api: { ok: true, message: 'Panel/API operativo' },
                device: { id: device.id, name: device.name, host: device.host, port: device.port, version: device.version },
                checks: {
                  tcp: {
                    ok: true, latency_ms: tcpLatency, code: 'ok',
                    message: `Puerto ${nativePort} accesible (${tcpLatency}ms)`,
                  },
                  credentials: {
                    ok: false, code: 'credentials_error',
                    message: nativeResult.error || 'Credenciales inválidas en API nativa',
                  },
                  rest_api: {
                    ok: null, code: 'not_applicable',
                    message: 'Router usa API nativa (no REST). Credenciales inválidas.',
                  },
                },
                recommendations: [
                  'Verifica usuario y contraseña en el router (Winbox → System → Users)',
                  'Asegúrate que el usuario tenga permisos de "api" y "read"',
                ],
              },
            });
          }
        } catch (nativeError: unknown) {
          // Native API also failed - fall through to generic error
        }
      }

      // Neither REST nor native API worked
      const diagnostic = classifyMikrotikError(restError);

      const recommendations: string[] = [];
      if (diagnostic.code === 'credentials_error') {
        recommendations.push('Verifica usuario y contraseña en el router (Winbox → System → Users)');
        recommendations.push('Asegúrate que el usuario tenga el grupo "full" o permisos de "api" y "read"');
      } else if (diagnostic.code === 'rest_api_unavailable') {
        recommendations.push('La API REST requiere RouterOS v7+. Verifica con: /system resource print');
        recommendations.push('Habilita el servicio www-ssl o www en: /ip service enable www-ssl');
        recommendations.push('Si usas RouterOS v6, configura el puerto API (8728) y versión "v6"');
      } else if (diagnostic.code === 'tls_error') {
        recommendations.push('El certificado TLS del router puede ser auto-firmado. Intenta con HTTP (puerto 80)');
      }

      return res.json({
        success: true,
        data: {
          connected: false,
          panel_api: { ok: true, message: 'Panel/API operativo' },
          device: { id: device.id, name: device.name, host: device.host, port: device.port, version: device.version },
          checks: {
            tcp: {
              ok: true, latency_ms: tcpLatency, code: 'ok',
              message: `Puerto ${tcpPort} accesible (${tcpLatency}ms)`,
            },
            credentials: {
              ok: diagnostic.code === 'credentials_error' ? false : null,
              code: diagnostic.code,
              message: diagnostic.code === 'credentials_error'
                ? diagnostic.message
                : 'No concluyente (ver diagnóstico de API).',
            },
            rest_api: {
              ok: false,
              code: diagnostic.code,
              message: diagnostic.message,
              technical_error: diagnostic.raw_error,
            },
          },
          recommendations,
        },
      });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add device (asistentes y resellers no pueden registrar dispositivos)
devicesRouter.post('/', requireRole('super_admin', 'admin', 'user'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, host, port, username, password, version, latitude, longitude, hotspot_url } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO mikrotik_devices (name, host, port, username, password, version, created_by, status, latitude, longitude, hotspot_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active'::device_status, $8, $9, $10) RETURNING *`,
      [name, host, port || 443, username, password, version || 'v7', req.userId, latitude || null, longitude || null, hotspot_url || null]
    );

    // Multi-ISP: hereda el ISP del usuario que lo crea (si aplica).
    if (req.tenantId) {
      try {
        await pool.query('UPDATE mikrotik_devices SET tenant_id = $1 WHERE id = $2', [req.tenantId, rows[0].id]);
        rows[0].tenant_id = req.tenantId;
      } catch {
        /* instalación sin columna tenant_id: se ignora */
      }
    }



    // Auto-assign access
    await pool.query(
      'INSERT INTO user_mikrotik_access (user_id, mikrotik_id, granted_by) VALUES ($1, $2, $1)',
      [req.userId, rows[0].id]
    );

    res.status(201).json({ data: rows[0] });
  } catch (error) {
    console.error('Error adding device:', error);
    res.status(500).json({ error: 'Error al agregar dispositivo' });
  }
});

// ─── User Device Access (Admin) ─────────────────
devicesRouter.get('/accesses', async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== 'super_admin') {
      return res.status(403).json({ error: 'Solo super_admin puede listar accesos' });
    }

    const { rows } = await pool.query(
      'SELECT id, user_id, mikrotik_id, granted_by, created_at FROM user_mikrotik_access ORDER BY created_at DESC'
    );

    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.post('/accesses', async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== 'super_admin') {
      return res.status(403).json({ error: 'Solo super_admin puede asignar accesos' });
    }

    const { user_id, mikrotik_id, granted_by } = req.body;
    if (!user_id || !mikrotik_id) {
      return res.status(400).json({ error: 'user_id y mikrotik_id son requeridos' });
    }

    const { rows } = await pool.query(
      `INSERT INTO user_mikrotik_access (user_id, mikrotik_id, granted_by)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [user_id, mikrotik_id, granted_by || req.userId]
    );

    res.status(201).json({ data: rows[0] || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.delete('/accesses/:accessId', async (req: AuthRequest, res: Response) => {
  try {
    if (req.userRole !== 'super_admin') {
      return res.status(403).json({ error: 'Solo super_admin puede remover accesos' });
    }

    const { accessId } = req.params;
    await pool.query('DELETE FROM user_mikrotik_access WHERE id = $1', [accessId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update device
devicesRouter.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const fields = req.body || {};
    const allowedFields = ['name', 'host', 'port', 'username', 'password', 'version', 'status', 'hotspot_url'];
    const setClauses: string[] = [];
    const values: any[] = [];
    let i = 1;

    for (const field of allowedFields) {
      if (fields[field] === undefined) continue;

      if (field === 'status') {
        const validStatuses = ['active', 'pending', 'rejected'];
        if (!validStatuses.includes(fields.status)) {
          return res.status(400).json({ error: 'Estado inválido' });
        }
        setClauses.push(`${field} = $${i}::device_status`);
      } else {
        setClauses.push(`${field} = $${i}`);
      }

      values.push(fields[field]);
      i++;
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE mikrotik_devices SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Dispositivo no encontrado' });
    }

    res.json({ data: rows[0] });
  } catch (error) {
    console.error('Error updating device:', error);
    res.status(500).json({ error: 'Error al actualizar dispositivo' });
  }
});

// Delete device
devicesRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (req.userRole !== 'super_admin') {
      return res.status(403).json({ error: 'Solo super_admin puede eliminar dispositivos' });
    }

    await pool.query('DELETE FROM mikrotik_devices WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).json({ error: 'Error al eliminar dispositivo' });
  }
});

// ─── Reseller Assignments ─────────────────────
devicesRouter.get('/:id/resellers', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `SELECT ra.*, u.email, u.full_name
       FROM reseller_assignments ra
       LEFT JOIN users u ON u.id = ra.reseller_id
       WHERE ra.mikrotik_id = $1`,
      [id]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.post('/:id/resellers', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reseller_id, commission_percentage } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO reseller_assignments (reseller_id, mikrotik_id, assigned_by, commission_percentage)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [reseller_id, id, req.userId, commission_percentage || 0]
    );
    res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.put('/resellers/:assignmentId', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { assignmentId } = req.params;
    const { commission_percentage } = req.body;
    const { rows } = await pool.query(
      'UPDATE reseller_assignments SET commission_percentage = $1 WHERE id = $2 RETURNING *',
      [commission_percentage, assignmentId]
    );
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.delete('/resellers/:assignmentId', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { assignmentId } = req.params;
    await pool.query('DELETE FROM reseller_assignments WHERE id = $1', [assignmentId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


// ─── Columnas de permisos de asistentes ───────────────────
// Instalaciones antiguas no tienen las columnas nuevas (RADIUS, ONU,
// Configuración, Diagnóstico). Se crean al vuelo y se cachea la lista real
// para no intentar escribir columnas inexistentes (eso rompía "Asignar").
const SECRETARY_PERM_COLUMNS = [
  'can_manage_pppoe','can_create_pppoe','can_edit_pppoe','can_delete_pppoe','can_disconnect_pppoe','can_toggle_pppoe',
  'can_manage_queues','can_create_queues','can_edit_queues','can_delete_queues','can_toggle_queues','can_suspend_queues','can_reactivate_queues',
  'can_manage_clients','can_create_clients','can_edit_clients','can_delete_clients',
  'can_manage_payments','can_record_payments','can_view_payment_history','can_reactivate_services',
  'can_manage_billing','can_create_invoices','can_edit_invoices','can_delete_invoices','can_send_invoices',
  'can_manage_reports','can_view_reports_dashboard','can_export_reports',
  'can_manage_hotspot','can_create_hotspot_users','can_edit_hotspot_users','can_delete_hotspot_users',
  'can_manage_vouchers','can_sell_vouchers','can_print_vouchers','can_view_hotspot_accounting','can_view_hotspot_reports',
  'can_manage_address_list','can_create_address_list','can_delete_address_list',
  'can_manage_backup','can_create_backup','can_restore_backup',
  'can_manage_vps_services','can_view_vps','can_manage_vps_docker',
  'can_manage_radius','can_manage_radius_users','can_view_radius_stats',
  'can_manage_onu','can_configure_onu_wifi','can_reboot_onu',
  'can_manage_settings','can_manage_diagnostics',
];

let permColumnsCache: Set<string> | null = null;

async function getSecretaryPermColumns(): Promise<Set<string>> {
  if (permColumnsCache) return permColumnsCache;

  for (const col of SECRETARY_PERM_COLUMNS) {
    try {
      await pool.query(
        `ALTER TABLE secretary_assignments ADD COLUMN IF NOT EXISTS ${col} BOOLEAN DEFAULT true`
      );
    } catch (error) {
      console.error(`⚠️ No se pudo crear la columna ${col}:`, error);
    }
  }

  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'secretary_assignments' AND column_name LIKE 'can\\_%'`
  );
  permColumnsCache = new Set(rows.map((r: any) => r.column_name));
  return permColumnsCache;
}

// ─── Secretary Assignments ────────────────────
devicesRouter.get('/my-secretary-assignments', async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT sa.*,
              md.id as "device_id", md.name as device_name, md.host, md.port, md.version, md.status as device_status,
              CASE WHEN md.id IS NULL THEN NULL ELSE json_build_object(
                'id', md.id, 'name', md.name, 'host', md.host,
                'port', md.port, 'version', md.version, 'status', md.status
              ) END as mikrotik_devices
       FROM secretary_assignments sa
       LEFT JOIN mikrotik_devices md ON md.id = sa.mikrotik_id
       WHERE sa.secretary_id = $1`,
      [req.userId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.get('/:id/secretaries', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const isSuper = req.userRole === 'super_admin';

    if (id === 'all') {
      const { rows } = await pool.query(
        isSuper
          ? `SELECT sa.*, u.email, u.full_name
             FROM secretary_assignments sa
             LEFT JOIN users u ON u.id = sa.secretary_id`
          : `SELECT sa.*, u.email, u.full_name
             FROM secretary_assignments sa
             LEFT JOIN users u ON u.id = sa.secretary_id
             WHERE sa.assigned_by = $1`,
        isSuper ? [] : [req.userId]
      );
      return res.json({ data: rows });
    }

    const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, id);
    if (!hasAccess) return res.status(403).json({ error: 'Sin acceso' });

    const { rows } = await pool.query(
      `SELECT sa.*, u.email, u.full_name
       FROM secretary_assignments sa
       LEFT JOIN users u ON u.id = sa.secretary_id
       WHERE sa.mikrotik_id = $1 OR (sa.mikrotik_id IS NULL AND sa.assigned_by = $2)`,
      [id, req.userId]
    );
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.post('/:id/secretaries', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { secretary_id, ...rest } = req.body || {};
    if (!secretary_id) return res.status(400).json({ error: 'secretary_id requerido' });

    // El usuario asignado debe tener rol de asistente (evita escalar privilegios)
    const { rows: roleRows } = await pool.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'secretary'::app_role LIMIT 1`,
      [secretary_id]
    );
    if (roleRows.length === 0) {
      return res.status(400).json({ error: 'El usuario seleccionado no tiene rol de asistente' });
    }

    const mikrotikId = !id || id === 'all' || id === 'null' ? null : id;

    if (mikrotikId) {
      const hasAccess = await verifyDeviceAccess(req.userId!, req.userRole!, mikrotikId);
      if (!hasAccess) return res.status(403).json({ error: 'Sin acceso a este dispositivo' });
    }

    const validColumns = await getSecretaryPermColumns();
    const permKeys = Object.keys(rest).filter(
      (k) => /^can_[a-z0-9_]+$/.test(k) && validColumns.has(k)
    );

    // Una asignación global (mikrotik_id NULL) no la deduplica el UNIQUE de
    // Postgres, así que se limpia antes para no crear filas repetidas.
    if (!mikrotikId) {
      await pool.query(
        'DELETE FROM secretary_assignments WHERE secretary_id = $1 AND mikrotik_id IS NULL',
        [secretary_id]
      );
    }

    const columns = ['secretary_id', 'mikrotik_id', 'assigned_by', ...permKeys];
    const values: any[] = [secretary_id, mikrotikId, req.userId, ...permKeys.map((k) => rest[k] === true)];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(',');
    const updates = permKeys.map((k) => `${k} = EXCLUDED.${k}`).join(', ');

    const { rows } = await pool.query(
      `INSERT INTO secretary_assignments (${columns.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT (secretary_id, mikrotik_id) DO UPDATE
         SET assigned_by = EXCLUDED.assigned_by${updates ? `, ${updates}` : ''}
       RETURNING *`,
      values
    );
    res.status(201).json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


devicesRouter.put('/secretaries/:assignmentId', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { assignmentId } = req.params;
    const fields = req.body;

    const { rows: owner } = await pool.query(
      'SELECT assigned_by FROM secretary_assignments WHERE id = $1',
      [assignmentId]
    );
    if (!owner[0]) return res.status(404).json({ error: 'Asignación no encontrada' });
    if (req.userRole !== 'super_admin' && owner[0].assigned_by !== req.userId) {
      return res.status(403).json({ error: 'No puedes modificar esta asignación' });
    }

    const validColumns = await getSecretaryPermColumns();
    const setClauses: string[] = [];
    const values: any[] = [];
    let i = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (/^can_[a-z0-9_]+$/.test(key) && validColumns.has(key)) {
        setClauses.push(`${key} = $${i}`);
        values.push(value === true);
        i++;
      }
    }

    if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(assignmentId);
    const { rows } = await pool.query(
      `UPDATE secretary_assignments SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    res.json({ data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

devicesRouter.delete('/secretaries/:assignmentId', requireRole('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { assignmentId } = req.params;
    const { rows: owner } = await pool.query(
      'SELECT assigned_by FROM secretary_assignments WHERE id = $1',
      [assignmentId]
    );
    if (!owner[0]) return res.json({ success: true });
    if (req.userRole !== 'super_admin' && owner[0].assigned_by !== req.userId) {
      return res.status(403).json({ error: 'No puedes eliminar esta asignación' });
    }
    await pool.query('DELETE FROM secretary_assignments WHERE id = $1', [assignmentId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

