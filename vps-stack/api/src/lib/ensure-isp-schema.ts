import type { Pool } from 'pg';

/**
 * Crea/actualiza el esquema multi-ISP para gestión de ONUs.
 * Idempotente: se ejecuta en cada arranque del API.
 */
export async function ensureIspSchema(pool: Pool): Promise<void> {
  const statements: string[] = [
    `CREATE EXTENSION IF NOT EXISTS pgcrypto`,

    // ISP: token TR-069 propio + subred VPN
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS acs_token TEXT`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vpn_subnet TEXT`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onu_networks TEXT`,
    // Límite comercial de ONUs por ISP (NULL o 0 = ilimitado)
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onu_limit INTEGER`,

    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS acs_username TEXT`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS acs_password TEXT`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cr_username TEXT`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cr_password TEXT`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stun_host TEXT`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stun_port INTEGER`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stun_username TEXT`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stun_password TEXT`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inform_interval INTEGER`,
    `UPDATE tenants SET acs_token = encode(gen_random_bytes(8), 'hex') WHERE acs_token IS NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS tenants_acs_token_key ON tenants(acs_token)`,
    `WITH numbered AS (
       SELECT id, 13 + (row_number() OVER (ORDER BY created_at))::int AS octet
       FROM tenants WHERE vpn_subnet IS NULL
     )
     UPDATE tenants t SET vpn_subnet = '10.13.' || n.octet || '.0/24'
     FROM numbered n WHERE t.id = n.id`,

    // ONUs por ISP + alias editable
    `ALTER TABLE onu_devices ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE`,
    `ALTER TABLE onu_devices ADD COLUMN IF NOT EXISTS alias TEXT`,
    `ALTER TABLE onu_devices ADD COLUMN IF NOT EXISTS last_inform TIMESTAMPTZ`,
    `ALTER TABLE onu_devices ADD COLUMN IF NOT EXISTS rx_power NUMERIC`,
    `ALTER TABLE onu_devices ADD COLUMN IF NOT EXISTS tx_power NUMERIC`,
    `CREATE INDEX IF NOT EXISTS onu_devices_tenant_idx ON onu_devices(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS onu_devices_acs_idx ON onu_devices(acs_device_id)`,
    `UPDATE onu_devices o SET tenant_id = d.tenant_id
       FROM mikrotik_devices d
      WHERE o.mikrotik_id = d.id AND o.tenant_id IS NULL AND d.tenant_id IS NOT NULL`,

    // Permisos por rol y sección
    `CREATE TABLE IF NOT EXISTS role_permissions (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
       role TEXT NOT NULL,
       section TEXT NOT NULL,
       can_view BOOLEAN NOT NULL DEFAULT false,
       can_edit BOOLEAN NOT NULL DEFAULT false,
       created_at TIMESTAMPTZ DEFAULT now(),
       updated_at TIMESTAMPTZ DEFAULT now(),
       UNIQUE (tenant_id, role, section)
     )`,
    `INSERT INTO role_permissions (tenant_id, role, section, can_view, can_edit)
     SELECT t.id, r.role, s.section, true, r.role = 'admin'
       FROM tenants t
       CROSS JOIN (VALUES ('admin'), ('user')) AS r(role)
       CROSS JOIN (VALUES ('onus'),('wifi'),('pppoe'),('red'),('firmware'),('vpn'),('usuarios')) AS s(section)
     ON CONFLICT (tenant_id, role, section) DO NOTHING`,

    // Túnel VPN por ISP
    `CREATE TABLE IF NOT EXISTS tenant_vpn_peers (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
     )`,

    // Historial de la ONU
    `CREATE TABLE IF NOT EXISTS onu_events (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
       acs_device_id TEXT,
       event_type TEXT NOT NULL,
       detail TEXT,
       created_by UUID REFERENCES users(id) ON DELETE SET NULL,
       created_at TIMESTAMPTZ DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS onu_events_tenant_idx ON onu_events(tenant_id, created_at DESC)`,

    // Propiedad de cada ONU del ACS: define qué ISP la ve (aislamiento real)
    `CREATE TABLE IF NOT EXISTS acs_device_owners (
       acs_device_id TEXT PRIMARY KEY,
       tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
       serial_number TEXT,
       source TEXT,
       status TEXT NOT NULL DEFAULT 'active',
       claimed_at TIMESTAMPTZ DEFAULT now(),
       updated_at TIMESTAMPTZ DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS acs_device_owners_tenant_idx ON acs_device_owners(tenant_id, status)`,
  ];


  for (const sql of statements) {
    try {
      await pool.query(sql);
    } catch (error: any) {
      console.warn('[SCHEMA] isp:', error.message);
    }
  }
}
