import { Router, Request, Response } from 'express';
import { AuthRequest, verifyDeviceAccess } from '../middleware/auth';
import { pool } from '../lib/db';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);
const vpnRouter = Router();

const WG_CONFIG_DIR = '/config/wg_confs';
const WG_INTERFACE = 'wg0';
const WG_PORT = process.env.WG_PORT || '51820';
const WG_SUBNET = '10.13.13';
const WG_CONTAINER = process.env.WG_CONTAINER_NAME || 'omnisync-wireguard';
const WG_IMAGE = process.env.WG_IMAGE || 'lscr.io/linuxserver/wireguard:latest';
const WG_READY_TTL_MS = 5000;
let wgLastCheckAt = 0;
let cachedPublicIp = '';

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255);
}

function extractIpv4(value: string): string {
  const match = value.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  if (!match) return '';
  return isValidIpv4(match[0]) ? match[0] : '';
}

function getRequestHost(req: Request): string {
  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim();
  const hostHeader = (forwardedHost || req.get('host') || '').trim();
  return hostHeader.replace(/^https?:\/\//, '').split(':')[0];
}

async function getPublicIp(fallbackHost = ''): Promise<string> {
  if (cachedPublicIp) return cachedPublicIp;

  const commands = [
    'curl -s -4 --max-time 5 ifconfig.me',
    'curl -s -4 --max-time 5 api.ipify.org',
    'curl -s -4 --max-time 5 icanhazip.com',
    'curl -s -4 --max-time 5 ipecho.net/plain',
    "ip route get 1.1.1.1 | awk '{print $7; exit}'",
    'hostname -i',
  ];

  for (const cmd of commands) {
    try {
      const { stdout } = await execAsync(cmd);
      const ip = extractIpv4(stdout.trim());
      if (ip) {
        cachedPublicIp = ip;
        return ip;
      }
    } catch {}
  }

  const envIp = process.env.VPS_PUBLIC_IP?.trim() || '';
  if (envIp && isValidIpv4(envIp)) {
    cachedPublicIp = envIp;
    return envIp;
  }

  const normalizedFallback = fallbackHost.trim();
  if (normalizedFallback) {
    return normalizedFallback;
  }

  return '';
}

// ─── Helpers ──────────────────────────────────────
function shellEscape(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

function isWireguardContainerUnavailable(rawMessage: string): boolean {
  const message = rawMessage.toLowerCase();
  return (
    message.includes('no such object') ||
    message.includes('no such container') ||
    message.includes('is not running')
  );
}

async function ensureWireguardContainer(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - wgLastCheckAt < WG_READY_TTL_MS) return;

  try {
    const { stdout } = await execAsync(`docker inspect -f "{{.State.Running}}" ${WG_CONTAINER}`);
    if (stdout.trim() === 'true') {
      wgLastCheckAt = now;
      return;
    }

    await execAsync(`docker start ${WG_CONTAINER}`);
    await new Promise(r => setTimeout(r, 3000));
    wgLastCheckAt = Date.now();
    console.log(`[VPN] Started container ${WG_CONTAINER}`);
    return;
  } catch (err: any) {
    const msg = `${err?.stderr || ''} ${err?.message || ''}`;
    if (!isWireguardContainerUnavailable(msg)) {
      throw new Error(`No se pudo verificar WireGuard: ${msg.trim()}`);
    }
  }

  const tz = process.env.TZ || 'America/Bogota';
  const runCmd = [
    'docker run -d',
    `--name ${WG_CONTAINER}`,
    '--restart unless-stopped',
    '--cap-add NET_ADMIN',
    '--cap-add SYS_MODULE',
    '-e PUID=1000',
    '-e PGID=1000',
    `-e TZ='${shellEscape(tz)}'`,
    `-p ${WG_PORT}:51820/udp`,
    '--sysctl net.ipv4.conf.all.src_valid_mark=1',
    '--sysctl net.ipv4.ip_forward=1',
    '-v wireguard_config:/config',
    WG_IMAGE,
  ].join(' ');

  await execAsync(runCmd);
  // Wait for container to fully initialize
  await new Promise(r => setTimeout(r, 5000));
  wgLastCheckAt = Date.now();
  console.log(`[VPN] Created container ${WG_CONTAINER}`);
}

async function wgExec(cmd: string): Promise<string> {
  try {
    await ensureWireguardContainer();
    const { stdout } = await execAsync(`docker exec ${WG_CONTAINER} ${cmd}`);
    return stdout.trim();
  } catch (err: any) {
    const msg = `${err?.stderr || ''} ${err?.message || ''}`;
    if (isWireguardContainerUnavailable(msg)) {
      await ensureWireguardContainer(true);
      const { stdout } = await execAsync(`docker exec ${WG_CONTAINER} ${cmd}`);
      return stdout.trim();
    }
    console.error(`[VPN] exec error: ${msg.trim()}`);
    return '';
  }
}

async function wgExecWithInput(input: string, cmd: string): Promise<string> {
  const escaped = shellEscape(input);

  try {
    await ensureWireguardContainer();
    const { stdout } = await execAsync(
      `printf '%s' '${escaped}' | docker exec -i ${WG_CONTAINER} ${cmd}`
    );
    return stdout.trim();
  } catch (err: any) {
    const msg = `${err?.stderr || ''} ${err?.message || ''}`;
    if (isWireguardContainerUnavailable(msg)) {
      await ensureWireguardContainer(true);
      const { stdout } = await execAsync(
        `printf '%s' '${escaped}' | docker exec -i ${WG_CONTAINER} ${cmd}`
      );
      return stdout.trim();
    }
    throw new Error(`No se pudo ejecutar comando WireGuard: ${msg.trim()}`);
  }
}

async function generateWgKeys(): Promise<{ privateKey: string; publicKey: string; presharedKey: string }> {
  // Retry up to 3 times with delay for container startup
  let privateKey = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    privateKey = (await wgExec('wg genkey')).trim();
    if (privateKey) break;
    console.log(`[VPN] wg genkey attempt ${attempt + 1} failed, retrying...`);
    await new Promise(r => setTimeout(r, 3000));
    await ensureWireguardContainer(true);
  }
  if (!privateKey) {
    throw new Error('WireGuard no está disponible en el servidor. Verifica que Docker esté funcionando correctamente.');
  }

  const publicKey = (await wgExecWithInput(privateKey, 'wg pubkey')).trim();
  const presharedKey = (await wgExec('wg genpsk')).trim();

  if (!publicKey || !presharedKey) {
    throw new Error('No se pudieron generar las claves de WireGuard');
  }

  return { privateKey, publicKey, presharedKey };
}

