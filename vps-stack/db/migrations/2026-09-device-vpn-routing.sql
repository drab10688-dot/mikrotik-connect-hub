-- MikroTik: conserva el host local al asociar un peer WireGuard.
-- La conexión activa usa siempre host = IP del peer VPN.
ALTER TABLE mikrotik_devices ADD COLUMN IF NOT EXISTS direct_host TEXT;
