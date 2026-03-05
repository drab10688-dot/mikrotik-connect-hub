import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';

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
