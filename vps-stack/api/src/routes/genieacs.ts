import { Router, Response, NextFunction } from 'express';
import { AuthRequest, getAccessibleDeviceIds } from '../middleware/auth';
import { pool } from '../lib/db';
import { syncAcsOwnership, tenantAcsDeviceIds } from '../lib/acs-tenant';

import {
  ensureAcsSignalTables,
  collectAcsSignals,
  cleanupAcsSignals,
} from '../lib/acs-signal';

export const genieacsRouter = Router();

const GENIEACS_NBI = process.env.GENIEACS_NBI_URL || 'http://genieacs:7557';

// Auth opcional del NBI (si GenieACS se publica detrás de basic-auth).
function nbiAuthHeader(): Record<string, string> {
  const user = process.env.GENIEACS_NBI_USER;
  const pass = process.env.GENIEACS_NBI_PASSWORD;
  if (!user || !pass) return {};
  return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
}

// Cuando una tarea falla, GenieACS marca un "fault" en el canal del dispositivo
// y RETIENE todas las tareas siguientes hasta que expira el backoff (minutos).
// Ese es el motivo típico de "la orden tarda mucho en aplicarse" cuando la ONU
// sí está informando. Antes de encolar una orden nueva limpiamos faults y
// tareas viejas pendientes para que la sesión CWMP ejecute solo lo actual.
const backlogCleared = new Map<string, number>();

async function clearDeviceBacklog(deviceId: string) {
  const now = Date.now();
  const last = backlogCleared.get(deviceId) || 0;
  if (now - last < 15_000) return; // evita repetir en lotes de tareas / clics seguidos
  backlogCleared.set(deviceId, now);

  const q = encodeURIComponent(JSON.stringify({ device: deviceId }));
  try {
    // Las dos consultas van en paralelo: si no hay nada atascado el costo es
    // de un solo round-trip al NBI y la orden sale de inmediato.
    const [faults, tasks] = await Promise.all([
      genieFetch(`/faults/?query=${q}`).catch(() => []),
      genieFetch(`/tasks/?query=${q}`).catch(() => []),
    ]);

    const deletions: Promise<any>[] = [];

    for (const f of Array.isArray(faults) ? faults : []) {
      if (f?._id) {
        deletions.push(
          genieFetch(`/faults/${encodeURIComponent(f._id)}`, { method: 'DELETE' }).catch(() => {})
        );
      }
    }

    for (const t of Array.isArray(tasks) ? tasks : []) {
      // Solo se descartan tareas atascadas (con fault o antiguas), no las recién creadas.
      const ts = t?.timestamp ? new Date(t.timestamp).getTime() : 0;
      const stale = t?.fault || !ts || now - ts > 60_000;
      if (stale && t?._id) {
        deletions.push(
          genieFetch(`/tasks/${encodeURIComponent(t._id)}`, { method: 'DELETE' }).catch(() => {})
        );
      }
    }

    if (deletions.length) await Promise.all(deletions);
  } catch { /* ignorar */ }
}


