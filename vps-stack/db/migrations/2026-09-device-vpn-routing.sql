-- MikroTik: conserva el host local al asociar un peer WireGuard.
-- La conexión activa usa siempre host = IP del peer VPN.
ALTER TABLE mikrotik_devices ADD COLUMN IF NOT EXISTS direct_host TEXT;
ALTER TABLE mikrotik_devices ADD COLUMN IF NOT EXISTS l2tp_peer_id UUID REFERENCES tenant_vpn_peers(id) ON DELETE SET NULL;
UPDATE mikrotik_devices SET direct_host = host WHERE direct_host IS NULL;
CREATE INDEX IF NOT EXISTS mikrotik_devices_l2tp_peer_idx ON mikrotik_devices(l2tp_peer_id);