async function getServerPublicKey(): Promise<string> {
  // Read from wg0.conf or generate
  try {
    const output = await wgExec(`cat ${WG_CONFIG_DIR}/${WG_INTERFACE}.conf`);
    const match = output.match(/PrivateKey\s*=\s*(.+)/);
    if (match) {
      return await wgExecWithInput(match[1].trim(), 'wg pubkey');
    }
  } catch {}
  return '';
}

async function getNextPeerAddress(): Promise<string> {
  const result = await pool.query(
    `SELECT peer_address FROM vpn_peers ORDER BY created_at DESC LIMIT 1`
  );
  if (result.rows.length === 0) return `${WG_SUBNET}.2/32`;
  const lastAddr = result.rows[0].peer_address.split('/')[0];
  const lastOctet = parseInt(lastAddr.split('.')[3]) + 1;
  if (lastOctet > 254) throw new Error('No more available addresses in subnet');
  return `${WG_SUBNET}.${lastOctet}/32`;
}

async function syncWireguardConfig(): Promise<void> {
  // Rebuild wg0.conf from database peers
  const peers = await pool.query(
    `SELECT * FROM vpn_peers WHERE is_active = true ORDER BY created_at`
  );

  // Read server config header
  let serverConf = '';
  try {
    const existing = await wgExec(`cat /config/wg_confs/${WG_INTERFACE}.conf`);
    const interfaceMatch = existing.match(/\[Interface\][\s\S]*?(?=\[Peer\]|$)/);
    if (interfaceMatch) {
      serverConf = interfaceMatch[0].trim();
    }
  } catch {}

  if (!serverConf) {
    // Generate initial server config
    const { privateKey } = await generateWgKeys();
    serverConf = `[Interface]
Address = ${WG_SUBNET}.1/24
ListenPort = ${WG_PORT}
PrivateKey = ${privateKey}
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth+ -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth+ -j MASQUERADE`;
  }

  // Add peers
  let fullConfig = serverConf + '\n';
  for (const peer of peers.rows) {
    const allowedIps = peer.remote_networks
      ? `${peer.peer_address}, ${peer.remote_networks}`
      : peer.peer_address;

    fullConfig += `
# ${peer.name}
[Peer]
PublicKey = ${peer.public_key}
PresharedKey = ${peer.preshared_key || ''}
AllowedIPs = ${allowedIps}
`;
  }

  // Write config via docker exec
  const escaped = fullConfig.replace(/'/g, "'\\''");
  await execAsync(
    `docker exec ${WG_CONTAINER} sh -c 'echo "${escaped.replace(/"/g, '\\"')}" > ${WG_CONFIG_DIR}/${WG_INTERFACE}.conf'`
  );

  // Restart wireguard interface
  await wgExec(`wg-quick down ${WG_INTERFACE} 2>/dev/null || true`);
  await wgExec(`wg-quick up ${WG_INTERFACE}`);
}

// ─── MikroTik Script Generator ───────────────────
function generateMikrotikScript(
  clientPrivateKey: string,
  serverPublicKey: string,
  presharedKey: string,
  serverIp: string,
  clientIp: string
): string {
  return `# ============================================
# OmniSync WireGuard — RouterOS v7
# Peer: ${clientIp}
# Servidor: ${serverIp}:${WG_PORT}
# ============================================

# 1) Eliminar configuración anterior (si existe)
:do { /ip address remove [find where interface=wg-omnisync] } on-error={}
:do { /interface wireguard peers remove [find where interface=wg-omnisync] } on-error={}
:do { /interface wireguard remove [find where name=wg-omnisync] } on-error={}

# 2) Crear interfaz WireGuard
/interface wireguard add name=wg-omnisync listen-port=13231 private-key="${clientPrivateKey}"

# 3) Agregar peer del servidor VPS
/interface wireguard peers add \\
  interface=wg-omnisync \\
  public-key="${serverPublicKey}" \\
  preshared-key="${presharedKey}" \\
  endpoint-address=${serverIp} \\
  endpoint-port=${WG_PORT} \\
  allowed-address=${WG_SUBNET}.0/24 \\
  persistent-keepalive=25

# 4) Asignar IP al túnel
/ip address add address=${clientIp}/24 interface=wg-omnisync

# 5) Firewall: permitir acceso API desde el VPS por el túnel
:do { /ip firewall filter remove [find where comment="omnisync-vpn-api"] } on-error={}
/ip firewall filter add \\
  chain=input \\
  src-address=${WG_SUBNET}.0/24 \\
  protocol=tcp \\
  dst-port=8728,8729,8738,80,443 \\
  action=accept \\
  comment="omnisync-vpn-api" \\
  place-before=0

# 6) Verificar conectividad (esperar 5s)
:delay 5s
:do { /ping ${WG_SUBNET}.1 count=3 } on-error={ :log warning "WireGuard: no se pudo hacer ping al servidor VPS" }

:log info "WireGuard OmniSync configurado exitosamente (${clientIp})"`;
}

// ─── GET /status ──────────────────────────────────
vpnRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const wgOutput = await wgExec('wg show all dump');
    const serverPubKey = await getServerPublicKey();

    // Parse WG output for status
    const lines = wgOutput.split('\n').filter(Boolean);
    let serverUp = false;
    const peerStatus: Record<string, any> = {};

    for (const line of lines) {
      const parts = line.split('\t');

      if (parts[0] === WG_INTERFACE && parts.length === 5) {
        // Interface line: interface, private_key, public_key, listen_port, fwmark
        serverUp = true;
        continue;
      }

      if (parts.length >= 8) {
        // Peer line: interface, public_key, preshared_key, endpoint, allowed_ips, latest_handshake, transfer_rx, transfer_tx
        peerStatus[parts[1]] = {
          endpoint: parts[3] === '(none)' ? null : parts[3],
          lastHandshake: parts[5] !== '0' ? new Date(parseInt(parts[5]) * 1000).toISOString() : null,
          transferRx: parseInt(parts[6]) || 0,
          transferTx: parseInt(parts[7]) || 0,
        };
      }
    }

    // Get VPS public IP
    const publicIp = await getPublicIp(getRequestHost(req));

    res.json({
      serverUp,
      serverPublicKey: serverPubKey,
      publicIp,
      listenPort: WG_PORT,
      subnet: `${WG_SUBNET}.0/24`,
      peerStatus,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /peers ───────────────────────────────────
vpnRouter.get('/peers', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const userRole = (req as any).userRole;

    let query = `SELECT vp.*, md.name as mikrotik_name FROM vpn_peers vp
                 LEFT JOIN mikrotik_devices md ON vp.mikrotik_id = md.id`;
    let params: any[] = [];

    if (userRole !== 'super_admin') {
      query += ` WHERE vp.created_by = $1`;
      params = [userId];
    }

    query += ` ORDER BY vp.created_at DESC`;
    const result = await pool.query(query, params);

    // Enrich with live status
    const wgOutput = await wgExec('wg show all dump');
    const peerStatus: Record<string, any> = {};
    for (const line of wgOutput.split('\n')) {
      const parts = line.split('\t');
      if (parts.length >= 8) {
        peerStatus[parts[1]] = {
          endpoint: parts[3] === '(none)' ? null : parts[3],
          lastHandshake: parts[5] !== '0' ? new Date(parseInt(parts[5]) * 1000).toISOString() : null,
          transferRx: parseInt(parts[6]) || 0,
          transferTx: parseInt(parts[7]) || 0,
        };
      }
    }

    const enriched = result.rows.map(peer => ({
      ...peer,
      live: peerStatus[peer.public_key] || null,
    }));

    res.json(enriched);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /peers ──────────────────────────────────
vpnRouter.post('/peers', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { name, description, mikrotik_id, remote_networks } = req.body;

    if (!name) return res.status(400).json({ error: 'Name is required' });

    const keys = await generateWgKeys();
    const peerAddress = await getNextPeerAddress();

    const result = await pool.query(
      `INSERT INTO vpn_peers (created_by, name, description, mikrotik_id, public_key, private_key, preshared_key, peer_address, remote_networks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [userId, name, description || null, mikrotik_id || null, keys.publicKey, keys.privateKey, keys.presharedKey, peerAddress, remote_networks || null]
    );

    // Sync WireGuard config
    await syncWireguardConfig();

    // Auto-update MikroTik host with VPN IP if associated
    const peer = result.rows[0];
    if (mikrotik_id) {
      const vpnIp = peerAddress.split('/')[0]; // e.g. 10.13.13.2
      const prevDevice = await pool.query(`SELECT host FROM mikrotik_devices WHERE id = $1`, [mikrotik_id]);
      const previousHost = prevDevice.rows[0]?.host;
      await pool.query(
        `UPDATE mikrotik_devices SET host = $1, updated_at = now() WHERE id = $2`,
        [vpnIp, mikrotik_id]
      );
      console.log(`[VPN] Auto-updated MikroTik ${mikrotik_id} host: ${previousHost} → ${vpnIp}`);
    }

    // Generate client config
    const serverPubKey = await getServerPublicKey();
    const publicIp = await getPublicIp(getRequestHost(req));
    if (!publicIp) {
      return res.status(500).json({ error: 'No se pudo detectar la IP pública del VPS. Configure VPS_PUBLIC_IP en el .env' });
    }

    const clientConfig = `[Interface]
PrivateKey = ${keys.privateKey}
Address = ${peerAddress}
DNS = 1.1.1.1, 8.8.8.8

[Peer]
PublicKey = ${serverPubKey}
PresharedKey = ${keys.presharedKey}
Endpoint = ${publicIp}:${WG_PORT}
AllowedIPs = ${WG_SUBNET}.0/24${remote_networks ? '' : ''}
PersistentKeepalive = 25`;

    const peerIp = peerAddress.split('/')[0];
    const mikrotikScript = generateMikrotikScript(keys.privateKey, serverPubKey, keys.presharedKey, publicIp, peerIp);

    res.json({
      peer,
      clientConfig,
      mikrotikScript,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /peers/:id/config ────────────────────────
vpnRouter.get('/peers/:id/config', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).userId;
    const userRole = (req as any).userRole;

    let query = `SELECT * FROM vpn_peers WHERE id = $1`;
    const params: any[] = [id];
    if (userRole !== 'super_admin') {
      query += ` AND created_by = $2`;
      params.push(userId);
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Peer not found' });

    const peer = result.rows[0];
    const serverPubKey = await getServerPublicKey();
    const publicIp = await getPublicIp(getRequestHost(req));
    if (!publicIp) {
      return res.status(500).json({ error: 'No se pudo detectar la IP pública del VPS. Configure VPS_PUBLIC_IP en el .env' });
    }

    const clientConfig = `[Interface]
PrivateKey = ${peer.private_key}
Address = ${peer.peer_address}
DNS = 1.1.1.1, 8.8.8.8

[Peer]
PublicKey = ${serverPubKey}
PresharedKey = ${peer.preshared_key}
Endpoint = ${publicIp}:${WG_PORT}
AllowedIPs = ${WG_SUBNET}.0/24
PersistentKeepalive = 25`;

    const peerIp = peer.peer_address.split('/')[0];
    const mikrotikScript = generateMikrotikScript(peer.private_key, serverPubKey, peer.preshared_key, publicIp, peerIp);

    res.json({ clientConfig, mikrotikScript, peer });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── PUT /peers/:id ───────────────────────────────
vpnRouter.put('/peers/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const userRole = req.userRole!;
    const { name, description, mikrotik_id, remote_networks, is_active } = req.body;

    const peerBeforeUpdate = await pool.query(
      `SELECT id, created_by, mikrotik_id, peer_address FROM vpn_peers WHERE id = $1`,
      [id]
    );
    if (peerBeforeUpdate.rows.length === 0) return res.status(404).json({ error: 'Peer not found' });

    const existingPeer = peerBeforeUpdate.rows[0];
    if (userRole !== 'super_admin' && existingPeer.created_by !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (mikrotik_id) {
      const hasDeviceAccess = await verifyDeviceAccess(userId, userRole, mikrotik_id);
      if (!hasDeviceAccess) {
        return res.status(403).json({ error: 'Sin acceso al MikroTik seleccionado' });
      }
    }

    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (name !== undefined) { sets.push(`name = $${idx++}`); values.push(name); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); values.push(description); }
    if (mikrotik_id !== undefined) { sets.push(`mikrotik_id = $${idx++}`); values.push(mikrotik_id || null); }
    if (remote_networks !== undefined) { sets.push(`remote_networks = $${idx++}`); values.push(remote_networks || null); }
    if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); values.push(is_active); }

    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

    const updateQuery = `UPDATE vpn_peers SET ${sets.join(', ')}, updated_at = now() WHERE id = $${idx++} RETURNING *`;
    values.push(id);

    const result = await pool.query(updateQuery, values);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Peer not found' });

    const updatedPeer = result.rows[0];

    if (mikrotik_id !== undefined && updatedPeer.mikrotik_id) {
      const vpnIp = (updatedPeer.peer_address || '').split('/')[0];
      if (vpnIp) {
        await pool.query(
          `UPDATE mikrotik_devices SET host = $1, updated_at = now() WHERE id = $2`,
          [vpnIp, updatedPeer.mikrotik_id]
        );
        console.log(`[VPN] Updated MikroTik ${updatedPeer.mikrotik_id} host to VPN IP ${vpnIp}`);
      }
    }

    await syncWireguardConfig();
    res.json(updatedPeer);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── DELETE /peers/:id ────────────────────────────
vpnRouter.delete('/peers/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).userId;
    const userRole = (req as any).userRole;

    // First fetch the peer to check mikrotik association
    const peerResult = await pool.query(`SELECT * FROM vpn_peers WHERE id = $1`, [id]);
    if (peerResult.rows.length === 0) return res.status(404).json({ error: 'Peer not found' });
    const peer = peerResult.rows[0];

    if (userRole !== 'super_admin' && peer.created_by !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await pool.query(`DELETE FROM vpn_peers WHERE id = $1`, [id]);

    // Warn if MikroTik host was using this VPN IP
    let hostWarning: string | null = null;
    if (peer.mikrotik_id) {
      const vpnIp = peer.peer_address.split('/')[0];
      const device = await pool.query(`SELECT host, name FROM mikrotik_devices WHERE id = $1`, [peer.mikrotik_id]);
      if (device.rows[0]?.host === vpnIp) {
        hostWarning = `El dispositivo "${device.rows[0].name}" aún usa la IP VPN ${vpnIp} como host. Actualízalo manualmente.`;
      }
    }

    await syncWireguardConfig();
    res.json({ success: true, warning: hostWarning });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /init ───────────────────────────────────
// Initialize WireGuard server if not already set up
vpnRouter.post('/init', async (req: Request, res: Response) => {
  try {
    const serverPubKey = await getServerPublicKey();
    if (serverPubKey) {
      return res.json({ message: 'WireGuard already initialized', publicKey: serverPubKey });
    }
    await syncWireguardConfig();
    const newKey = await getServerPublicKey();
    res.json({ message: 'WireGuard initialized', publicKey: newKey });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export { vpnRouter };
