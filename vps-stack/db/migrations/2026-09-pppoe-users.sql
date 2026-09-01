-- ============================================================
-- OmniSync — Usuarios PPPoE con contraseña global por ISP
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS pppoe_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  mikrotik_id UUID REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  global_password TEXT,
  use_global_password BOOLEAN NOT NULL DEFAULT true,
  default_profile TEXT,
  default_service TEXT NOT NULL DEFAULT 'pppoe',
  username_prefix TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (mikrotik_id)
);

CREATE INDEX IF NOT EXISTS pppoe_settings_tenant_idx ON pppoe_settings(tenant_id);

-- ─── Nueva sección de permisos: usuarios PPPoE ──────────────
INSERT INTO role_permissions (tenant_id, role, section, can_view, can_edit)
SELECT t.id, r.role, 'pppoe',
       r.role IN ('admin', 'user', 'secretary'),
       r.role IN ('admin', 'user')
  FROM tenants t
  CROSS JOIN (VALUES ('admin'), ('user'), ('secretary'), ('reseller')) AS r(role)
ON CONFLICT (tenant_id, role, section) DO NOTHING;

-- El administrador del ISP nunca debe poder bloquearse a sí mismo
UPDATE role_permissions
   SET can_view = true, can_edit = true
 WHERE role = 'admin'
   AND section IN ('dashboard', 'usuarios', 'roles');

-- ─── Asignación automática de IP remota (rango del ISP) ─────
ALTER TABLE pppoe_settings ADD COLUMN IF NOT EXISTS auto_assign_ip BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE pppoe_settings ADD COLUMN IF NOT EXISTS ip_pool_start TEXT;
ALTER TABLE pppoe_settings ADD COLUMN IF NOT EXISTS ip_pool_end TEXT;

-- ─── Auditoría de usuarios PPPoE (quién creó / compartió / eliminó) ─────
CREATE TABLE IF NOT EXISTS pppoe_audit (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID,
  mikrotik_id UUID,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  actor_id UUID,
  actor_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pppoe_audit_device_idx ON pppoe_audit(mikrotik_id, created_at DESC);
