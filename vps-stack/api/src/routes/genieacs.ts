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

// ─── List all devices (CPEs) ─────────────────────────────
genieacsRouter.get('/devices', async (req: AuthRequest, res: Response) => {
  try {
    const query = req.query.query || '';
    const projection = req.query.projection || 
      'DeviceID,InternetGatewayDevice.DeviceInfo,InternetGatewayDevice.WANDevice,InternetGatewayDevice.LANDevice';
    
    let url = `/devices/?projection=${encodeURIComponent(projection as string)}`;
    if (query) url += `&query=${encodeURIComponent(query as string)}`;

    const data = await genieFetch(url);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get single device ──────────────────────────────────
genieacsRouter.get('/devices/:deviceId', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const data = await genieFetch(`/devices/${encodeURIComponent(deviceId)}`);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Set WiFi parameters (SSID + Password) ──────────────
genieacsRouter.post('/devices/:deviceId/wifi', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { ssid, password } = req.body;

    if (!ssid && !password) {
      return res.status(400).json({ error: 'Debe enviar ssid o password' });
    }

    // Build parameter list for SetParameterValues
    const parameterValues: [string, string, string][] = [];

    // Common TR-069 WiFi parameter paths
    const wlanBasePaths = [
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1',
      'Device.WiFi.SSID.1',
    ];

    if (ssid) {
      parameterValues.push(
        [`${wlanBasePaths[0]}.SSID`, ssid, 'xsd:string'],
      );
    }
    if (password) {
      parameterValues.push(
        [`${wlanBasePaths[0]}.PreSharedKey.1.PreSharedKey`, password, 'xsd:string'],
        [`${wlanBasePaths[0]}.KeyPassphrase`, password, 'xsd:string'],
      );
    }

    // Create task in GenieACS
    const task = {
      name: 'setParameterValues',
      parameterValues,
    };

    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );

    res.json({ success: true, message: 'Tarea de cambio WiFi enviada a la ONU', data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Reboot device ──────────────────────────────────────
genieacsRouter.post('/devices/:deviceId/reboot', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;

    const task = { name: 'reboot' };
    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );

    res.json({ success: true, message: 'Comando de reinicio enviado', data: result });
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

// ─── GenieACS health check ─────────────────────────────
genieacsRouter.get('/health', async (req: AuthRequest, res: Response) => {
  try {
    const data = await genieFetch('/devices/?projection=DeviceID&limit=1');
    res.json({ success: true, status: 'online', message: 'GenieACS está funcionando' });
  } catch (err: any) {
    res.json({ success: false, status: 'offline', message: err.message });
  }
});

// ─── Factory reset ──────────────────────────────────────
genieacsRouter.post('/devices/:deviceId/factory-reset', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const task = { name: 'factoryReset' };
    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );
    res.json({ success: true, message: 'Factory reset enviado', data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Download config file to device ─────────────────────
genieacsRouter.post('/devices/:deviceId/download', async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { fileType, fileName } = req.body;

    const task = {
      name: 'download',
      file: fileName,
      fileType: fileType || '1 Firmware Upgrade Image',
    };

    const result = await genieFetch(
      `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`,
      { method: 'POST', body: JSON.stringify(task) }
    );

    res.json({ success: true, message: 'Descarga enviada al dispositivo', data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
