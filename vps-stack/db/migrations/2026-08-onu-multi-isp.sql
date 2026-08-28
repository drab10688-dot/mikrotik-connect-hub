-- ============================================================
-- OmniSync ONU — Rebuild multi-ISP (GenieACS + VPN + TR-069)
-- Idempotente: se puede ejecutar sobre instalaciones existentes.
-- ============================================================

-- ─── ISP (tenant): token TR-069 propio + subred VPN ─────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS acs_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vpn_subnet TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onu_networks TEXT;

UPDATE tenants
   SET acs_token = encode(gen_random_bytes(8), 'hex')
 WHERE acs_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_acs_token_key ON tenants(acs_token);

-- Subred VPN /24 única por ISP: 10.13.<n>.0/24
WITH numbered AS (
  SELECT id, 13 + (row_number() OVER (ORDER BY created_at))::int AS octet
  FROM tenants WHERE vpn_subnet IS NULL
)
UPDATE tenants t
   SET vpn_subnet = '10.13.' || n.octet || '.0/24'
  FROM numbered n
 WHERE t.id = n.id;

-- ─── ONUs con dueño (ISP) y alias editable ──────────────────
ALTER TABLE onu_devices ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE onu_devices ADD COLUMN IF NOT EXISTS alias TEXT;
ALTER TABLE onu_devices ADD COLUMN IF NOT EXISTS last_inform TIMESTAMPTZ;
ALTER TABLE onu_devices ADD COLUMN IF NOT EXISTS rx_power NUMERIC;
ALTER TABLE onu_devices ADD COLUMN IF NOT EXISTS tx_power NUMERIC;

CREATE INDEX IF NOT EXISTS onu_devices_tenant_idx ON onu_devices(tenant_id);
CREATE INDEX IF NOT EXISTS onu_devices_acs_idx ON onu_devices(acs_device_id);

-- Rellena tenant_id desde el MikroTik dueño de la ONU
UPDATE onu_devices o
   SET tenant_id = d.tenant_id
  FROM mikrotik_devices d
 WHERE o.mikrotik_id = d.id AND o.tenant_id IS NULL AND d.tenant_id IS NOT NULL;

-- ─── Permisos por rol y sección, dentro de cada ISP ─────────
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  section TEXT NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT false,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, role, section)
);

CREATE INDEX IF NOT EXISTS role_permissions_tenant_idx ON role_permissions(tenant_id);

-- Permisos por defecto: admin todo, user solo lectura de ONUs
INSERT INTO role_permissions (tenant_id, role, section, can_view, can_edit)
SELECT t.id, r.role, s.section,
       true,
       r.role = 'admin'
  FROM tenants t
  CROSS JOIN (VALUES ('admin'), ('user')) AS r(role)
  CROSS JOIN (VALUES ('onus'), ('wifi'), ('pppoe'), ('red'), ('firmware'), ('vpn'), ('usuarios')) AS s(section)
ON CONFLICT (tenant_id, role, section) DO NOTHING;

-- ─── Túnel VPN por ISP (credenciales persistentes) ──────────
CREATE TABLE IF NOT EXISTS tenant_vpn_peers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  vpn_type TEXT NOT NULL DEFAULT 'l2tp',
  tunnel_ip TEXT,
  psk TEXT,
  username TEXT,
  password TEXT,
  public_key TEXT,
  private_key TEXT,
  onu_networks TEXT,
  last_handshake TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS tenant_vpn_peers_tenant_idx ON tenant_vpn_peers(tenant_id);

-- ─── Historial de cambios/estado de la ONU ──────────────────
CREATE TABLE IF NOT EXISTS onu_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  acs_device_id TEXT,
  event_type TEXT NOT NULL,
  detail TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS onu_events_tenant_idx ON onu_events(tenant_id, created_at DESC);
