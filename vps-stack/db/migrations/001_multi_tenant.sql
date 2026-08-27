-- ============================================
-- OmniSync · Multi-tenant (Empresas)
-- Idempotente: seguro de ejecutar en instalaciones existentes
-- ============================================

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  tax_id TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  logo_url TEXT,
  plan TEXT DEFAULT 'standard',
  max_devices INTEGER DEFAULT 0,
  max_clients INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Empresa por defecto para los datos ya existentes
INSERT INTO companies (name, plan)
SELECT 'Empresa Principal', 'standard'
WHERE NOT EXISTS (SELECT 1 FROM companies);

-- Columna company_id en todas las entidades de negocio
ALTER TABLE users             ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE mikrotik_devices  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE isp_clients       ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE client_invoices   ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE isp_contracts     ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE vouchers          ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE onu_devices       ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE ubiquiti_devices  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE vpn_peers         ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- Backfill: todo lo existente pertenece a la primera empresa
DO $$
DECLARE
  default_company UUID;
BEGIN
  SELECT id INTO default_company FROM companies ORDER BY created_at LIMIT 1;
  IF default_company IS NULL THEN RETURN; END IF;

  UPDATE users            SET company_id = default_company WHERE company_id IS NULL;
  UPDATE mikrotik_devices SET company_id = default_company WHERE company_id IS NULL;

  UPDATE isp_clients c     SET company_id = d.company_id FROM mikrotik_devices d WHERE d.id = c.mikrotik_id AND c.company_id IS NULL;
  UPDATE client_invoices i SET company_id = d.company_id FROM mikrotik_devices d WHERE d.id = i.mikrotik_id AND i.company_id IS NULL;
  UPDATE isp_contracts ct  SET company_id = d.company_id FROM mikrotik_devices d WHERE d.id = ct.mikrotik_id AND ct.company_id IS NULL;
  UPDATE vouchers v        SET company_id = d.company_id FROM mikrotik_devices d WHERE d.id = v.mikrotik_id AND v.company_id IS NULL;
  UPDATE onu_devices o     SET company_id = d.company_id FROM mikrotik_devices d WHERE d.id = o.mikrotik_id AND o.company_id IS NULL;

  UPDATE ubiquiti_devices SET company_id = default_company WHERE company_id IS NULL;
  UPDATE vpn_peers        SET company_id = default_company WHERE company_id IS NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_company            ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_mikrotik_devices_company ON mikrotik_devices(company_id);
CREATE INDEX IF NOT EXISTS idx_isp_clients_company      ON isp_clients(company_id);
CREATE INDEX IF NOT EXISTS idx_client_invoices_company  ON client_invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_isp_contracts_company    ON isp_contracts(company_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_company         ON vouchers(company_id);
CREATE INDEX IF NOT EXISTS idx_onu_devices_company      ON onu_devices(company_id);

-- Hereda company_id del dispositivo al insertar entidades hijas
CREATE OR REPLACE FUNCTION inherit_company_from_device()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.mikrotik_id IS NOT NULL THEN
    SELECT company_id INTO NEW.company_id FROM mikrotik_devices WHERE id = NEW.mikrotik_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['isp_clients','client_invoices','isp_contracts','vouchers','onu_devices'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %s_inherit_company ON %I', t, t);
    EXECUTE format('CREATE TRIGGER %s_inherit_company BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION inherit_company_from_device()', t, t);
  END LOOP;
END $$;

-- updated_at de companies
DROP TRIGGER IF EXISTS update_companies_updated_at ON companies;
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
