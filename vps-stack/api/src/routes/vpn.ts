import { Router, Request, Response } from 'express';
import { pool } from '../server';
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

// ─── Helpers ──────────────────────────────────────
async function wgExec(cmd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`docker exec omnisync-wireguard ${cmd}`);
    return stdout.trim();
  } catch (err: any) {
    console.error(`[VPN] exec error: ${err.message}`);
    return '';
  }
}

async function generateWgKeys(): Promise<{ privateKey: string; publicKey: string; presharedKey: string }> {
  const privateKey = (await wgExec('wg genkey')).trim();
  // Use echo pipe to get public key
  const { stdout: publicKey } = await execAsync(
    `echo "${privateKey}" | docker exec -i omnisync-wireguard wg pubkey`
  );
  const presharedKey = (await wgExec('wg genpsk')).trim();
  return { privateKey, publicKey: publicKey.trim(), presharedKey };
}

async function getServerPublicKey(): Promise<string> {
  // Read from wg0.conf or generate
  try {
    const output = await wgExec(`cat /config/wg_confs/${WG_INTERFACE}.conf`);
    const match = output.match(/PrivateKey\s*=\s*(.+)/);
    if (match) {
      const { stdout } = await execAsync(
        `echo "${match[1].trim()}" | docker exec -i omnisync-wireguard wg pubkey`
      );
      return stdout.trim();
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
    `docker exec omnisync-wireguard sh -c 'echo "${escaped.replace(/"/g, '\\"')}" > /config/wg_confs/${WG_INTERFACE}.conf'`
  );

  // Restart wireguard interface
  await wgExec(`wg-quick down ${WG_INTERFACE} 2>/dev/null || true`);
  await wgExec(`wg-quick up ${WG_INTERFACE}`);
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
      if (parts.length >= 4) {
        if (parts[0] === WG_INTERFACE && parts.length === 4) {
          serverUp = true;
        } else if (parts.length >= 8) {
          // Peer line: interface, public_key, preshared_key, endpoint, allowed_ips, latest_handshake, transfer_rx, transfer_tx
          peerStatus[parts[1]] = {
            endpoint: parts[3] === '(none)' ? null : parts[3],
            lastHandshake: parts[5] !== '0' ? new Date(parseInt(parts[5]) * 1000).toISOString() : null,
            transferRx: parseInt(parts[6]) || 0,
            transferTx: parseInt(parts[7]) || 0,
          };
        }
      }
    }

    // Get VPS public IP
    let publicIp = '';
    try {
      const { stdout } = await execAsync('curl -s -4 ifconfig.me 2>/dev/null || hostname -I | awk \'{print $1}\'');
      publicIp = stdout.trim();
    } catch {}

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
    let publicIp = '';
    try {
      const { stdout } = await execAsync('curl -s -4 ifconfig.me 2>/dev/null || hostname -I | awk \'{print $1}\'');
      publicIp = stdout.trim();
    } catch {}

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

    // Generate MikroTik script for RouterOS v7
    const mikrotikScript = `/interface wireguard add name=wg-omnisync listen-port=13231 private-key="${keys.privateKey}"
/interface wireguard peers add interface=wg-omnisync public-key="${serverPubKey}" preshared-key="${keys.presharedKey}" endpoint-address=${publicIp} endpoint-port=${WG_PORT} allowed-address=${WG_SUBNET}.0/24 persistent-keepalive=25
/ip address add address=${peerAddress.replace('/32', '/24')} interface=wg-omnisync
# Ruta hacia la red del VPN server
/ip route add dst-address=${WG_SUBNET}.0/24 gateway=wg-omnisync`;

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
    let publicIp = '';
    try {
      const { stdout } = await execAsync('curl -s -4 ifconfig.me 2>/dev/null || hostname -I | awk \'{print $1}\'');
      publicIp = stdout.trim();
    } catch {}

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

    const mikrotikScript = `/interface wireguard add name=wg-omnisync listen-port=13231 private-key="${peer.private_key}"
/interface wireguard peers add interface=wg-omnisync public-key="${serverPubKey}" preshared-key="${peer.preshared_key}" endpoint-address=${publicIp} endpoint-port=${WG_PORT} allowed-address=${WG_SUBNET}.0/24 persistent-keepalive=25
/ip address add address=${peer.peer_address.replace('/32', '/24')} interface=wg-omnisync
/ip route add dst-address=${WG_SUBNET}.0/24 gateway=wg-omnisync`;

    res.json({ clientConfig, mikrotikScript, peer });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── PUT /peers/:id ───────────────────────────────
vpnRouter.put('/peers/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).userId;
    const userRole = (req as any).userRole;
    const { name, description, mikrotik_id, remote_networks, is_active } = req.body;

    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (name !== undefined) { sets.push(`name = $${idx++}`); values.push(name); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); values.push(description); }
    if (mikrotik_id !== undefined) { sets.push(`mikrotik_id = $${idx++}`); values.push(mikrotik_id || null); }
    if (remote_networks !== undefined) { sets.push(`remote_networks = $${idx++}`); values.push(remote_networks || null); }
    if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); values.push(is_active); }

    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

    let query = `UPDATE vpn_peers SET ${sets.join(', ')}, updated_at = now() WHERE id = $${idx++}`;
    values.push(id);
    if (userRole !== 'super_admin') {
      query += ` AND created_by = $${idx++}`;
      values.push(userId);
    }
    query += ` RETURNING *`;

    const result = await pool.query(query, values);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Peer not found' });

    await syncWireguardConfig();
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── DELETE /peers/:id ────────────────────────────
vpnRouter.delete('/peers/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;

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
