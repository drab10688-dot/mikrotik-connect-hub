import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { pool } from '../lib/db';

export const genieacsRouter = Router();
genieacsRouter.use(authMiddleware);

const GENIEACS_NBI = process.env.GENIEACS_NBI_URL || 'http://genieacs-nbi:7557';

// ─── Helper: fetch GenieACS NBI ──────────────────────────
async function genieFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${GENIEACS_NBI}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GenieACS error (${res.status}): ${text}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
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

// ─── Health check ─────────────────────────────────────────
genieacsRouter.get('/health', async (req: AuthRequest, res: Response) => {
  try {
    await genieFetch('/devices/?projection=DeviceID&limit=1');
    res.json({ success: true, status: 'online', message: 'GenieACS está funcionando' });
  } catch (err: any) {
    res.json({ success: false, status: 'offline', message: err.message });
  }
});

// ─── List all devices (CPEs) ─────────────────────────────
genieacsRouter.get('/devices', async (req: AuthRequest, res: Response) => {
  try {
    const query = req.query.query || '';
    const projection = req.query.projection || '';
    let url = `/devices/?projection=${encodeURIComponent(projection as string)}`;
    if (query) url += `&query=${encodeURIComponent(query as string)}`;
    const data = await genieFetch(url);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get single device (full tree) ──────────────────────
genieacsRouter.get('/devices/:deviceId', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const data = await genieFetch(`/devices/${encodeURIComponent(deviceId)}`);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get device monitoring data (optical signal, CPU, temp, uptime, wan status) ──
genieacsRouter.get('/devices/:deviceId/monitor', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const device = await genieFetch(`/devices/${encodeURIComponent(deviceId)}`);

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

// ─── Set WiFi parameters (SSID + Password) ──────────────
genieacsRouter.post('/devices/:deviceId/wifi', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { ssid, password, band } = req.body;

    if (!ssid && !password) {
      return res.status(400).json({ error: 'Debe enviar ssid o password' });
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

// ─── Configure PPPoE ────────────────────────────────────
genieacsRouter.post('/devices/:deviceId/pppoe', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { username, password } = req.body;

    const basePath = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
    const parameterValues: [string, string, string][] = [];

    if (username) parameterValues.push([`${basePath}.Username`, username, 'xsd:string']);
    if (password) parameterValues.push([`${basePath}.Password`, password, 'xsd:string']);

    const task = { name: 'setParameterValues', parameterValues };
    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );

    res.json({ success: true, message: 'Configuración PPPoE enviada', data: result });
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
    const task = {
      name: 'getParameterValues',
      parameterNames: [parameterPath || 'InternetGatewayDevice'],
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
    const device = await genieFetch(`/devices/${encodeURIComponent(deviceId)}`);

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

// ─── Force refresh optical signal parameters via GetParameterValues ──
genieacsRouter.post('/devices/:deviceId/refresh-signal', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;

    // Request all known optical parameter paths across vendors
    const opticalPaths = [
      'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.',
      'InternetGatewayDevice.WANDevice.1.GponInterfaceConfig.',
      'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.',
      'InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig.',
      'InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig.',
      'InternetGatewayDevice.X_HW_PONInfo.',
      'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.',
      'InternetGatewayDevice.WANDevice.1.X_ZYXEL_GponInterfaceConfig.',
      'Device.Optical.Interface.1.',
    ];

    const task = {
      name: 'getParameterValues',
      parameterNames: opticalPaths,
    };

    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );

    res.json({ success: true, message: 'Solicitud de lectura de señal óptica enviada', data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk signal overview for all devices ───────────────
genieacsRouter.get('/signal-overview', async (req: AuthRequest, res: Response) => {
  try {
    const devices = await genieFetch('/devices/?projection=InternetGatewayDevice.WANDevice,InternetGatewayDevice.DeviceInfo,InternetGatewayDevice.X_ZTE-COM_WANPONInterfaceConfig,InternetGatewayDevice.X_HW_PONInfo,Device.Optical,Device.DeviceInfo,_lastInform');

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
      const normalizePower = (val: number | null): number | null => {
        if (val === null) return null;
        // If value is positive and > 1, likely in mW * 10000 or similar vendor scale
        if (val > 100) return parseFloat((10 * Math.log10(val / 10000)).toFixed(2));
        return val;
      };

      const quality = (rx: number | null): string => {
        if (rx === null) return 'unknown';
        if (rx > -20) return 'excellent';
        if (rx > -25) return 'good';
        if (rx > -28) return 'fair';
        return 'critical';
      };

      const rxNorm = normalizePower(rxPower);
      const txNorm = normalizePower(txPower);

      return {
        deviceId: device._id,
        manufacturer: di?.Manufacturer?._value || 'Desconocido',
        model: di?.ModelName?._value || di?.ProductClass?._value || '-',
        serial: di?.SerialNumber?._value || '-',
        rxPower: rxNorm,
        txPower: txNorm,
        quality: quality(rxNorm),
        lastInform: device?._lastInform || null,
      };
    });

    res.json({ success: true, data: overview });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get device traffic stats ───────────────────────────
genieacsRouter.get('/devices/:deviceId/traffic', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const device = await genieFetch(`/devices/${encodeURIComponent(deviceId)}`);

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
        const device = await genieFetch(`/devices/${encodeURIComponent(onu.acs_device_id)}`);
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

        // Normalize mW to dBm
        const normalizePower = (val: number | null): number | null => {
          if (val === null) return null;
          if (val > 100) return parseFloat((10 * Math.log10(val / 10000)).toFixed(2));
          return val;
        };

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
          avg: parseFloat((rxValues.reduce((a, b) => a + b, 0) / rxValues.length).toFixed(2)),
          current: rxValues[rxValues.length - 1],
          trend: rxValues.length >= 2 ? (rxValues[rxValues.length - 1] - rxValues[0] > 0 ? 'improving' : rxValues[rxValues.length - 1] - rxValues[0] < -1 ? 'degrading' : 'stable') : 'insufficient',
        } : null,
        txPower: txValues.length > 0 ? {
          min: Math.min(...txValues),
          max: Math.max(...txValues),
          avg: parseFloat((txValues.reduce((a, b) => a + b, 0) / txValues.length).toFixed(2)),
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