// ─── Helper: fetch GenieACS NBI ──────────────────────────
async function genieFetch(path: string, options: RequestInit = {}): Promise<any> {
  const taskPost = String(options.method || 'GET').toUpperCase() === 'POST'
    && /^\/devices\/([^/]+)\/tasks/.test(path);
  if (taskPost) {
    const m = path.match(/^\/devices\/([^/]+)\/tasks/);
    if (m) await clearDeviceBacklog(decodeURIComponent(m[1]));
  }
  const res = await fetch(`${GENIEACS_NBI}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...nbiAuthHeader(),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GenieACS error (${res.status}): ${text}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json() as Promise<any>;
  }
  return res.text();
}

/**
 * Encola tareas independientes y dispara un único Connection Request al final.
 * GenieACS procesa todas las tareas pendientes en esa misma sesión CWMP. Esto
 * evita abrir una sesión nueva por cada parámetro, que algunas ONUs serializan
 * y terminan aplicando con varios segundos de diferencia.
 */
async function queueTasksWithSingleConnectionRequest(deviceId: string, tasks: any[]): Promise<any[]> {
  const results: any[] = [];
  const encodedId = encodeURIComponent(deviceId);
  for (let index = 0; index < tasks.length; index++) {
    const trigger = index === tasks.length - 1 ? '?connection_request' : '';
    results.push(await genieFetch(
      `/devices/${encodedId}/tasks${trigger}`,
      { method: 'POST', body: JSON.stringify(tasks[index]) }
    ));
  }
  return results;
}


// GenieACS NBI no soporta GET /devices/:id (devuelve 405). Se consulta por query.
async function fetchDevice(deviceId: string, projection?: string): Promise<any> {
  const q = encodeURIComponent(JSON.stringify({ _id: deviceId }));
  const proj = projection ? `&projection=${encodeURIComponent(projection)}` : '';
  const payload = await genieFetch(`/devices/?query=${q}${proj}`);
  const dev = Array.isArray(payload) ? payload[0] : payload;
  if (!dev) throw new Error('Dispositivo no encontrado en el ACS');
  return dev;
}

function asDevice(payload: any): any {
  return Array.isArray(payload) ? payload[0] : payload;
}

// Helper: extract parameter value from GenieACS device tree
function getParam(device: any, path: string): any {
  const parts = path.split('.');
  let current = device;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current?._value ?? current;
}

// Busca en profundidad el primer valor cuya clave coincida (para claves vendor X_...)
function deepFindValue(obj: any, keyMatch: RegExp, depth = 4): string | null {
  if (!obj || typeof obj !== 'object' || depth < 0) return null;
  for (const [k, v] of Object.entries<any>(obj)) {
    if (k.startsWith('_')) continue;
    if (keyMatch.test(k)) {
      const val = v?._value ?? (typeof v === 'string' ? v : null);
      if (val !== null && val !== undefined && String(val) !== '') return String(val);
    }
  }
  for (const [k, v] of Object.entries<any>(obj)) {
    if (k.startsWith('_') || !v || typeof v !== 'object') continue;
    const found = deepFindValue(v, keyMatch, depth - 1);
    if (found) return found;
  }
  return null;
}

// ─── Aislamiento multi-ISP para las ONUs del ACS ─────────
interface AcsScope {
  unrestricted: boolean;
  /** Toda cuenta asociada a un ISP opera siempre en modo estricto por token. */
  tokenRequired: boolean;
  ids: Set<string>;
  serials: Set<string>;
  usernames: Set<string>;
  /** ONUs que ya pertenecen a OTRO ISP: nunca se muestran aquí. */
  foreign: Set<string>;
  /** Tokens TR-069 del ISP actual (/tr069/<token>/): filtro autoritativo. */
  tokens: Set<string>;
  /** Todos los tokens TR-069 registrados en la plataforma (cualquier ISP). */
  knownTokens: Set<string>;
  /** ONUs ya reclamadas por token para este ISP (cuando no se conoce la URL). */
  tokenIds: Set<string>;
}

function tokenFromAcsUrl(url: string): string | null {
  const m = String(url || '').match(/\/tr069\/([a-f0-9]{8,64})/i);
  return m ? m[1].toLowerCase() : null;
}

function deviceAcsUrl(device: any): string {
  return (
    device?.InternetGatewayDevice?.ManagementServer?.URL?._value ||
    device?.Device?.ManagementServer?.URL?._value ||
    ''
  );
}

async function getAcsScope(req: AuthRequest): Promise<AcsScope> {
  const empty: AcsScope = {
    unrestricted: false,
    // El modo estricto por token solo aplica a cuentas ligadas a un ISP.
    // Una cuenta sin empresa (instalación de un solo ISP) no puede quedarse
    // sin ninguna ONU visible por no tener token asignado.
    tokenRequired: Boolean(req.tenantId),
    ids: new Set(),
    serials: new Set(),
    usernames: new Set(),
    foreign: new Set(),
    tokens: new Set(),
    knownTokens: new Set(),
    tokenIds: new Set(),
  };

  // Tokens de todos los ISPs: sirve para distinguir un token AJENO (se oculta)
  // de un token HUÉRFANO/antiguo que ya no pertenece a nadie (no debe ocultar
  // la ONU, o quedaría invisible en todo el sistema).
  try {
    const { rows } = await pool.query(
      `SELECT acs_token FROM tenants WHERE acs_token IS NOT NULL`
    );
    rows.forEach((r: any) => empty.knownTokens.add(String(r.acs_token).toLowerCase()));
  } catch { /* columna opcional */ }


  // El super_admin/admin sin empresa seleccionada ve todo el ACS (instalación
  // de un solo ISP); si opera dentro de una empresa, solo ve las suyas.
  if ((req.userRole === 'super_admin' || req.userRole === 'admin') && !req.tenantId) {
    return { ...empty, unrestricted: true };
  }


  const deviceIds = (await getAccessibleDeviceIds(req)) ?? [];

  // Propiedad automática de la ONU según el enlace TR-069 / red del ISP
  if (req.tenantId) {
    try {
      await syncAcsOwnership();
      const ids = await tenantAcsDeviceIds(req.tenantId);
      ids.forEach((id) => empty.ids.add(id));
    } catch { /* ACS no disponible: se sigue con lo registrado en la BD */ }

    // ONUs reclamadas por otras empresas: se excluyen siempre, aunque el
    // serial o el usuario PPPoE coincidan por casualidad.
    try {
      const { rows } = await pool.query(
        `SELECT acs_device_id FROM acs_device_owners WHERE tenant_id <> $1`,
        [req.tenantId]
      );
      rows.forEach((r: any) => {
        const id = String(r.acs_device_id);
        if (!empty.ids.has(id)) empty.foreign.add(id);
      });
    } catch { /* tabla opcional */ }

    // Enlace TR-069 propio del ISP: el token de su URL es el filtro principal.
    try {
      const { rows } = await pool.query(
        `SELECT acs_token FROM tenants WHERE id = $1 AND acs_token IS NOT NULL`,
        [req.tenantId]
      );
      rows.forEach((r: any) => empty.tokens.add(String(r.acs_token).toLowerCase()));
    } catch { /* columna opcional */ }

    // ONUs ya reclamadas por token para este ISP (para endpoints que no
    // exponen la URL de gestión, p. ej. históricos de señal).
    try {
      const { rows } = await pool.query(
        `SELECT acs_device_id FROM acs_device_owners
          WHERE tenant_id = $1 AND source = 'token'`,
        [req.tenantId]
      );
      rows.forEach((r: any) => empty.tokenIds.add(String(r.acs_device_id)));
    } catch { /* tabla opcional */ }

    // ONUs registradas manualmente al ISP
    try {
      const { rows } = await pool.query(
        `SELECT acs_device_id, serial_number, pppoe_username
           FROM onu_devices WHERE tenant_id = $1`,
        [req.tenantId]
      );
      rows.forEach((r: any) => {
        if (r.acs_device_id) empty.ids.add(String(r.acs_device_id));
        if (r.serial_number) empty.serials.add(String(r.serial_number).toUpperCase());
        if (r.pppoe_username) empty.usernames.add(String(r.pppoe_username).toLowerCase());
      });
    } catch { /* columna/tabla opcional */ }
  }


  if (!deviceIds.length) return empty;

  try {
    const { rows } = await pool.query(
      `SELECT acs_device_id, serial_number FROM onu_devices WHERE mikrotik_id = ANY($1::uuid[])`,
      [deviceIds]
    );
    rows.forEach((r: any) => {
      if (r.acs_device_id) empty.ids.add(String(r.acs_device_id));
      if (r.serial_number) empty.serials.add(String(r.serial_number).toUpperCase());
    });
  } catch { /* tabla opcional */ }

  try {
    const { rows } = await pool.query(
      `SELECT username FROM isp_clients WHERE mikrotik_id = ANY($1::uuid[]) AND username IS NOT NULL`,
      [deviceIds]
    );
    rows.forEach((r: any) => empty.usernames.add(String(r.username).toLowerCase()));
  } catch { /* tabla opcional */ }

  return empty;
}

/** ONU registrada manualmente en el ISP (p. ej. acceso independiente vía VPN). */
function matchesManualClaim(
  scope: AcsScope,
  info: { deviceId?: string | null; serial?: string | null; pppoe?: string | null }
): boolean {
  const id = String(info.deviceId || '');
  if (id && scope.foreign.has(id)) return false;
  if (id && scope.ids.has(id)) return true;
  const upperId = id.toUpperCase();
  const infoSerial = String(info.serial || '').toUpperCase();
  for (const serial of scope.serials) {
    if (!serial) continue;
    if (infoSerial && infoSerial === serial) return true;
    // El serial forma parte del _id del ACS (OUI-Modelo-Serial); se exige un
    // serial suficientemente largo para no cruzar equipos de otras empresas.
    if (serial.length >= 6 && upperId.includes(serial)) return true;
  }
  const user = String(info.pppoe || '').toLowerCase();
  if (user && scope.usernames.has(user)) return true;
  return false;
}

function acsAllows(
  scope: AcsScope,
  info: { deviceId?: string | null; serial?: string | null; pppoe?: string | null; acsUrl?: string | null }
): boolean {
  if (scope.unrestricted) return true;
  // Filtro autoritativo: si la ONU informa por un enlace /tr069/<token>/,
  // solo la ve el ISP dueño de ese token. Token de otro ISP => nunca se muestra.
  const urlToken = tokenFromAcsUrl(String(info.acsUrl || ''));
  const id = String(info.deviceId || '');
  if (urlToken) {
    if (scope.tokens.has(urlToken)) return true;
    // El ISP aún no tiene token propio configurado: no se puede filtrar por
    // token, se cae al reclamo manual en vez de ocultar todo.
    if (!scope.tokens.size) return matchesManualClaim(scope, info);
    return false;
  }
  // Sin token en la URL (IP pública base o acceso independiente por VPN):
  // solo se ve si el ISP la reclamó por token antes o la registró manualmente.
  if (id && scope.tokenIds.has(id)) return true;
  return matchesManualClaim(scope, info);

}


async function isAcsDeviceAllowed(req: AuthRequest, deviceId: string): Promise<boolean> {
  const scope = await getAcsScope(req);
  if (scope.unrestricted) return true;
  // En modo por token nunca autorizar solo con la propiedad cacheada: la ONU
  // puede haber cambiado su URL desde la última sincronización. Se comprueba
  // siempre el ManagementServer.URL actual antes de permitir leer o modificar.
  if (!scope.tokenRequired && acsAllows(scope, { deviceId })) return true;
  try {
    const device = await fetchDevice(deviceId, 'InternetGatewayDevice.DeviceInfo.SerialNumber,InternetGatewayDevice.WANDevice,InternetGatewayDevice.ManagementServer.URL,Device.ManagementServer.URL,_deviceId');
    const serial =
      getParam(device, 'InternetGatewayDevice.DeviceInfo.SerialNumber') ||
      device?._deviceId?._SerialNumber ||
      null;
    return acsAllows(scope, { deviceId, serial, pppoe: firstPppoeUsername(device), acsUrl: deviceAcsUrl(device) });
  } catch {
    return false;
  }
}

// Bloquea el acceso a ONUs que no pertenecen al ISP del usuario
async function guardAcsDevice(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const deviceId = req.params.deviceId;
    if (!deviceId) return next();
    const allowed = await isAcsDeviceAllowed(req, deviceId);
    if (!allowed) return res.status(403).json({ error: 'Sin acceso a esta ONU' });
    return next();
  } catch {
    return res.status(403).json({ error: 'Sin acceso a esta ONU' });
  }
}

// ─── Monitor en vivo: ¿está llegando señal (Inform) de las ONUs? ──────
genieacsRouter.get('/inform-monitor', async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getAcsScope(req);
    let acsOnline = true;
    let devices: any[] = [];
    try {
      const projection = '_id,_lastInform,_deviceId,InternetGatewayDevice.DeviceInfo.SerialNumber,InternetGatewayDevice.ManagementServer.URL,Device.ManagementServer.URL';
      const data = await genieFetch(`/devices/?projection=${encodeURIComponent(projection)}`);
      devices = Array.isArray(data) ? data : [];
    } catch {
      acsOnline = false;
    }

    const now = Date.now();
    const list = devices.map((d: any) => {
      const acsUrl = deviceAcsUrl(d);
      const lastInform = d?._lastInform || null;
      const t = lastInform ? new Date(lastInform).getTime() : NaN;
      const serial =
        getParam(d, 'InternetGatewayDevice.DeviceInfo.SerialNumber') ||
        d?._deviceId?._SerialNumber ||
        String(d?._id || '').split('-').slice(2).join('-') ||
        '-';
      return {
        deviceId: d?._id,
        serial: String(serial),
        manufacturer: d?._deviceId?._Manufacturer || null,
        model: d?._deviceId?._ProductClass || null,
        lastInform,
        secondsAgo: Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null,
        urlToken: tokenFromAcsUrl(acsUrl),
        visible: scope.unrestricted || acsAllows(scope, { deviceId: d?._id, serial, acsUrl }),
      };
    }).sort((a, b) => (a.secondsAgo ?? 1e12) - (b.secondsAgo ?? 1e12));

    const mine = list.filter((d) => d.visible);
    res.json({
      success: true,
      acsOnline,
      tokens: [...scope.tokens],
      unrestricted: scope.unrestricted,
      totals: {
        acs: list.length,
        visible: mine.length,
        informing5m: mine.filter((d) => d.secondsAgo !== null && d.secondsAgo <= 300).length,
        otherIsp: list.length - mine.length,
      },
      // Se listan también las que llegan al ACS pero no son de este ISP,
      // sin datos sensibles, para saber si el enlace TR-069 está mal.
      devices: (scope.unrestricted ? list : mine).slice(0, 100),
      unclaimed: scope.unrestricted
        ? []
        : list
            .filter((d) => !d.visible && d.secondsAgo !== null && d.secondsAgo <= 900)
            .slice(0, 20)
            .map((d) => ({ serial: d.serial, secondsAgo: d.secondsAgo, urlToken: d.urlToken })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ─── Diagnóstico de visibilidad de ONUs (por qué no aparecen) ─────────
genieacsRouter.get('/scope-debug', async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getAcsScope(req);
    let devices: any[] = [];
    try {
      const projection = '_id,InternetGatewayDevice.ManagementServer.URL,Device.ManagementServer.URL';
      devices = await genieFetch(`/devices/?projection=${encodeURIComponent(projection)}`);
    } catch { devices = []; }
    const list = Array.isArray(devices) ? devices : [];
    res.json({
      user: { id: req.userId, role: req.userRole, tenantId: req.tenantId ?? null },
      scope: {
        unrestricted: scope.unrestricted,
        tokenRequired: scope.tokenRequired,
        tokens: [...scope.tokens],
        claimedByToken: scope.tokenIds.size,
        manualIds: scope.ids.size,
        serials: scope.serials.size,
        foreign: scope.foreign.size,
      },
      acsTotal: list.length,
      devices: list.slice(0, 50).map((d: any) => {
        const acsUrl = deviceAcsUrl(d);
        return {
          id: d?._id,
          acsUrl,
          urlToken: tokenFromAcsUrl(acsUrl),
          visible: acsAllows(scope, { deviceId: d?._id, acsUrl }),
        };
      }),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health check ─────────────────────────────────────────

genieacsRouter.get('/health', async (req: AuthRequest, res: Response) => {
  try {
    await genieFetch('/devices/?projection=_id&limit=1');
    res.json({ success: true, status: 'online', message: 'GenieACS está funcionando' });
  } catch (err: any) {
    res.json({ success: false, status: 'offline', message: err.message });
  }
});

// ─── List all devices (CPEs) ─────────────────────────────
genieacsRouter.get('/devices', async (req: AuthRequest, res: Response) => {
  try {
    const query = (req.query.query as string) || '';
    const scope = await getAcsScope(req);
    let projection = (req.query.projection as string) || '_id,_deviceId,_lastInform';
    // El filtro por enlace TR-069 necesita la URL del ACS de cada ONU.
    if (!scope.unrestricted && projection && !projection.includes('ManagementServer.URL')) {
      projection += ',InternetGatewayDevice.ManagementServer.URL,Device.ManagementServer.URL';
    }
    const params: string[] = [];
    // Una proyección vacía hace que el NBI devuelva error/lista vacía: se omite.
    if (projection) params.push(`projection=${encodeURIComponent(projection)}`);
    if (query) params.push(`query=${encodeURIComponent(query)}`);
    const url = `/devices/${params.length ? `?${params.join('&')}` : ''}`;
    let data: any;
    try {
      data = await genieFetch(url);
    } catch {
      // Fallback: al menos devolver identificadores e info básica
       data = await genieFetch('/devices/?projection=_id');
    }
    const list = Array.isArray(data) ? data : [];
    const visible = scope.unrestricted
      ? list
      : list.filter((d: any) =>
          acsAllows(scope, {
            deviceId: d?._id,
            serial: d?._deviceId?._SerialNumber,
            pppoe: firstPppoeUsername(d),
            acsUrl: deviceAcsUrl(d),
          })
        );
    res.json({ success: true, data: visible });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// Todas las rutas por ONU pasan por el guard multi-ISP
genieacsRouter.use('/devices/:deviceId', guardAcsDevice);

// ─── Get single device (full tree) ──────────────────────
genieacsRouter.get('/devices/:deviceId', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const data = await fetchDevice(deviceId);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get device monitoring data (optical signal, CPU, temp, uptime, wan status) ──
genieacsRouter.get('/devices/:deviceId/monitor', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const device = await fetchDevice(deviceId);

    const igd = device?.InternetGatewayDevice || device?.Device || {};
    const di = igd?.DeviceInfo || {};
    const wan = igd?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANPPPConnection?.['1'] || 
                igd?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANIPConnection?.['1'] || {};
    const wlan = igd?.LANDevice?.['1']?.WLANConfiguration || {};
    const optical = igd?.WANDevice?.['1']?.WANCommonInterfaceConfig || {};

    // Extract optical power from common TR-069 paths (multi-vendor)
    // Latic / Generic GPON
    const rxPower = getParam(device, 'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower') 
      ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.GponInterfaceConfig.RXPower')
      // ZTE
      ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.RXPower')
      ?? getParam(device, 'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig.RXPower')
      // Huawei
      ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig.RXPower')
      ?? getParam(device, 'InternetGatewayDevice.X_HW_PONInfo.RXPower')
      // China Telecom / Generic
      ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower')
      // TR-181 (Device:2)
      ?? getParam(device, 'Device.Optical.Interface.1.Stats.SignalStrength')
      ?? getParam(device, 'Device.Optical.Interface.1.RxPower')
      // Zyxel
      ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZYXEL_GponInterfaceConfig.RXPower')
      ?? null;

    const txPower = getParam(device, 'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.TXPower')
      ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.GponInterfaceConfig.TXPower')
      // ZTE
      ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.TXPower')
      ?? getParam(device, 'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig.TXPower')
      // Huawei
      ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig.TXPower')
      ?? getParam(device, 'InternetGatewayDevice.X_HW_PONInfo.TXPower')
      // China Telecom / Generic
      ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.TXPower')
      // TR-181 (Device:2)
      ?? getParam(device, 'Device.Optical.Interface.1.Stats.TransmitPower')
      ?? getParam(device, 'Device.Optical.Interface.1.TxPower')
      // Zyxel
      ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZYXEL_GponInterfaceConfig.TXPower')
      ?? null;

    // CPU and memory
    const cpuUsage = getParam(device, 'InternetGatewayDevice.DeviceInfo.X_CPU_Usage')
      ?? getParam(device, 'Device.DeviceInfo.ProcessStatus.CPUUsage')
      ?? null;
    const memoryUsage = getParam(device, 'InternetGatewayDevice.DeviceInfo.X_Memory_Usage')
      ?? getParam(device, 'Device.DeviceInfo.MemoryStatus.Free')
      ?? null;
    const temperature = getParam(device, 'InternetGatewayDevice.DeviceInfo.X_Temperature')
      ?? getParam(device, 'Device.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value')
      ?? null;

    // WiFi clients
    const wifiClients: any[] = [];
    for (const key of Object.keys(wlan)) {
      const wc = wlan[key];
      if (wc?.AssociatedDevice) {
        for (const ck of Object.keys(wc.AssociatedDevice)) {
          const client = wc.AssociatedDevice[ck];
          wifiClients.push({
            mac: client?.MACAddress?._value || '-',
            signal: client?.SignalStrength?._value || null,
            active: client?.Active?._value ?? true,
          });
        }
      }
    }

    const monitor = {
      uptime: di?.UpTime?._value || null,
      manufacturer: di?.Manufacturer?._value || 'Desconocido',
      model: di?.ModelName?._value || di?.ProductClass?._value || '-',
      serial: di?.SerialNumber?._value || '-',
      softwareVersion: di?.SoftwareVersion?._value || '-',
      hardwareVersion: di?.HardwareVersion?._value || '-',
      rxPower,
      txPower,
      cpuUsage,
      memoryUsage,
      temperature,
      wanStatus: wan?.ConnectionStatus?._value || wan?.Status?._value || 'Unknown',
      wanIP: wan?.ExternalIPAddress?._value || '-',
      wanUptime: wan?.Uptime?._value || null,
      wifiClients,
      wifiSSID: wlan?.['1']?.SSID?._value || '-',
      wifiEnabled: wlan?.['1']?.Enable?._value ?? null,
      lastInformTime: device?._lastInform || null,
    };

    res.json({ success: true, data: monitor });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// WPA/WPA2 exige clave de 8 a 63 caracteres ASCII imprimibles. Si se envía
// una más corta, la ONU responde 9007 "Invalid parameter value" y GenieACS
// bloquea la cola de tareas del dispositivo.
function wifiPasswordError(password: string): string | null {
  if (typeof password !== 'string') return 'Contraseña WiFi inválida';
  if (password.length < 8 || password.length > 63) {
    return 'La contraseña WiFi debe tener entre 8 y 63 caracteres (requisito WPA2)';
  }
  if (!/^[\x20-\x7E]+$/.test(password)) {
    return 'La contraseña WiFi solo admite caracteres ASCII imprimibles (sin tildes ni ñ)';
  }
  return null;
}

// ─── Set WiFi parameters (SSID + Password) ──────────────
genieacsRouter.post('/devices/:deviceId/wifi', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { ssid, password, band } = req.body;

    if (!ssid && !password) {
      return res.status(400).json({ error: 'Debe enviar ssid o password' });
    }
    if (password) {
      const pwErr = wifiPasswordError(password);
      if (pwErr) return res.status(400).json({ error: pwErr });
    }

    const wlanIndex = band === '5g' ? '2' : '1';
    const basePath = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlanIndex}`;
    const parameterValues: [string, string, string][] = [];

    if (ssid) parameterValues.push([`${basePath}.SSID`, ssid, 'xsd:string']);
    if (password) {
      parameterValues.push(
        [`${basePath}.PreSharedKey.1.PreSharedKey`, password, 'xsd:string'],
        [`${basePath}.KeyPassphrase`, password, 'xsd:string'],
      );
    }

    const task = { name: 'setParameterValues', parameterValues };
    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );

    res.json({ success: true, message: 'Tarea de cambio WiFi enviada', data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Enable/disable WiFi interface ──────────────────────
genieacsRouter.post('/devices/:deviceId/wifi-toggle', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { band, enable } = req.body;

    const wlanIndex = band === '5g' ? '2' : '1';
    const task = {
      name: 'setParameterValues',
      parameterValues: [
        [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlanIndex}.Enable`, enable, 'xsd:boolean'],
      ],
    };

    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );

    res.json({ success: true, message: `WiFi ${band || '2.4G'} ${enable ? 'habilitado' : 'deshabilitado'}`, data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Set WiFi channel and bandwidth ─────────────────────
genieacsRouter.post('/devices/:deviceId/wifi-channel', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { band, channel, bandwidth } = req.body;

    const wlanIndex = band === '5g' ? '2' : '1';
    const basePath = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlanIndex}`;
    const parameterValues: [string, string, string][] = [];

    if (channel !== undefined) parameterValues.push([`${basePath}.Channel`, String(channel), 'xsd:unsignedInt']);
    if (bandwidth) parameterValues.push([`${basePath}.OperatingChannelBandwidth`, bandwidth, 'xsd:string']);

    const task = { name: 'setParameterValues', parameterValues };
    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );

    res.json({ success: true, message: 'Canal WiFi actualizado', data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Leer PPPoE actual de la ONU ────────────────────────
genieacsRouter.get('/devices/:deviceId/pppoe', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const device = await fetchDevice(deviceId);
    const igd = device?.InternetGatewayDevice || device?.Device || {};
    const wanDevices = igd?.WANDevice || {};
    const connections: any[] = [];

    for (const wdKey of Object.keys(wanDevices)) {
      if (wdKey.startsWith('_')) continue;
      const wcds = wanDevices[wdKey]?.WANConnectionDevice || {};
      for (const wcdKey of Object.keys(wcds)) {
        if (wcdKey.startsWith('_')) continue;
        const ppps = wcds[wcdKey]?.WANPPPConnection || {};
        for (const pKey of Object.keys(ppps)) {
          if (pKey.startsWith('_')) continue;
          const c = ppps[pKey] || {};
          connections.push({
            path: `InternetGatewayDevice.WANDevice.${wdKey}.WANConnectionDevice.${wcdKey}.WANPPPConnection.${pKey}`,
            username: c?.Username?._value ?? null,
            password: c?.Password?._value ?? deepFindValue(c, /(Password|Passphrase|Key)$/i, 2) ?? null,
            status: c?.ConnectionStatus?._value ?? null,
            ip: c?.ExternalIPAddress?._value ?? null,
            enable: c?.Enable?._value ?? null,
          });
        }
      }
    }

    res.json({ success: true, data: connections });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Refrescar árbol WAN/PPPoE desde la ONU ─────────────
genieacsRouter.post('/devices/:deviceId/refresh-pppoe', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'refreshObject',
          objectName: 'InternetGatewayDevice.WANDevice',
        }),
      }
    );
    res.json({ success: true, message: 'Leyendo configuración WAN/PPPoE de la ONU', data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Configure PPPoE ────────────────────────────────────
genieacsRouter.post('/devices/:deviceId/pppoe', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { username, password, path } = req.body;

    // Detectamos la ruta real de la conexión PPPoE: muchas ONUs no usan
    // WANDevice.1/WANConnectionDevice.1 y GenieACS devuelve fault 9003.
    let basePath: string | undefined = typeof path === 'string' && path ? path : undefined;
    let device: any = null;
    try { device = await fetchDevice(deviceId); } catch { /* sin validación */ }

    if (!basePath && device) {
      const wanDevices = device?.InternetGatewayDevice?.WANDevice || {};
      outer:
      for (const wdKey of Object.keys(wanDevices)) {
        if (wdKey.startsWith('_')) continue;
        const wcds = wanDevices[wdKey]?.WANConnectionDevice || {};
        for (const wcdKey of Object.keys(wcds)) {
          if (wcdKey.startsWith('_')) continue;
          const ppps = wcds[wcdKey]?.WANPPPConnection || {};
          for (const pKey of Object.keys(ppps)) {
            if (pKey.startsWith('_')) continue;
            basePath = `InternetGatewayDevice.WANDevice.${wdKey}.WANConnectionDevice.${wcdKey}.WANPPPConnection.${pKey}`;
            break outer;
          }
        }
      }
    }
    if (!basePath) basePath = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';

    const parameterValues: [string, string, string][] = [];
    if (username) parameterValues.push([`${basePath}.Username`, username, 'xsd:string']);
    if (password) parameterValues.push([`${basePath}.Password`, password, 'xsd:string']);
    if (parameterValues.length === 0) {
      return res.status(400).json({ error: 'No hay cambios que enviar' });
    }

    // Se conservan tareas independientes, pero todas viajan en una sola sesión.
    const results = await queueTasksWithSingleConnectionRequest(
      deviceId,
      parameterValues.map((pv) => ({ name: 'setParameterValues', parameterValues: [pv] }))
    );

    res.json({
      success: true,
      message: 'Configuración PPPoE enviada',
      path: basePath,
      data: results,
      skipped: [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ─── Configure DNS, MTU, VLAN ───────────────────────────
genieacsRouter.post('/devices/:deviceId/network', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { dns1, dns2, mtu, vlanId } = req.body;

    const wanBase = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
    const parameterValues: [string, string, string][] = [];

    if (dns1) parameterValues.push([`${wanBase}.DNSServers`, dns2 ? `${dns1},${dns2}` : dns1, 'xsd:string']);
    if (mtu) parameterValues.push([`${wanBase}.MaxMRUSize`, String(mtu), 'xsd:unsignedInt']);
    if (vlanId !== undefined) {
      parameterValues.push([
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_VLAN_ID',
        String(vlanId), 'xsd:unsignedInt'
      ]);
    }

    const task = { name: 'setParameterValues', parameterValues };
    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );

    res.json({ success: true, message: 'Configuración de red enviada', data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Reboot device ──────────────────────────────────────
genieacsRouter.post('/devices/:deviceId/reboot', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify({ name: 'reboot' }) }
    );
    res.json({ success: true, message: 'Comando de reinicio enviado', data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Factory reset ──────────────────────────────────────
genieacsRouter.post('/devices/:deviceId/factory-reset', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify({ name: 'factoryReset' }) }
    );
    res.json({ success: true, message: 'Factory reset enviado', data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Refresh device parameters ──────────────────────────
genieacsRouter.post('/devices/:deviceId/refresh', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { parameterPath } = req.body;
    // refreshObject evita faults "Invalid parameter path" en ONUs que no exponen
    // todo el árbol (getParameterValues sobre un nodo parcial suele fallar).
    const task = {
      name: 'refreshObject',
      objectName: parameterPath || 'InternetGatewayDevice',
    };

    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );
    res.json({ success: true, message: 'Solicitud de actualización enviada', data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Firmware download (OTA upgrade) ────────────────────
genieacsRouter.post('/devices/:deviceId/firmware', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { fileName } = req.body;

    const task = {
      name: 'download',
      file: fileName,
      fileType: '1 Firmware Upgrade Image',
    };
    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );
    res.json({ success: true, message: 'Actualización de firmware enviada', data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk firmware upgrade (multiple devices) ───────────
genieacsRouter.post('/firmware/bulk', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceIds, fileName } = req.body;
    const results: any[] = [];

    for (const deviceId of deviceIds) {
      try {
        const task = { name: 'download', file: fileName, fileType: '1 Firmware Upgrade Image' };
        const result = await genieFetch(
          `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
          { method: 'POST', body: JSON.stringify(task) }
        );
        results.push({ deviceId, success: true, data: result });
      } catch (err: any) {
        results.push({ deviceId, success: false, error: err.message });
      }
    }

    res.json({ success: true, message: `Firmware enviado a ${results.filter(r => r.success).length}/${deviceIds.length} dispositivos`, data: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Config backup (download from device) ───────────────
genieacsRouter.post('/devices/:deviceId/config-backup', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const task = {
      name: 'upload',
      fileType: '1 Vendor Configuration File',
    };
    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );
    res.json({ success: true, message: 'Backup de configuración solicitado', data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Config restore (push config to device) ─────────────
genieacsRouter.post('/devices/:deviceId/config-restore', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { fileName } = req.body;
    const task = {
      name: 'download',
      file: fileName,
      fileType: '3 Vendor Configuration File',
    };
    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );
    res.json({ success: true, message: 'Restauración de config enviada', data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── List files in GenieACS ─────────────────────────────
genieacsRouter.get('/files', async (req: AuthRequest, res: Response) => {
  try {
    const data = await genieFetch('/files/');
    const files = Array.isArray(data) ? data.map((f: any) => ({
      id: f._id,
      metadata: f.metadata || {},
      length: f.length || 0,
      uploadDate: f.uploadDate,
      filename: f.filename || f._id,
    })) : [];
    res.json({ success: true, data: files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Upload config file to GenieACS ─────────────────────
genieacsRouter.post('/files/upload', async (req: AuthRequest, res: Response) => {
  try {
    const { fileName, fileType, oui, productClass, version, content } = req.body;

    if (!fileName || !content) {
      return res.status(400).json({ error: 'fileName y content son requeridos' });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'fileType': fileType || '3 Vendor Configuration File',
    };
    if (oui) headers['oui'] = oui;
    if (productClass) headers['productClass'] = productClass;
    if (version) headers['version'] = version || '1.0';

    const resp = await fetch(`${GENIEACS_NBI}/files/${encodeURIComponent(fileName)}`, {
      method: 'PUT',
      headers,
      body: content,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`GenieACS upload error (${resp.status}): ${text}`);
    }

    res.json({ success: true, message: `Archivo "${fileName}" subido a GenieACS` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete file from GenieACS ──────────────────────────
genieacsRouter.delete('/files/:fileId', async (req: AuthRequest, res: Response) => {
  try {
    const { fileId } = req.params;
    const resp = await fetch(`${GENIEACS_NBI}/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    });
    if (!resp.ok) throw new Error(`Error eliminando archivo: ${resp.status}`);
    res.json({ success: true, message: 'Archivo eliminado de GenieACS' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Push config file to ONU via TR-069 download task ───
genieacsRouter.post('/devices/:deviceId/push-config', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { fileName } = req.body;

    if (!fileName) {
      return res.status(400).json({ error: 'fileName es requerido' });
    }

    const task = {
      name: 'download',
      file: fileName,
      fileType: '3 Vendor Configuration File',
    };

    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );

    res.json({
      success: true,
      message: `Configuración "${fileName}" enviada a la ONU. El dispositivo aplicará la config en su próxima conexión.`,
      data: result,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk push config to multiple ONUs ──────────────────
genieacsRouter.post('/push-config/bulk', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceIds, fileName } = req.body;
    if (!fileName || !deviceIds?.length) {
      return res.status(400).json({ error: 'fileName y deviceIds son requeridos' });
    }

    const results: any[] = [];
    for (const deviceId of deviceIds) {
      try {
        const task = { name: 'download', file: fileName, fileType: '3 Vendor Configuration File' };
        const result = await genieFetch(
          `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
          { method: 'POST', body: JSON.stringify(task) }
        );
        results.push({ deviceId, success: true, data: result });
      } catch (err: any) {
        results.push({ deviceId, success: false, error: err.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
      success: true,
      message: `Config enviada a ${successCount}/${deviceIds.length} ONUs`,
      data: results,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Run diagnostics (Ping/Traceroute from device) ──────
genieacsRouter.post('/devices/:deviceId/diagnostics', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { type, host } = req.body; // type: 'ping' | 'traceroute'

    const parameterValues: [string, string, string][] = [];

    if (type === 'ping') {
      parameterValues.push(
        ['InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState', 'Requested', 'xsd:string'],
        ['InternetGatewayDevice.IPPingDiagnostics.Host', host, 'xsd:string'],
        ['InternetGatewayDevice.IPPingDiagnostics.NumberOfRepetitions', '4', 'xsd:unsignedInt'],
        ['InternetGatewayDevice.IPPingDiagnostics.Timeout', '5000', 'xsd:unsignedInt'],
      );
    } else if (type === 'traceroute') {
      parameterValues.push(
        ['InternetGatewayDevice.TraceRouteDiagnostics.DiagnosticsState', 'Requested', 'xsd:string'],
        ['InternetGatewayDevice.TraceRouteDiagnostics.Host', host, 'xsd:string'],
        ['InternetGatewayDevice.TraceRouteDiagnostics.MaxHopCount', '30', 'xsd:unsignedInt'],
        ['InternetGatewayDevice.TraceRouteDiagnostics.Timeout', '5000', 'xsd:unsignedInt'],
      );
    } else {
      return res.status(400).json({ error: 'Tipo de diagnóstico inválido. Use ping o traceroute' });
    }

    const task = { name: 'setParameterValues', parameterValues };
    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );

    res.json({ success: true, message: `Diagnóstico ${type} iniciado`, data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get diagnostics results ────────────────────────────
genieacsRouter.get('/devices/:deviceId/diagnostics/:type', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId, type } = req.params;
    const device = await fetchDevice(deviceId);

    const igd = device?.InternetGatewayDevice || device?.Device || {};
    let result: any = {};

    if (type === 'ping') {
      const ping = igd?.IPPingDiagnostics || {};
      result = {
        state: ping?.DiagnosticsState?._value || 'None',
        host: ping?.Host?._value || '-',
        successCount: ping?.SuccessCount?._value || 0,
        failureCount: ping?.FailureCount?._value || 0,
        avgResponseTime: ping?.AverageResponseTime?._value || 0,
        minResponseTime: ping?.MinimumResponseTime?._value || 0,
        maxResponseTime: ping?.MaximumResponseTime?._value || 0,
      };
    } else if (type === 'traceroute') {
      const tr = igd?.TraceRouteDiagnostics || {};
      const hops: any[] = [];
      if (tr?.RouteHops) {
        for (const key of Object.keys(tr.RouteHops)) {
          const hop = tr.RouteHops[key];
          hops.push({
            hopNumber: parseInt(key),
            host: hop?.HopHost?._value || '-',
            address: hop?.HopHostAddress?._value || '-',
            rtt: hop?.HopRTTimes?._value || 0,
          });
        }
      }
      result = {
        state: tr?.DiagnosticsState?._value || 'None',
        host: tr?.Host?._value || '-',
        hops,
      };
    }

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Limpiar faults acumulados de un dispositivo ─────────
async function clearFaults(deviceId: string) {
  try {
    await genieFetch(`/faults/${encodeURIComponent(deviceId)}:default`, { method: 'DELETE' });
  } catch { /* sin faults */ }
  try {
    const tasks = await genieFetch(`/tasks/?query=${encodeURIComponent(JSON.stringify({ device: deviceId, fault: { $exists: true } }))}`);
    if (Array.isArray(tasks)) {
      for (const t of tasks) {
        if (t?._id) {
          try { await genieFetch(`/tasks/${encodeURIComponent(t._id)}`, { method: 'DELETE' }); } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore */ }
}

genieacsRouter.delete('/devices/:deviceId/faults', async (req: AuthRequest, res: Response) => {
  try {
    await clearFaults(req.params.deviceId);
    res.json({ success: true, message: 'Faults eliminados' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Force refresh optical signal parameters via refreshObject ──
genieacsRouter.post('/devices/:deviceId/refresh-signal', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;

    // Candidatos por fabricante: SOLO se piden los que existen en el árbol del equipo,
    // pedir rutas inexistentes genera faults "Invalid parameter path" en GenieACS.
    const candidates = [
      'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig',
      'InternetGatewayDevice.WANDevice.1.GponInterfaceConfig',
      'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_GponInterfaceConfig',
      'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig',
      'InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig',
      'InternetGatewayDevice.X_HW_PONInfo',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig',
      'InternetGatewayDevice.WANDevice.1.X_ZYXEL_GponInterfaceConfig',
      'Device.Optical.Interface.1',
    ];

    // Limpiar faults previos para que las tareas nuevas no queden bloqueadas
    await clearFaults(deviceId);

    let existing: string[] = [];
    try {
      const payload = await genieFetch(
        `/devices/?query=${encodeURIComponent(JSON.stringify({ _id: deviceId }))}&projection=${encodeURIComponent(candidates.join(','))}`
      );
      const device = asDevice(payload) || {};
      existing = candidates.filter((p) => {
        const parts = p.split('.');
        let cur: any = device;
        for (const part of parts) {
          if (!cur || typeof cur !== 'object') return false;
          cur = cur[part];
        }
        return cur !== undefined;
      });
    } catch { /* si falla la consulta, usamos el fallback */ }

    // Siempre se refresca el árbol WAN (donde vive la PON en cualquier vendor)
    // y las radios WiFi, para que la UI muestre señal y SSID activos.
    const targets = Array.from(new Set([
      ...existing,
      'InternetGatewayDevice.WANDevice',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration',
    ]));


    const results: any[] = [];
    for (const objectName of targets) {
      try {
        const r = await genieFetch(
          `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
          { method: 'POST', body: JSON.stringify({ name: 'refreshObject', objectName }) }
        );
        results.push({ objectName, ok: true, r });
      } catch (e: any) {
        results.push({ objectName, ok: false, error: e.message });
      }
    }

    res.json({
      success: true,
      message: existing.length
        ? 'Solicitud de lectura de señal óptica enviada'
        : 'No se detectaron parámetros ópticos; se refrescó el árbol WAN',
      data: results,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ─── Overview rápido: una sola consulta al ACS (lista + señal + PPPoE) ──
// Proyección amplia: se traen subárboles completos para soportar cualquier
// fabricante (Realtek, V-SOL, Zyxel, Huawei, ZTE, C-Data…) sin rutas fijas.
function informInterval(device: any): number | null {
  const v = getParam(device, 'InternetGatewayDevice.ManagementServer.PeriodicInformInterval')
    ?? getParam(device, 'Device.ManagementServer.PeriodicInformInterval');
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const FAST_PROJECTION = [
  '_id', '_deviceId', '_lastInform',
  'InternetGatewayDevice.DeviceInfo',
  'InternetGatewayDevice.ManagementServer.PeriodicInformInterval',
  'InternetGatewayDevice.ManagementServer.URL',
  'Device.ManagementServer.URL',
  'InternetGatewayDevice.WANDevice',
  'InternetGatewayDevice.LANDevice.1.WLANConfiguration',
  'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig',
  'InternetGatewayDevice.X_HW_PONInfo',
  'Device.DeviceInfo',
  'Device.ManagementServer.PeriodicInformInterval',
  'Device.Optical',
  'Device.WiFi',
].join(',');


function sanitizePower(val: any): number | null {
  let num = typeof val === 'number' ? val : (val != null && val !== '' ? parseFloat(String(val)) : NaN);
  if (!Number.isFinite(num)) return null;
  // Valores centinela de ONUs sin lectura óptica (p.ej. -2147483648, 65535)
  if (num >= 65535 || num === -2147483648) return null;
  // Muchos vendors reportan en unidades de 0.01 dBm (ej: -2245 = -22.45 dBm)
  if (num < -100 && num > -100000) num = num / 100;
  // Unidades de 0.0001 mW → convertir a dBm
  if (num > 100) num = 10 * Math.log10(num / 10000);
  if (num <= -90 || num > 20) return null;
  return Math.round(num);
}

function firstPppoeUsername(device: any): string | null {
  const wanDevices = device?.InternetGatewayDevice?.WANDevice || {};
  for (const wdKey of Object.keys(wanDevices)) {
    if (wdKey.startsWith('_')) continue;
    const wcds = wanDevices[wdKey]?.WANConnectionDevice || {};
    for (const wcdKey of Object.keys(wcds)) {
      if (wcdKey.startsWith('_')) continue;
      const ppps = wcds[wcdKey]?.WANPPPConnection || {};
      for (const pKey of Object.keys(ppps)) {
        if (pKey.startsWith('_')) continue;
        const u = ppps[pKey]?.Username?._value;
        if (u) return String(u);
      }
    }
  }
  return null;
}

// Busca en profundidad cualquier parámetro óptico sin depender del fabricante.
function deepFindPower(obj: any, keyMatch: RegExp, depth = 8): any {
  if (!obj || typeof obj !== 'object' || depth < 0) return undefined;
  for (const [k, v] of Object.entries<any>(obj)) {
    if (k.startsWith('_')) continue;
    if (keyMatch.test(k)) {
      const val = v?._value ?? (typeof v === 'number' || typeof v === 'string' ? v : undefined);
      if (val !== undefined && val !== null && String(val) !== '') {
        const num = sanitizePower(val);
        if (num !== null) return num;
      }
    }
  }
  for (const [k, v] of Object.entries<any>(obj)) {
    if (k.startsWith('_') || !v || typeof v !== 'object') continue;
    const found = deepFindPower(v, keyMatch, depth - 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

const RX_KEY = /^(rx_?power|rxpower|rxopticalpower|receivepower|opticalrxpower|signalstrength|rxlevel)$/i;
const TX_KEY = /^(tx_?power|txpower|txopticalpower|transmitpower|opticaltxpower|txlevel)$/i;

export interface RadioInfo {
  index: string;
  ssid: string | null;
  enabled: boolean;
  channel: number | null;
  band: '2.4GHz' | '5GHz';
  password: string | null;
}

// Resumen de radios WiFi (cuál SSID está activo y en qué banda).
function wifiRadios(device: any): RadioInfo[] {
  const wlan =
    device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration || {};
  const radios: RadioInfo[] = [];
  for (const key of Object.keys(wlan)) {
    if (key.startsWith('_')) continue;
    const r = wlan[key] || {};
    const ssid = r?.SSID?._value ?? null;
    const enabledRaw = r?.Enable?._value;
    const channel = Number(r?.Channel?._value);
    const standard = String(r?.Standard?._value || r?.X_BandType?._value || '');
    const freqBand = String(r?.OperatingFrequencyBand?._value || '');
    const is5 =
      /5/.test(freqBand) ||
      /a$|ac|ax/i.test(standard) && Number.isFinite(channel) && channel > 14 ||
      (Number.isFinite(channel) && channel > 14);
    const password =
      r?.KeyPassphrase?._value ??
      r?.PreSharedKey?.['1']?.KeyPassphrase?._value ??
      r?.PreSharedKey?.['1']?.PreSharedKey?._value ??
      null;
    if (ssid === null && enabledRaw === undefined) continue;
    radios.push({
      index: key,
      ssid: ssid !== null ? String(ssid) : null,
      enabled: enabledRaw === true || String(enabledRaw) === 'true' || String(enabledRaw) === '1',
      channel: Number.isFinite(channel) ? channel : null,
      band: is5 ? '5GHz' : '2.4GHz',
      password: password !== null ? String(password) : null,
    });
  }
  return radios;
}


genieacsRouter.get('/overview', async (req: AuthRequest, res: Response) => {
  try {
    const devices: any[] = (await genieFetch(`/devices/?projection=${encodeURIComponent(FAST_PROJECTION)}`)) || [];

    let aliases: Record<string, string> = {};
    try {
      const { rows } = await pool.query('SELECT device_id, name FROM onu_aliases');
      rows.forEach((r: any) => { aliases[r.device_id] = r.name; });
    } catch { /* tabla opcional */ }

    const data = devices.map((device: any) => {
      const igd = device?.InternetGatewayDevice || device?.Device || {};
      const di = igd?.DeviceInfo || {};
      const idParts = String(device?._id || '').split('-');
      const meta = device?._deviceId || {};

      const rx = sanitizePower(
        getParam(device, 'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.GponInterfaceConfig.RXPower')
        ?? getParam(device, 'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig.RXPower')
        ?? getParam(device, 'InternetGatewayDevice.X_HW_PONInfo.RXPower')
        ?? getParam(device, 'Device.Optical.Interface.1.Stats.SignalStrength')
      ) ?? deepFindPower(device, RX_KEY) ?? null;

      const tx = sanitizePower(
        getParam(device, 'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.TXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.GponInterfaceConfig.TXPower')
        ?? getParam(device, 'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig.TXPower')
        ?? getParam(device, 'InternetGatewayDevice.X_HW_PONInfo.TXPower')
        ?? getParam(device, 'Device.Optical.Interface.1.Stats.TransmitPower')
      ) ?? deepFindPower(device, TX_KEY) ?? null;

      const radios = wifiRadios(device);

      return {
        deviceId: device._id,
        manufacturer: di?.Manufacturer?._value || meta?._Manufacturer || idParts[0] || 'ONU',
        model: di?.ModelName?._value || di?.ProductClass?._value || meta?._ProductClass || idParts[1] || '-',
        serial: di?.SerialNumber?._value || meta?._SerialNumber || (idParts.length >= 3 ? idParts.slice(2).join('-') : '-'),
        rxPower: rx,
        txPower: tx,
        radios,
        activeSsids: radios.filter((r) => r.enabled && r.ssid).map((r) => `${r.ssid} (${r.band})`),
        pppoeUsername: firstPppoeUsername(device),
        alias: aliases[device._id] || null,
        lastInform: device?._lastInform || null,
        informInterval: informInterval(device),
        acsUrl: deviceAcsUrl(device),
      };

    });

    const scope = await getAcsScope(req);
    const visible = (scope.unrestricted
      ? data
      : data.filter((d: any) =>
          acsAllows(scope, { deviceId: d.deviceId, serial: d.serial, pppoe: d.pppoeUsername, acsUrl: d.acsUrl })
        )
    ).map(({ acsUrl, ...rest }: any) => rest);

    res.json({ success: true, data: visible });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk signal overview for all devices ───────────────
genieacsRouter.get('/signal-overview', async (req: AuthRequest, res: Response) => {
  try {
    const devices = await genieFetch('/devices/?projection=_id,_deviceId,InternetGatewayDevice.WANDevice,InternetGatewayDevice.DeviceInfo,InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig,InternetGatewayDevice.X_HW_PONInfo,Device.Optical,Device.DeviceInfo,InternetGatewayDevice.ManagementServer.PeriodicInformInterval,Device.ManagementServer.PeriodicInformInterval,InternetGatewayDevice.ManagementServer.URL,Device.ManagementServer.URL,_lastInform');

    const overview = (devices || []).map((device: any) => {
      const igd = device?.InternetGatewayDevice || device?.Device || {};
      const di = igd?.DeviceInfo || {};

      const rxPower = getParam(device, 'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.GponInterfaceConfig.RXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.RXPower')
        ?? getParam(device, 'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig.RXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig.RXPower')
        ?? getParam(device, 'InternetGatewayDevice.X_HW_PONInfo.RXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower')
        ?? getParam(device, 'Device.Optical.Interface.1.Stats.SignalStrength')
        ?? getParam(device, 'Device.Optical.Interface.1.RxPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZYXEL_GponInterfaceConfig.RXPower')
        ?? null;

      const txPower = getParam(device, 'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.TXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.GponInterfaceConfig.TXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.TXPower')
        ?? getParam(device, 'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig.TXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig.TXPower')
        ?? getParam(device, 'InternetGatewayDevice.X_HW_PONInfo.TXPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.TXPower')
        ?? getParam(device, 'Device.Optical.Interface.1.Stats.TransmitPower')
        ?? getParam(device, 'Device.Optical.Interface.1.TxPower')
        ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZYXEL_GponInterfaceConfig.TXPower')
        ?? null;

      // Normalize: some ONUs report in mW (positive values), convert to dBm
      const normalizePower = (val: number | null): number | null => sanitizePower(val);

      const quality = (rx: number | null): string => {
        if (rx === null) return 'unknown';
        if (rx > -20) return 'excellent';
        if (rx > -25) return 'good';
        if (rx > -28) return 'fair';
        return 'critical';
      };

      const rxNorm = normalizePower(rxPower) ?? deepFindPower(device, RX_KEY) ?? null;
      const txNorm = normalizePower(txPower) ?? deepFindPower(device, TX_KEY) ?? null;


      const idParts = String(device?._id || '').split('-');
      const serialFromId = idParts.length >= 3 ? idParts.slice(2).join('-') : null;
      const modelFromId = idParts.length >= 3 ? idParts[1] : null;
      const metadata = device?._deviceId || {};

      return {
        deviceId: device._id,
        manufacturer: di?.Manufacturer?._value || metadata?._Manufacturer || idParts[0] || 'Desconocido',
        model: di?.ModelName?._value || di?.ProductClass?._value || metadata?._ProductClass || modelFromId || '-',
        serial: di?.SerialNumber?._value || metadata?._SerialNumber || serialFromId || '-',
        rxPower: rxNorm,
        txPower: txNorm,
        quality: quality(rxNorm),
        lastInform: device?._lastInform || null,
        informInterval: informInterval(device),
        acsUrl: deviceAcsUrl(device),
      };
    });

    const scope = await getAcsScope(req);
    const visibleOverview = (scope.unrestricted
      ? overview
      : overview.filter((d: any) =>
          acsAllows(scope, { deviceId: d.deviceId || d.device_id, serial: d.serial, acsUrl: d.acsUrl })
        )
    ).map(({ acsUrl, ...rest }: any) => rest);

    res.json({ success: true, data: visibleOverview });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get device traffic stats ───────────────────────────
genieacsRouter.get('/devices/:deviceId/traffic', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const device = await fetchDevice(deviceId);

    const igd = device?.InternetGatewayDevice || device?.Device || {};
    const wanStats = igd?.WANDevice?.['1']?.WANCommonInterfaceConfig || {};
    const lanStats = igd?.LANDevice?.['1']?.LANEthernetInterfaceConfig || {};

    const interfaces: any[] = [];

    // WAN
    interfaces.push({
      name: 'WAN',
      bytesReceived: wanStats?.TotalBytesReceived?._value || 0,
      bytesSent: wanStats?.TotalBytesSent?._value || 0,
      packetsReceived: wanStats?.TotalPacketsReceived?._value || 0,
      packetsSent: wanStats?.TotalPacketsSent?._value || 0,
    });

    // LAN ports
    for (const key of Object.keys(lanStats || {})) {
      const port = lanStats[key];
      if (port?.Stats) {
        interfaces.push({
          name: `LAN ${key}`,
          bytesReceived: port.Stats.BytesReceived?._value || 0,
          bytesSent: port.Stats.BytesSent?._value || 0,
          packetsReceived: port.Stats.PacketsReceived?._value || 0,
          packetsSent: port.Stats.PacketsSent?._value || 0,
        });
      }
    }

    res.json({ success: true, data: interfaces });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get device tasks ───────────────────────────────────
genieacsRouter.get('/devices/:deviceId/tasks', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const query = JSON.stringify({ device: deviceId });
    const data = await genieFetch(`/tasks/?query=${encodeURIComponent(query)}`);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete a task ──────────────────────────────────────
genieacsRouter.delete('/tasks/:taskId', async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params;
    await genieFetch(`/tasks/${taskId}`, { method: 'DELETE' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get presets ────────────────────────────────────────
genieacsRouter.get('/presets', async (req: AuthRequest, res: Response) => {
  try {
    const data = await genieFetch('/presets/');
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Create/Update a preset (auto-provisioning) ────────
genieacsRouter.put('/presets/:presetId', async (req: AuthRequest, res: Response) => {
  try {
    const { presetId } = req.params;
    const preset = req.body;
    await genieFetch(`/presets/${encodeURIComponent(presetId)}`, {
      method: 'PUT',
      body: JSON.stringify(preset),
    });
    res.json({ success: true, message: 'Preset guardado' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete a preset ───────────────────────────────────
genieacsRouter.delete('/presets/:presetId', async (req: AuthRequest, res: Response) => {
  try {
    const { presetId } = req.params;
    await genieFetch(`/presets/${encodeURIComponent(presetId)}`, { method: 'DELETE' });
    res.json({ success: true, message: 'Preset eliminado' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk apply config to devices by filter ─────────────
genieacsRouter.post('/bulk/config', async (req: AuthRequest, res: Response) => {
  try {
    const { filter, parameterValues } = req.body;
    // Get matching devices
    const devices = await genieFetch(`/devices/?query=${encodeURIComponent(JSON.stringify(filter))}&projection=DeviceID`);
    const results: any[] = [];

    for (const device of devices) {
      const deviceId = device._id;
      try {
        const task = { name: 'setParameterValues', parameterValues };
        const result = await genieFetch(
          `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
          { method: 'POST', body: JSON.stringify(task) }
        );
        results.push({ deviceId, success: true });
      } catch (err: any) {
        results.push({ deviceId, success: false, error: err.message });
      }
    }

    res.json({ 
      success: true, 
      message: `Configuración aplicada a ${results.filter(r => r.success).length}/${devices.length} dispositivos`,
      data: results 
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Auto-provision a device by serial number ──────────
// Finds the device in GenieACS by serial, then pushes WiFi + PPPoE + VLAN config
genieacsRouter.post('/auto-provision', async (req: AuthRequest, res: Response) => {
  try {
    const { serialNumber, wifiSsid, wifiPassword, pppoeUsername, pppoePassword, vlanId, dns1, dns2, mtu } = req.body;

    if (!serialNumber) {
      return res.status(400).json({ error: 'serialNumber es requerido' });
    }
    if (!wifiSsid && !pppoeUsername) {
      return res.status(400).json({ error: 'Debe enviar al menos WiFi o PPPoE para aprovisionar' });
    }

    // Find device in GenieACS by serial number
    const query = JSON.stringify({
      "$or": [
        { "InternetGatewayDevice.DeviceInfo.SerialNumber": serialNumber },
        { "Device.DeviceInfo.SerialNumber": serialNumber }
      ]
    });
    const devices = await genieFetch(`/devices/?query=${encodeURIComponent(query)}&projection=DeviceID`);

    if (!devices || devices.length === 0) {
      return res.json({
        success: false,
        found: false,
        message: `ONU con serial ${serialNumber} no encontrada en el ACS. La configuración se aplicará cuando la ONU se conecte.`
      });
    }

    const deviceId = devices[0]._id;
    const parameterValues: [string, string, string][] = [];

    // WiFi configuration
    if (wifiSsid) {
      parameterValues.push(
        ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID', wifiSsid, 'xsd:string']
      );
    }
    if (wifiPassword) {
      parameterValues.push(
        ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey', wifiPassword, 'xsd:string'],
        ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase', wifiPassword, 'xsd:string'],
      );
    }

    // PPPoE configuration
    const wanBase = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
    if (pppoeUsername) {
      parameterValues.push([`${wanBase}.Username`, pppoeUsername, 'xsd:string']);
    }
    if (pppoePassword) {
      parameterValues.push([`${wanBase}.Password`, pppoePassword, 'xsd:string']);
    }

    // VLAN
    if (vlanId !== undefined && vlanId !== null && vlanId !== '') {
      parameterValues.push([
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_VLAN_ID',
        String(vlanId), 'xsd:unsignedInt'
      ]);
    }

    // DNS
    if (dns1) {
      parameterValues.push([`${wanBase}.DNSServers`, dns2 ? `${dns1},${dns2}` : dns1, 'xsd:string']);
    }

    // MTU
    if (mtu) {
      parameterValues.push([`${wanBase}.MaxMRUSize`, String(mtu), 'xsd:unsignedInt']);
    }

    if (parameterValues.length === 0) {
      return res.status(400).json({ error: 'No hay parámetros para enviar' });
    }

    const task = { name: 'setParameterValues', parameterValues };
    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );

    const configSummary = [];
    if (wifiSsid) configSummary.push(`WiFi: ${wifiSsid}`);
    if (pppoeUsername) configSummary.push(`PPPoE: ${pppoeUsername}`);
    if (vlanId) configSummary.push(`VLAN: ${vlanId}`);

    res.json({
      success: true,
      found: true,
      deviceId,
      message: `Auto-provisioning enviado: ${configSummary.join(', ')}`,
      data: result
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Auto-sync: match GenieACS devices with registered ONUs by serial ──
genieacsRouter.post('/auto-sync/:mikrotikId([0-9a-fA-F-]{36})', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;

    // 1. Get all ACS devices with DeviceInfo
    const acsDevices = await genieFetch(
      '/devices/?projection=InternetGatewayDevice.DeviceInfo,Device.DeviceInfo,_lastInform'
    );

    if (!acsDevices || acsDevices.length === 0) {
      return res.json({ success: true, linked: 0, newDevices: 0, message: 'No hay dispositivos en el ACS' });
    }

    // 2. Build serial → ACS device map
    const acsMap = new Map<string, any>();
    for (const device of acsDevices) {
      const di = device?.InternetGatewayDevice?.DeviceInfo || device?.Device?.DeviceInfo || {};
      const serial = di?.SerialNumber?._value;
      if (serial) {
        acsMap.set(serial.toUpperCase(), {
          deviceId: device._id,
          manufacturer: di?.Manufacturer?._value || 'Desconocido',
          model: di?.ModelName?._value || di?.ProductClass?._value || null,
          firmware: di?.SoftwareVersion?._value || null,
          lastInform: device?._lastInform || null,
        });
      }
    }

    // 3. Get registered ONUs for this mikrotik
    const onuResult = await pool.query(
      `SELECT id, serial_number, acs_device_id, status, client_id FROM onu_devices WHERE mikrotik_id = $1`,
      [mikrotikId]
    );

    let linked = 0;
    let updated = 0;
    const newAcsDevices: any[] = [];

    // 4. Match and update
    for (const onu of onuResult.rows) {
      const serialKey = onu.serial_number.toUpperCase();
      const acsDevice = acsMap.get(serialKey);

      if (acsDevice) {
        // Found match - link or update
        if (onu.acs_device_id !== acsDevice.deviceId) {
          // New link
          await pool.query(
            `UPDATE onu_devices SET 
              acs_device_id = $1, acs_linked_at = NOW(), 
              acs_manufacturer = $2, acs_model = $3, acs_firmware = $4,
              status = CASE WHEN status = 'registered' THEN 'active' ELSE status END
            WHERE id = $5`,
            [acsDevice.deviceId, acsDevice.manufacturer, acsDevice.model, acsDevice.firmware, onu.id]
          );
          linked++;
        } else {
          // Already linked - update metadata
          await pool.query(
            `UPDATE onu_devices SET acs_manufacturer = $1, acs_model = $2, acs_firmware = $3 WHERE id = $4`,
            [acsDevice.manufacturer, acsDevice.model, acsDevice.firmware, onu.id]
          );
          updated++;
        }
        // Remove from map so we know which ACS devices are unregistered
        acsMap.delete(serialKey);
      }
    }

    // 5. Remaining ACS devices are unregistered ONUs
    for (const [serial, device] of acsMap) {
      newAcsDevices.push({
        serial,
        deviceId: device.deviceId,
        manufacturer: device.manufacturer,
        model: device.model,
        firmware: device.firmware,
        lastInform: device.lastInform,
      });
    }

    res.json({
      success: true,
      linked,
      updated,
      newDevices: newAcsDevices.length,
      unregistered: newAcsDevices,
      message: `${linked} ONUs vinculadas, ${updated} actualizadas, ${newAcsDevices.length} sin registrar`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Auto-register: create ONU records from unregistered ACS devices ──
genieacsRouter.post('/auto-register/:mikrotikId([0-9a-fA-F-]{36})', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const { devices } = req.body; // Array of { serial, deviceId, manufacturer, model, firmware }

    if (!devices || !Array.isArray(devices) || devices.length === 0) {
      return res.status(400).json({ error: 'No hay dispositivos para registrar' });
    }

    let registered = 0;
    const results: any[] = [];

    for (const device of devices) {
      try {
        // Check if already exists
        const existing = await pool.query(
          'SELECT id FROM onu_devices WHERE serial_number = $1 AND mikrotik_id = $2',
          [device.serial, mikrotikId]
        );
        if (existing.rows.length > 0) {
          results.push({ serial: device.serial, status: 'already_exists' });
          continue;
        }

        // Map manufacturer to brand
        const mfr = (device.manufacturer || '').toLowerCase();
        let brand = 'latic';
        if (mfr.includes('zte')) brand = 'zte';
        else if (mfr.includes('huawei')) brand = 'huawei';
        else if (mfr.includes('zyxel')) brand = 'zyxel';

        await pool.query(
          `INSERT INTO onu_devices (
            mikrotik_id, created_by, serial_number, brand, model, status,
            acs_device_id, acs_linked_at, acs_manufacturer, acs_model, acs_firmware
          ) VALUES ($1, $2, $3, $4, $5, 'active', $6, NOW(), $7, $8, $9)`,
          [
            mikrotikId, req.userId, device.serial, brand, device.model || null,
            device.deviceId, device.manufacturer, device.model, device.firmware
          ]
        );
        registered++;
        results.push({ serial: device.serial, status: 'registered', brand });
      } catch (err: any) {
        results.push({ serial: device.serial, status: 'error', error: err.message });
      }
    }

    res.json({
      success: true,
      registered,
      message: `${registered} ONUs registradas automáticamente desde el ACS`,
      data: results,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get files (for firmware OTA) ───────────────────────
genieacsRouter.get('/files', async (req: AuthRequest, res: Response) => {
  try {
    const data = await genieFetch('/files/');
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete file ────────────────────────────────────────
genieacsRouter.delete('/files/:fileId', async (req: AuthRequest, res: Response) => {
  try {
    const { fileId } = req.params;
    await genieFetch(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper: Send Telegram alert ────────────────────────
async function sendTelegramAlert(
  mikrotikId: string,
  chatId: string,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { rows: configRows } = await pool.query(
      'SELECT bot_token FROM telegram_config WHERE mikrotik_id = $1 AND is_active = true',
      [mikrotikId]
    );
    if (!configRows[0]) return { ok: false, error: 'Telegram no configurado' };

    const response = await fetch(`https://api.telegram.org/bot${configRows[0].bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
    const result = await response.json() as any;
    return { ok: result.ok, error: result.ok ? undefined : result.description };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ─── Collect signal readings for all linked ONUs ────────
genieacsRouter.post('/signal-collect/:mikrotikId([0-9a-fA-F-]{36})', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;

    // Get all ONUs with ACS link, including alert config
    const onuResult = await pool.query(
      `SELECT id, acs_device_id, serial_number, brand, model, client_id,
              signal_alert_threshold, signal_alerts_enabled, signal_alert_chat_id, last_alert_sent_at
       FROM onu_devices WHERE mikrotik_id = $1 AND acs_device_id IS NOT NULL`,
      [mikrotikId]
    );

    if (onuResult.rows.length === 0) {
      return res.json({ success: true, collected: 0, message: 'No hay ONUs vinculadas al ACS' });
    }

    // Get global admin chat_id from telegram_config if individual not set
    const { rows: tgConfig } = await pool.query(
      `SELECT tc.bot_token, u.id as admin_id
       FROM telegram_config tc
       JOIN mikrotik_devices md ON md.id = tc.mikrotik_id
       JOIN users u ON u.id = md.created_by
       WHERE tc.mikrotik_id = $1 AND tc.is_active = true`,
      [mikrotikId]
    );

    let collected = 0;
    let alertsSent = 0;
    const errors: string[] = [];

    for (const onu of onuResult.rows) {
      try {
        const device = await fetchDevice(onu.acs_device_id);
        const igd = device?.InternetGatewayDevice || device?.Device || {};

        // Extract optical power (multi-vendor paths)
        let rxPower = getParam(device, 'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower')
          ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.GponInterfaceConfig.RXPower')
          ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.RXPower')
          ?? getParam(device, 'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig.RXPower')
          ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig.RXPower')
          ?? getParam(device, 'InternetGatewayDevice.X_HW_PONInfo.RXPower')
          ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower')
          ?? getParam(device, 'Device.Optical.Interface.1.Stats.SignalStrength')
          ?? getParam(device, 'Device.Optical.Interface.1.RxPower')
          ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZYXEL_GponInterfaceConfig.RXPower')
          ?? null;

        let txPower = getParam(device, 'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.TXPower')
          ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.GponInterfaceConfig.TXPower')
          ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.TXPower')
          ?? getParam(device, 'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig.TXPower')
          ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig.TXPower')
          ?? getParam(device, 'InternetGatewayDevice.X_HW_PONInfo.TXPower')
          ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.TXPower')
          ?? getParam(device, 'Device.Optical.Interface.1.Stats.TransmitPower')
          ?? getParam(device, 'Device.Optical.Interface.1.TxPower')
          ?? getParam(device, 'InternetGatewayDevice.WANDevice.1.X_ZYXEL_GponInterfaceConfig.TXPower')
          ?? null;

        // Normalizar a dBm entero (maneja 0.01 dBm, mW, centinelas)
        const normalizePower = (val: number | null): number | null => sanitizePower(val);

        rxPower = normalizePower(rxPower);
        txPower = normalizePower(txPower);

        const quality = (rx: number | null): string => {
          if (rx === null) return 'unknown';
          if (rx > -20) return 'excellent';
          if (rx > -25) return 'good';
          if (rx > -28) return 'fair';
          return 'critical';
        };

        const temperature = getParam(device, 'InternetGatewayDevice.DeviceInfo.X_Temperature')
          ?? getParam(device, 'Device.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value')
          ?? null;

        const cpuUsage = getParam(device, 'InternetGatewayDevice.DeviceInfo.X_CPU_Usage')
          ?? getParam(device, 'Device.DeviceInfo.ProcessStatus.CPUUsage')
          ?? null;

        const wan = igd?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANPPPConnection?.['1'] ||
                    igd?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANIPConnection?.['1'] || {};
        const wanStatus = wan?.ConnectionStatus?._value || wan?.Status?._value || null;

        // Only store if we have at least one signal value
        if (rxPower !== null || txPower !== null) {
          await pool.query(
            `INSERT INTO onu_signal_history (onu_id, mikrotik_id, rx_power, tx_power, quality, temperature, cpu_usage, wan_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [onu.id, mikrotikId, rxPower, txPower, quality(rxPower), temperature, cpuUsage, wanStatus]
          );
          collected++;

          // ─── Check signal alert threshold ───────────
          if (onu.signal_alerts_enabled && rxPower !== null && rxPower < parseFloat(onu.signal_alert_threshold)) {
            // Throttle: don't send more than 1 alert per hour per ONU
            const lastAlert = onu.last_alert_sent_at ? new Date(onu.last_alert_sent_at) : null;
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

            if (!lastAlert || lastAlert < oneHourAgo) {
              // Get client name
              let clientName = 'Sin cliente';
              if (onu.client_id) {
                const clientRes = await pool.query('SELECT client_name FROM isp_clients WHERE id = $1', [onu.client_id]);
                if (clientRes.rows[0]) clientName = clientRes.rows[0].client_name;
              }

              const alertMessage = `🔴 <b>ALERTA: Señal Óptica Baja</b>\n\n` +
                `📡 <b>ONU:</b> ${onu.serial_number}\n` +
                `🏷️ <b>Marca:</b> ${onu.brand} ${onu.model || ''}\n` +
                `👤 <b>Cliente:</b> ${clientName}\n` +
                `📉 <b>Rx Power:</b> ${rxPower} dBm\n` +
                `⚠️ <b>Umbral:</b> ${onu.signal_alert_threshold} dBm\n` +
                `${txPower !== null ? `📤 <b>Tx Power:</b> ${txPower} dBm\n` : ''}` +
                `${temperature !== null ? `🌡️ <b>Temperatura:</b> ${temperature}°C\n` : ''}` +
                `\n⏰ ${new Date().toLocaleString('es')}`;

              const chatId = onu.signal_alert_chat_id || null;
              let sent = false;
              let errorMsg: string | undefined;

              if (chatId) {
                const result = await sendTelegramAlert(mikrotikId, chatId, alertMessage);
                sent = result.ok;
                errorMsg = result.error;
              } else {
                errorMsg = 'No hay chat_id configurado para alertas';
              }

              // Log alert
              await pool.query(
                `INSERT INTO onu_signal_alerts (onu_id, mikrotik_id, rx_power, threshold, message, sent_successfully, error_message)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [onu.id, mikrotikId, rxPower, onu.signal_alert_threshold, alertMessage, sent, errorMsg || null]
              );

              // Update last alert timestamp
              await pool.query(
                'UPDATE onu_devices SET last_alert_sent_at = NOW() WHERE id = $1',
                [onu.id]
              );

              if (sent) alertsSent++;
            }
          }
        }
      } catch (err: any) {
        errors.push(`${onu.serial_number}: ${err.message}`);
      }
    }

    res.json({
      success: true,
      collected,
      alertsSent,
      total: onuResult.rows.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Señal recolectada de ${collected}/${onuResult.rows.length} ONUs. ${alertsSent > 0 ? `${alertsSent} alertas enviadas.` : ''}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Configure signal alerts for an ONU ─────────────────
genieacsRouter.put('/signal-alerts/:onuId', async (req: AuthRequest, res: Response) => {
  try {
    const { onuId } = req.params;
    const { enabled, threshold, chatId } = req.body;

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (enabled !== undefined) { updates.push(`signal_alerts_enabled = $${idx++}`); values.push(enabled); }
    if (threshold !== undefined) { updates.push(`signal_alert_threshold = $${idx++}`); values.push(threshold); }
    if (chatId !== undefined) { updates.push(`signal_alert_chat_id = $${idx++}`); values.push(chatId || null); }

    if (updates.length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

    values.push(onuId);
    const result = await pool.query(
      `UPDATE onu_devices SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, signal_alerts_enabled, signal_alert_threshold, signal_alert_chat_id`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'ONU no encontrada' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get signal alerts history ──────────────────────────
genieacsRouter.get('/signal-alerts/:mikrotikId([0-9a-fA-F-]{36})', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const { limit = '50' } = req.query;

    const result = await pool.query(
      `SELECT a.*, o.serial_number, o.brand, o.model, c.client_name
       FROM onu_signal_alerts a
       JOIN onu_devices o ON o.id = a.onu_id
       LEFT JOIN isp_clients c ON c.id = o.client_id
       WHERE a.mikrotik_id = $1
       ORDER BY a.created_at DESC
       LIMIT $2`,
      [mikrotikId, parseInt(limit as string)]
    );

    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get signal history for an ONU ─────────────────────
genieacsRouter.get('/signal-history/:onuId', async (req: AuthRequest, res: Response) => {
  try {
    const { onuId } = req.params;
    const { hours = '168' } = req.query; // Default: 7 days

    const result = await pool.query(
      `SELECT rx_power, tx_power, quality, temperature, cpu_usage, wan_status, recorded_at
       FROM onu_signal_history
       WHERE onu_id = $1 AND recorded_at >= NOW() - INTERVAL '1 hour' * $2
       ORDER BY recorded_at ASC`,
      [onuId, parseInt(hours as string)]
    );

    // Calculate stats
    const readings = result.rows;
    let stats = null;
    if (readings.length > 0) {
      const rxValues = readings.filter(r => r.rx_power !== null).map(r => parseFloat(r.rx_power));
      const txValues = readings.filter(r => r.tx_power !== null).map(r => parseFloat(r.tx_power));

      stats = {
        totalReadings: readings.length,
        rxPower: rxValues.length > 0 ? {
          min: Math.min(...rxValues),
          max: Math.max(...rxValues),
          avg: parseFloat((rxValues.reduce((a, b) => a + b, 0) / rxValues.length).toFixed(0)),
          current: rxValues[rxValues.length - 1],
          trend: rxValues.length >= 2 ? (rxValues[rxValues.length - 1] - rxValues[0] > 0 ? 'improving' : rxValues[rxValues.length - 1] - rxValues[0] < -1 ? 'degrading' : 'stable') : 'insufficient',
        } : null,
        txPower: txValues.length > 0 ? {
          min: Math.min(...txValues),
          max: Math.max(...txValues),
          avg: parseFloat((txValues.reduce((a, b) => a + b, 0) / txValues.length).toFixed(0)),
          current: txValues[txValues.length - 1],
        } : null,
      };
    }

    res.json({ success: true, data: readings, stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get signal history for all ONUs of a mikrotik (overview) ──
genieacsRouter.get('/signal-overview-history/:mikrotikId([0-9a-fA-F-]{36})', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;

    // Get latest reading per ONU
    const result = await pool.query(
      `SELECT DISTINCT ON (h.onu_id)
        h.onu_id, h.rx_power, h.tx_power, h.quality, h.temperature, h.wan_status, h.recorded_at,
        o.serial_number, o.brand, o.model, o.client_id,
        c.client_name
       FROM onu_signal_history h
       JOIN onu_devices o ON o.id = h.onu_id
       LEFT JOIN isp_clients c ON c.id = o.client_id
       WHERE h.mikrotik_id = $1
       ORDER BY h.onu_id, h.recorded_at DESC`,
      [mikrotikId]
    );

    // Get trend for each ONU (compare latest vs 24h ago)
    const overview = [];
    for (const row of result.rows) {
      const trendResult = await pool.query(
        `SELECT rx_power FROM onu_signal_history 
         WHERE onu_id = $1 AND recorded_at >= NOW() - INTERVAL '24 hours'
         ORDER BY recorded_at ASC LIMIT 1`,
        [row.onu_id]
      );
      const oldRx = trendResult.rows.length > 0 ? parseFloat(trendResult.rows[0].rx_power) : null;
      const currentRx = row.rx_power !== null ? parseFloat(row.rx_power) : null;

      let trend = 'stable';
      if (oldRx !== null && currentRx !== null) {
        const diff = currentRx - oldRx;
        if (diff < -1) trend = 'degrading';
        else if (diff > 1) trend = 'improving';
      }

      overview.push({
        ...row,
        trend,
        rx_power: currentRx,
        tx_power: row.tx_power !== null ? parseFloat(row.tx_power) : null,
      });
    }

    res.json({ success: true, data: overview });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get global signal config for a MikroTik ───────────
genieacsRouter.get('/signal-config/:mikrotikId([0-9a-fA-F-]{36})', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const result = await pool.query(
      'SELECT * FROM onu_signal_config WHERE mikrotik_id = $1',
      [mikrotikId]
    );
    res.json({ success: true, data: result.rows[0] || null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Create/Update global signal config ─────────────────
genieacsRouter.put('/signal-config/:mikrotikId([0-9a-fA-F-]{36})', async (req: AuthRequest, res: Response) => {
  try {
    const { mikrotikId } = req.params;
    const { alerts_enabled, default_threshold, default_chat_id, cooldown_minutes, auto_cleanup_days } = req.body;
    const userId = req.userId;

    const result = await pool.query(
      `INSERT INTO onu_signal_config (mikrotik_id, created_by, alerts_enabled, default_threshold, default_chat_id, cooldown_minutes, auto_cleanup_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (mikrotik_id) DO UPDATE SET
         alerts_enabled = COALESCE($3, onu_signal_config.alerts_enabled),
         default_threshold = COALESCE($4, onu_signal_config.default_threshold),
         default_chat_id = COALESCE($5, onu_signal_config.default_chat_id),
         cooldown_minutes = COALESCE($6, onu_signal_config.cooldown_minutes),
         auto_cleanup_days = COALESCE($7, onu_signal_config.auto_cleanup_days),
         updated_at = NOW()
       RETURNING *`,
      [mikrotikId, userId, alerts_enabled, default_threshold, default_chat_id || null, cooldown_minutes || 60, auto_cleanup_days || 90]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Cleanup old signal history ────────────────────────
genieacsRouter.delete('/signal-history/cleanup', async (req: AuthRequest, res: Response) => {
  try {
    const { days = '90' } = req.query;
    const result = await pool.query(
      `DELETE FROM onu_signal_history WHERE recorded_at < NOW() - INTERVAL '1 day' * $1`,
      [parseInt(days as string)]
    );
    res.json({ success: true, deleted: result.rowCount, message: `${result.rowCount} registros eliminados` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// ONU MONITOR AVANZADO: radios WiFi (dual band), CATV, uptime
// ═══════════════════════════════════════════════════════════

const WLAN_ROOTS = [
  'InternetGatewayDevice.LANDevice.1.WLANConfiguration',
  'Device.WiFi.SSID',
];

const CATV_PATHS = [
  'InternetGatewayDevice.X_CATV.Enable',
  'InternetGatewayDevice.Services.X_CATV.Enable',
  'InternetGatewayDevice.X_HW_CATV.Enable',
  'InternetGatewayDevice.X_HW_CATVConfig.Enable',
  'InternetGatewayDevice.WANDevice.1.X_CATV_Config.Enable',
  'InternetGatewayDevice.X_ZTE-COM_CATV.Enable',
  'InternetGatewayDevice.X_CT-COM_CATV.Enable',
  'InternetGatewayDevice.X_ZYXEL_CATV.Enable',
  'Device.Optical.Interface.1.X_CATV_Enable',
];

function nodeAt(device: any, path: string): any {
  const parts = path.split('.');
  let cur = device;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function val(node: any): any {
  return node?._value !== undefined ? node._value : undefined;
}

// Detecta la banda de una radio a partir del canal / estándar / nombre
function detectBand(wc: any): '2.4g' | '5g' | 'unknown' {
  const channel = Number(val(wc?.Channel));
  const std = String(val(wc?.Standard) || val(wc?.X_Standard) || '').toLowerCase();
  const ssid = String(val(wc?.SSID) || '').toLowerCase();
  const freq = String(val(wc?.X_ZYXEL_Band) || val(wc?.OperatingFrequencyBand) || val(wc?.X_HW_Band) || '').toLowerCase();
  if (freq.includes('5')) return '5g';
  if (freq.includes('2.4') || freq.includes('2_4')) return '2.4g';
  if (!Number.isNaN(channel) && channel > 0) return channel > 14 ? '5g' : '2.4g';
  if (std.includes('ac') || std.includes('ax')) return '5g';
  if (std.includes('b') || std.includes('g') || std.includes('n')) return '2.4g';
  if (ssid.includes('5g')) return '5g';
  return 'unknown';
}

function collectWlans(device: any) {
  const radios: any[] = [];
  for (const root of WLAN_ROOTS) {
    const container = nodeAt(device, root);
    if (!container || typeof container !== 'object') continue;
    for (const key of Object.keys(container)) {
      if (key.startsWith('_')) continue;
      const wc = container[key];
      if (!wc || typeof wc !== 'object') continue;
      const ssid = val(wc.SSID);
      if (ssid === undefined && val(wc.Enable) === undefined) continue;
      const clients = wc.AssociatedDevice
        ? Object.keys(wc.AssociatedDevice).filter(k => !k.startsWith('_')).length
        : 0;
      radios.push({
        root,
        index: key,
        path: `${root}.${key}`,
        band: detectBand(wc),
        ssid: ssid ?? null,
        enabled: val(wc.Enable) ?? null,
        channel: val(wc.Channel) ?? null,
        autoChannel: val(wc.AutoChannelEnable) ?? null,
        bandwidth: val(wc.OperatingChannelBandwidth) ?? null,
        standard: val(wc.Standard) ?? null,
        hidden: val(wc.SSIDAdvertisementEnabled) !== undefined ? !val(wc.SSIDAdvertisementEnabled) : null,
        password: val(wc.KeyPassphrase)
          ?? val(wc?.PreSharedKey?.['1']?.PreSharedKey)
          ?? val(wc?.PreSharedKey?.['1']?.KeyPassphrase)
          ?? val(wc?.Security?.KeyPassphrase)
          ?? deepFindValue(wc, /(KeyPassphrase|PreSharedKey|WPAKey|WEPKey|Password|Passphrase)$/i, 3)
          ?? null,
        clients,
      });
    }
  }
  return radios;
}

function findCatv(device: any) {
  for (const p of CATV_PATHS) {
    const v = getParam(device, p);
    if (v !== undefined) return { path: p, enabled: v === true || v === 'true' || v === 1 || v === '1' };
  }
  return { path: null as string | null, enabled: null as boolean | null };
}

// ─── Estado completo de la ONU (radios + CATV + uptime + señal) ──
genieacsRouter.get('/devices/:deviceId/onu-status', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const device = await fetchDevice(deviceId);
    const igd = device?.InternetGatewayDevice || {};
    const di = igd?.DeviceInfo || device?.Device?.DeviceInfo || {};
    const catv = findCatv(device);

    res.json({
      success: true,
      data: {
        deviceId,
        manufacturer: val(di.Manufacturer) || 'Desconocido',
        model: val(di.ModelName) || val(di.ProductClass) || '-',
        serial: val(di.SerialNumber) || '-',
        uptime: val(di.UpTime) ?? null,
        softwareVersion: val(di.SoftwareVersion) || '-',
        lastInform: device?._lastInform || null,
        radios: collectWlans(device),
        catv,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Devuelve el nodo de un path dentro del árbol del dispositivo (o undefined)
function getNodeAt(device: any, path: string): any {
  return path.split('.').reduce((acc: any, key: string) => (acc == null ? acc : acc[key]), device);
}
function paramExists(device: any, path: string): boolean {
  const node = getNodeAt(device, path);
  return node !== undefined && node !== null && typeof node === 'object' && '_value' in node;
}

// ─── Editar una radio concreta (2.4G / 5G / cualquiera) ──
genieacsRouter.post('/devices/:deviceId/wlan', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { path, ssid, password, enable, channel, bandwidth, hidden } = req.body;

    if (!path || typeof path !== 'string' || !/^(InternetGatewayDevice|Device)\./.test(path)) {
      return res.status(400).json({ error: 'path de la radio inválido' });
    }
    if (password) {
      const pwErr = wifiPasswordError(password);
      if (pwErr) return res.status(400).json({ error: pwErr });
    }

    // Leemos el árbol real para enviar SOLO parámetros existentes.
    // GenieACS rechaza la tarea completa (fault 9003 "Invalid arguments")
    // si uno solo de los parámetros no existe en la ONU.
    let device: any = null;
    try { device = await fetchDevice(deviceId); } catch { /* seguimos sin validar */ }
    const exists = (p: string) => (device ? paramExists(device, p) : true);

    const parameterValues: [string, any, string][] = [];
    if (ssid && exists(`${path}.SSID`)) parameterValues.push([`${path}.SSID`, ssid, 'xsd:string']);

    if (password) {
      const pwCandidates = [
        `${path}.PreSharedKey.1.KeyPassphrase`,
        `${path}.PreSharedKey.1.PreSharedKey`,
        `${path}.KeyPassphrase`,
        `${path}.X_HW_WPAKey`,
        `${path}.WPAKey`,
      ];
      const found = pwCandidates.filter(exists);
      // Si no detectamos ninguno (árbol incompleto), probamos los estándar
      const chosen = found.length ? found : [`${path}.PreSharedKey.1.KeyPassphrase`, `${path}.KeyPassphrase`];
      for (const p of chosen) parameterValues.push([p, password, 'xsd:string']);
    }

    if (enable !== undefined && exists(`${path}.Enable`)) {
      parameterValues.push([`${path}.Enable`, !!enable, 'xsd:boolean']);
    }
    if (hidden !== undefined && exists(`${path}.SSIDAdvertisementEnabled`)) {
      parameterValues.push([`${path}.SSIDAdvertisementEnabled`, !hidden, 'xsd:boolean']);
    }
    if (channel !== undefined && channel !== null && channel !== '') {
      if (exists(`${path}.AutoChannelEnable`)) parameterValues.push([`${path}.AutoChannelEnable`, false, 'xsd:boolean']);
      if (exists(`${path}.Channel`)) parameterValues.push([`${path}.Channel`, Number(channel), 'xsd:unsignedInt']);
    }
    if (bandwidth && exists(`${path}.OperatingChannelBandwidth`)) {
      parameterValues.push([`${path}.OperatingChannelBandwidth`, bandwidth, 'xsd:string']);
    }

    if (parameterValues.length === 0) {
      return res.status(400).json({ error: 'No hay cambios que enviar (la ONU no expone esos parámetros)' });
    }

    // Enviamos cada parámetro como tarea independiente: si la ONU rechaza uno
    // (p. ej. una variante de clave), el resto sí se aplica.
    const results = await queueTasksWithSingleConnectionRequest(
      deviceId,
      parameterValues.map((pv) => ({ name: 'setParameterValues', parameterValues: [pv] }))
    );

    res.json({
      success: true,
      message: 'Configuración WiFi enviada a la ONU',
      data: results,
      skipped: [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ─── Activar / desactivar CATV ──────────────────────────
genieacsRouter.post('/devices/:deviceId/catv', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { enable, path } = req.body;

    let targetPath = path as string | undefined;
    if (!targetPath) {
      const device = await fetchDevice(deviceId);
      targetPath = findCatv(device).path || undefined;
    }
    if (!targetPath) {
      return res.status(400).json({
        error: 'Esta ONU no expone un parámetro CATV por TR-069. Refresque los parámetros o el modelo no lo soporta.',
      });
    }

    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'setParameterValues',
          parameterValues: [[targetPath, !!enable, 'xsd:boolean']],
        }),
      }
    );
    res.json({ success: true, message: `CATV ${enable ? 'activado' : 'desactivado'}`, data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Refrescar árbol WiFi / CATV / DeviceInfo desde la ONU ──
genieacsRouter.post('/devices/:deviceId/refresh-onu', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const tasks = [
      { name: 'refreshObject', objectName: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration' },
      { name: 'refreshObject', objectName: 'InternetGatewayDevice.DeviceInfo' },
      { name: 'refreshObject', objectName: 'InternetGatewayDevice.WANDevice.1' },
    ];
    await queueTasksWithSingleConnectionRequest(deviceId, tasks);
    res.json({
      success: true,
      message: 'Lectura inmediata solicitada por TR-069.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Alias / nombre de cliente por ONU ───────────────────
async function ensureAliasTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS onu_aliases (
      device_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

genieacsRouter.get('/aliases', async (_req: AuthRequest, res: Response) => {
  try {
    await ensureAliasTable();
    const { rows } = await pool.query('SELECT device_id, name FROM onu_aliases');
    const map: Record<string, string> = {};
    rows.forEach((r: any) => { map[r.device_id] = r.name; });
    res.json({ success: true, data: map });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

genieacsRouter.post('/devices/:deviceId/alias', async (req: AuthRequest, res: Response) => {
  try {
    await ensureAliasTable();
    const { deviceId } = req.params;
    const name = String(req.body?.name || '').trim();
    if (!name) {
      await pool.query('DELETE FROM onu_aliases WHERE device_id = $1', [deviceId]);
      return res.json({ success: true, message: 'Nombre eliminado' });
    }
    await pool.query(
      `INSERT INTO onu_aliases (device_id, name) VALUES ($1, $2)
       ON CONFLICT (device_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [deviceId, name]
    );
    res.json({ success: true, message: 'Nombre guardado' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// Señal óptica ACS-driven: sin registro local ni MikroTik.
// Todas las ONUs que informan a GenieACS entran automáticamente.
// ═══════════════════════════════════════════════════════════

// Recolectar ahora (manual)
genieacsRouter.post('/acs-signal/collect', async (_req: AuthRequest, res: Response) => {
  try {
    const result = await collectAcsSignals(pool);
    res.json({
      success: true,
      ...result,
      message: `Señal recolectada de ${result.collected}/${result.total} ONUs${result.alertsSent ? `. ${result.alertsSent} alertas enviadas` : ''}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Resumen: última lectura por ONU + tendencia 24h
genieacsRouter.get('/acs-signal/overview', async (req: AuthRequest, res: Response) => {
  try {
    await ensureAcsSignalTables(pool);
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (h.device_id)
        h.device_id, h.serial, h.manufacturer, h.model,
        h.rx_power, h.tx_power, h.quality, h.temperature, h.wan_status, h.recorded_at,
        a.name AS alias,
        (SELECT p.rx_power FROM acs_signal_history p
          WHERE p.device_id = h.device_id AND p.recorded_at >= NOW() - INTERVAL '24 hours'
          ORDER BY p.recorded_at ASC LIMIT 1) AS rx_24h_ago
      FROM acs_signal_history h
      LEFT JOIN onu_aliases a ON a.device_id = h.device_id
      ORDER BY h.device_id, h.recorded_at DESC
    `);

    const data = rows.map((r: any) => {
      const rx = r.rx_power !== null ? parseFloat(r.rx_power) : null;
      const old = r.rx_24h_ago !== null && r.rx_24h_ago !== undefined ? parseFloat(r.rx_24h_ago) : null;
      let trend = 'stable';
      if (rx !== null && old !== null) {
        const diff = rx - old;
        if (diff < -1) trend = 'degrading';
        else if (diff > 1) trend = 'improving';
      }
      return {
        device_id: r.device_id,
        name: r.alias || r.serial || r.device_id,
        serial: r.serial,
        manufacturer: r.manufacturer,
        model: r.model,
        rx_power: rx,
        tx_power: r.tx_power !== null ? parseFloat(r.tx_power) : null,
        quality: r.quality,
        temperature: r.temperature !== null ? parseFloat(r.temperature) : null,
        wan_status: r.wan_status,
        recorded_at: r.recorded_at,
        trend,
      };
    });

    const scope = await getAcsScope(req);
    const visible = scope.unrestricted
      ? data
      : data.filter((d: any) => acsAllows(scope, { deviceId: d.device_id, serial: d.serial }));

    res.json({ success: true, data: visible });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Historial de una ONU del ACS
genieacsRouter.get('/acs-signal/history/:deviceId', async (req: AuthRequest, res: Response) => {
  try {
    await ensureAcsSignalTables(pool);
    const { deviceId } = req.params;
    const hours = parseInt((req.query.hours as string) || '168', 10);

    const { rows } = await pool.query(
      `SELECT rx_power, tx_power, quality, temperature, wan_status, recorded_at
       FROM acs_signal_history
       WHERE device_id = $1 AND recorded_at >= NOW() - INTERVAL '1 hour' * $2
       ORDER BY recorded_at ASC`,
      [deviceId, hours]
    );

    const readings = rows.map((r: any) => ({
      rx_power: r.rx_power !== null ? parseFloat(r.rx_power) : null,
      tx_power: r.tx_power !== null ? parseFloat(r.tx_power) : null,
      quality: r.quality,
      temperature: r.temperature !== null ? parseFloat(r.temperature) : null,
      wan_status: r.wan_status,
      recorded_at: r.recorded_at,
    }));

    let stats: any = null;
    if (readings.length > 0) {
      const rxValues = readings.filter(r => r.rx_power !== null).map(r => r.rx_power as number);
      const txValues = readings.filter(r => r.tx_power !== null).map(r => r.tx_power as number);
      stats = {
        totalReadings: readings.length,
        rxPower: rxValues.length ? {
          min: Math.min(...rxValues),
          max: Math.max(...rxValues),
          avg: parseFloat((rxValues.reduce((a, b) => a + b, 0) / rxValues.length).toFixed(0)),
          current: rxValues[rxValues.length - 1],
          trend: rxValues.length >= 2
            ? (rxValues[rxValues.length - 1] - rxValues[0] > 1 ? 'improving'
              : rxValues[rxValues.length - 1] - rxValues[0] < -1 ? 'degrading' : 'stable')
            : 'insufficient',
        } : null,
        txPower: txValues.length ? {
          min: Math.min(...txValues),
          max: Math.max(...txValues),
          avg: parseFloat((txValues.reduce((a, b) => a + b, 0) / txValues.length).toFixed(0)),
          current: txValues[txValues.length - 1],
        } : null,
      };
    }

    res.json({ success: true, data: readings, stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Configuración global de alertas (fila única)
genieacsRouter.get('/acs-signal/config', async (_req: AuthRequest, res: Response) => {
  try {
    await ensureAcsSignalTables(pool);
    const { rows } = await pool.query('SELECT * FROM acs_signal_config WHERE id = 1');
    res.json({ success: true, data: rows[0] || null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

genieacsRouter.put('/acs-signal/config', async (req: AuthRequest, res: Response) => {
  try {
    await ensureAcsSignalTables(pool);
    const { alerts_enabled, default_threshold, default_chat_id, cooldown_minutes, auto_cleanup_days } = req.body || {};
    const { rows } = await pool.query(
      `INSERT INTO acs_signal_config (id, alerts_enabled, default_threshold, default_chat_id, cooldown_minutes, auto_cleanup_days)
       VALUES (1, COALESCE($1,false), COALESCE($2,-28), $3, COALESCE($4,60), COALESCE($5,90))
       ON CONFLICT (id) DO UPDATE SET
         alerts_enabled = COALESCE($1, acs_signal_config.alerts_enabled),
         default_threshold = COALESCE($2, acs_signal_config.default_threshold),
         default_chat_id = $3,
         cooldown_minutes = COALESCE($4, acs_signal_config.cooldown_minutes),
         auto_cleanup_days = COALESCE($5, acs_signal_config.auto_cleanup_days),
         updated_at = now()
       RETURNING *`,
      [
        alerts_enabled ?? null,
        default_threshold ?? null,
        default_chat_id || null,
        cooldown_minutes ?? null,
        auto_cleanup_days ?? null,
      ]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Historial de alertas enviadas
genieacsRouter.get('/acs-signal/alerts', async (req: AuthRequest, res: Response) => {
  try {
    await ensureAcsSignalTables(pool);
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const { rows } = await pool.query(
      `SELECT a.*, al.name AS alias
       FROM acs_signal_alerts a
       LEFT JOIN onu_aliases al ON al.device_id = a.device_id
       ORDER BY a.created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Limpieza manual
genieacsRouter.delete('/acs-signal/cleanup', async (_req: AuthRequest, res: Response) => {
  try {
    const deleted = await cleanupAcsSignals(pool);
    res.json({ success: true, deleted, message: `${deleted} registros eliminados` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
