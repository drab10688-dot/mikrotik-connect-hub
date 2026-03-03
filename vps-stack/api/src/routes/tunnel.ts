import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { spawn, execSync } from 'child_process';

export const tunnelRouter = Router();

// ─── State ────────────────────────────────────
let tunnelProcess: ReturnType<typeof spawn> | null = null;
let tunnelUrl: string | null = null;
let tunnelStatus: 'stopped' | 'starting' | 'running' | 'error' = 'stopped';
let tunnelError: string | null = null;

// ─── Helpers ──────────────────────────────────
const getServerIP = (): string | null => {
  try {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]!) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch {}
  return null;
};

const isCloudflaredInstalled = (): boolean => {
  try {
    execSync('which cloudflared', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

// ─── GET /status ──────────────────────────────
tunnelRouter.get('/status', (req: AuthRequest, res: Response) => {
  res.json({
    installed: isCloudflaredInstalled(),
    status: tunnelStatus,
    url: tunnelUrl,
    error: tunnelError,
    https: tunnelUrl ? tunnelUrl.startsWith('https://') : false,
    server_ip: getServerIP(),
  });
});

// ─── POST /install ────────────────────────────
tunnelRouter.post('/install', (req: AuthRequest, res: Response) => {
  if (req.userRole !== 'super_admin' && req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }

  if (isCloudflaredInstalled()) {
    return res.json({ success: true, message: 'cloudflared ya está instalado' });
  }

  try {
    console.log('📦 Instalando cloudflared...');
    execSync(
      'curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null && ' +
      'echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list && ' +
      'sudo apt-get update && sudo apt-get install -y cloudflared',
      { stdio: 'pipe', timeout: 120000 }
    );
    res.json({ success: true, message: 'cloudflared instalado correctamente' });
  } catch {
    // Fallback: binary directo
    try {
      execSync(
        'curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /usr/local/bin/cloudflared',
        { stdio: 'pipe', timeout: 60000 }
      );
      res.json({ success: true, message: 'cloudflared instalado (binario directo)' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: `Error instalando: ${err.message}` });
    }
  }
});

// ─── POST /start ──────────────────────────────
tunnelRouter.post('/start', (req: AuthRequest, res: Response) => {
  if (req.userRole !== 'super_admin' && req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }

  if (!isCloudflaredInstalled()) {
    return res.status(400).json({ error: 'cloudflared no está instalado. Instálalo primero.' });
  }

  if (tunnelProcess) {
    return res.json({ success: true, url: tunnelUrl, message: 'El túnel ya está corriendo' });
  }

  tunnelStatus = 'starting';
  tunnelUrl = null;
  tunnelError = null;

  const targetPort = req.body.port || 80;

  tunnelProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${targetPort}`, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const extractUrl = (data: Buffer) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !tunnelUrl) {
      tunnelUrl = match[0];
      tunnelStatus = 'running';
      console.log(`🌐 Cloudflare Tunnel activo: ${tunnelUrl}`);
    }
  };

  tunnelProcess.stdout?.on('data', extractUrl);
  tunnelProcess.stderr?.on('data', extractUrl);

  tunnelProcess.on('error', (err) => {
    tunnelStatus = 'error';
    tunnelError = err.message;
    tunnelProcess = null;
  });

  tunnelProcess.on('exit', (code) => {
    if (tunnelStatus !== 'stopped') {
      tunnelStatus = code === 0 ? 'stopped' : 'error';
      if (code !== 0) tunnelError = `Proceso terminó con código ${code}`;
    }
    tunnelProcess = null;
    tunnelUrl = null;
  });

  // Esperar unos segundos para capturar la URL
  setTimeout(() => {
    res.json({
      success: true,
      status: tunnelStatus,
      url: tunnelUrl,
      message: tunnelUrl ? 'Túnel iniciado' : 'Iniciando túnel, espera unos segundos...',
    });
  }, 5000);
});

// ─── POST /stop ───────────────────────────────
tunnelRouter.post('/stop', (req: AuthRequest, res: Response) => {
  if (req.userRole !== 'super_admin' && req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }

  if (tunnelProcess) {
    tunnelStatus = 'stopped';
    tunnelProcess.kill('SIGTERM');
    tunnelProcess = null;
    tunnelUrl = null;
    tunnelError = null;
    res.json({ success: true, message: 'Túnel detenido' });
  } else {
    tunnelStatus = 'stopped';
    tunnelUrl = null;
    res.json({ success: true, message: 'El túnel no estaba corriendo' });
  }
});
