-- ============================================
-- OmniSync ISP Manager - PostgreSQL Schema
-- ============================================

-- Extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- ENUM Types
-- ============================================
CREATE TYPE app_role AS ENUM ('super_admin', 'admin', 'user', 'reseller', 'secretary');
CREATE TYPE billing_type AS ENUM ('advance', 'due');
CREATE TYPE invoice_status AS ENUM ('pending', 'paid', 'overdue', 'cancelled');
CREATE TYPE voucher_status AS ENUM ('available', 'sold', 'active', 'expired', 'used');
CREATE TYPE connection_type AS ENUM ('pppoe', 'hotspot', 'static', 'dhcp');
CREATE TYPE device_status AS ENUM ('active', 'pending', 'inactive');

-- ============================================
-- Users & Auth
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, role)
);

-- ============================================
-- MikroTik Devices
-- ============================================
CREATE TABLE mikrotik_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER DEFAULT 443,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  version TEXT DEFAULT 'v7',
  status device_status DEFAULT 'active',
  hotspot_url TEXT DEFAULT 'http://192.168.88.1/login',
  latitude TEXT,
  longitude TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_mikrotik_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  granted_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, mikrotik_id)
);

CREATE TABLE secretary_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  secretary_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES users(id),
  can_manage_pppoe BOOLEAN DEFAULT true,
  can_create_pppoe BOOLEAN DEFAULT true,
  can_edit_pppoe BOOLEAN DEFAULT true,
  can_delete_pppoe BOOLEAN DEFAULT true,
  can_disconnect_pppoe BOOLEAN DEFAULT true,
  can_toggle_pppoe BOOLEAN DEFAULT true,
  can_manage_queues BOOLEAN DEFAULT true,
  can_create_queues BOOLEAN DEFAULT true,
  can_edit_queues BOOLEAN DEFAULT true,
  can_delete_queues BOOLEAN DEFAULT true,
  can_toggle_queues BOOLEAN DEFAULT true,
  can_suspend_queues BOOLEAN DEFAULT true,
  can_reactivate_queues BOOLEAN DEFAULT true,
  can_manage_clients BOOLEAN DEFAULT true,
  can_manage_payments BOOLEAN DEFAULT true,
  can_manage_billing BOOLEAN DEFAULT true,
  can_manage_reports BOOLEAN DEFAULT true,
  can_manage_hotspot BOOLEAN DEFAULT true,
  can_manage_address_list BOOLEAN DEFAULT true,
  can_manage_backup BOOLEAN DEFAULT true,
  can_manage_vps_services BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(secretary_id, mikrotik_id)
);

CREATE TABLE reseller_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reseller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES users(id),
  commission_percentage NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(reseller_id, mikrotik_id)
);

-- ============================================
-- ISP Clients
-- ============================================
CREATE TABLE isp_clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  client_name TEXT NOT NULL,
  identification_number TEXT,
  username TEXT NOT NULL,
  connection_type connection_type NOT NULL DEFAULT 'pppoe',
  plan_or_speed TEXT,
  assigned_ip TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  latitude TEXT,
  longitude TEXT,
  comment TEXT,
  service_option TEXT,
  service_price NUMERIC DEFAULT 0,
  total_monthly_price NUMERIC DEFAULT 0,
  telegram_chat_id TEXT,
  is_potential_client BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Company Info
-- ============================================
CREATE TABLE company_info (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  company_name TEXT,
  nit TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  logo_url TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(mikrotik_id)
);

-- ============================================
-- Billing & Invoices
-- ============================================
CREATE TABLE billing_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  billing_type billing_type DEFAULT 'advance',
  billing_day INTEGER DEFAULT 1,
  invoice_maturity_days INTEGER DEFAULT 15,
  grace_period_days INTEGER DEFAULT 5,
  reminder_days_before INTEGER DEFAULT 3,
  suspension_address_list TEXT DEFAULT 'morosos',
  auto_send_telegram BOOLEAN DEFAULT false,
  auto_send_whatsapp BOOLEAN DEFAULT false,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(mikrotik_id)
);

CREATE TABLE client_billing_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES isp_clients(id) ON DELETE CASCADE,
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  billing_day INTEGER DEFAULT 1,
  monthly_amount NUMERIC NOT NULL,
  grace_period_days INTEGER DEFAULT 5,
  reminder_days_before INTEGER DEFAULT 3,
  is_suspended BOOLEAN DEFAULT false,
  suspended_at TIMESTAMPTZ,
  last_payment_date DATE,
  next_billing_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id)
);

CREATE TABLE client_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  client_id UUID REFERENCES isp_clients(id) ON DELETE SET NULL,
  contract_id UUID,
  invoice_number TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  status invoice_status DEFAULT 'pending',
  due_date DATE NOT NULL,
  billing_period_start DATE NOT NULL,
  billing_period_end DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  paid_via TEXT,
  payment_reference TEXT,
  service_breakdown JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE payment_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES client_invoices(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT DEFAULT 'COP',
  status TEXT DEFAULT 'pending',
  transaction_id TEXT,
  external_reference TEXT,
  payer_name TEXT,
  payer_email TEXT,
  raw_response JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Contracts
-- ============================================
CREATE TABLE isp_contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  client_id UUID REFERENCES isp_clients(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  contract_number TEXT NOT NULL,
  client_name TEXT NOT NULL,
  identification TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  plan TEXT NOT NULL,
  speed TEXT,
  price TEXT,
  service_option TEXT,
  service_price TEXT,
  total_price TEXT,
  equipment TEXT[],
  status TEXT DEFAULT 'draft',
  client_signature_url TEXT,
  manager_signature_url TEXT,
  pdf_url TEXT,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Vouchers
-- ============================================
CREATE TABLE voucher_presets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  validity TEXT NOT NULL,
  price NUMERIC DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vouchers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  code TEXT NOT NULL,
  password TEXT NOT NULL,
  profile TEXT NOT NULL,
  validity TEXT,
  price NUMERIC,
  status voucher_status DEFAULT 'available',
  mikrotik_user_id TEXT,
  sold_by UUID REFERENCES users(id),
  sold_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE voucher_sales_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  sold_by UUID REFERENCES users(id),
  voucher_code TEXT NOT NULL,
  voucher_password TEXT NOT NULL,
  profile TEXT NOT NULL,
  validity TEXT NOT NULL,
  price NUMERIC DEFAULT 0,
  total_uptime TEXT,
  sold_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Service Options
-- ============================================
CREATE TABLE service_options (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC DEFAULT 0,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Payment Platforms
-- ============================================
CREATE TABLE payment_platforms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL,
  public_key TEXT,
  private_key TEXT,
  webhook_secret TEXT,
  environment TEXT DEFAULT 'sandbox',
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Messaging Config
-- ============================================
CREATE TABLE telegram_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  bot_token TEXT NOT NULL,
  bot_username TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(mikrotik_id)
);

CREATE TABLE whatsapp_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  access_token TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  business_account_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(mikrotik_id)
);

-- ============================================
-- Cloudflare / Tunnel Config
-- ============================================
CREATE TABLE cloudflare_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  mode TEXT DEFAULT 'free',
  agent_host TEXT,
  agent_port INTEGER DEFAULT 3847,
  agent_secret TEXT,
  tunnel_name TEXT,
  tunnel_url TEXT,
  tunnel_id TEXT,
  domain TEXT,
  api_token TEXT,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(mikrotik_id)
);

-- ============================================
-- Profiles (mirrors Supabase auth.users info)
-- ============================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Telegram Messages
-- ============================================
CREATE TABLE telegram_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  client_id UUID REFERENCES isp_clients(id) ON DELETE SET NULL,
  chat_id TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  message_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  telegram_message_id TEXT,
  error_message TEXT,
  related_invoice_id UUID REFERENCES client_invoices(id) ON DELETE SET NULL,
  related_contract_id UUID REFERENCES isp_contracts(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- WhatsApp Messages
-- ============================================
CREATE TABLE whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  client_id UUID REFERENCES isp_clients(id) ON DELETE SET NULL,
  phone_number TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  message_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  whatsapp_message_id TEXT,
  error_message TEXT,
  related_invoice_id UUID REFERENCES client_invoices(id) ON DELETE SET NULL,
  related_contract_id UUID REFERENCES isp_contracts(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Portal Ads (Publicidad en Portal Cautivo)
-- ============================================
CREATE TABLE portal_ads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  link_url TEXT,
  advertiser_name TEXT NOT NULL,
  advertiser_phone TEXT,
  advertiser_email TEXT,
  position TEXT DEFAULT 'banner',
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  start_date DATE,
  end_date DATE,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  monthly_fee NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ONU Devices
-- ============================================
CREATE TABLE onu_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  client_id UUID REFERENCES isp_clients(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  serial_number TEXT NOT NULL,
  mac_address TEXT,
  brand TEXT NOT NULL DEFAULT 'latic',
  model TEXT,
  management_ip TEXT,
  olt_port TEXT,
  wifi_ssid TEXT,
  wifi_password TEXT,
  pppoe_username TEXT,
  pppoe_password TEXT,
  pppoe_profile TEXT,
  status TEXT NOT NULL DEFAULT 'registered',
  notes TEXT,
  acs_device_id TEXT,
  acs_linked_at TIMESTAMPTZ,
  acs_manufacturer TEXT,
  acs_model TEXT,
  acs_firmware TEXT,
  signal_alert_threshold NUMERIC DEFAULT -30,
  signal_alerts_enabled BOOLEAN DEFAULT false,
  signal_alert_chat_id TEXT,
  last_alert_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ONU Global Signal Config (per MikroTik)
-- ============================================
CREATE TABLE onu_signal_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  alerts_enabled BOOLEAN DEFAULT true,
  default_threshold NUMERIC DEFAULT -30,
  default_chat_id TEXT,
  cooldown_minutes INTEGER DEFAULT 60,
  auto_cleanup_days INTEGER DEFAULT 90,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(mikrotik_id)
);

-- ============================================
-- ONU Signal Alerts Log
-- ============================================
CREATE TABLE onu_signal_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  onu_id UUID NOT NULL REFERENCES onu_devices(id) ON DELETE CASCADE,
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  rx_power NUMERIC NOT NULL,
  threshold NUMERIC NOT NULL,
  alert_type TEXT NOT NULL DEFAULT 'low_signal',
  message TEXT NOT NULL,
  sent_via TEXT NOT NULL DEFAULT 'telegram',
  sent_successfully BOOLEAN DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_onu_signal_alerts_onu ON onu_signal_alerts(onu_id);
CREATE INDEX idx_onu_signal_alerts_mikrotik ON onu_signal_alerts(mikrotik_id, created_at);

-- ============================================
-- VPN Peers (WireGuard)
-- ============================================
CREATE TABLE vpn_peers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  mikrotik_id UUID REFERENCES mikrotik_devices(id) ON DELETE SET NULL,
  public_key TEXT NOT NULL,
  private_key TEXT,
  preshared_key TEXT,
  allowed_ips TEXT NOT NULL DEFAULT '10.13.13.0/24',
  endpoint TEXT,
  persistent_keepalive INTEGER DEFAULT 25,
  peer_address TEXT NOT NULL,
  remote_networks TEXT,
  is_active BOOLEAN DEFAULT true,
  last_handshake TIMESTAMPTZ,
  transfer_rx BIGINT DEFAULT 0,
  transfer_tx BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_vpn_peers_created_by ON vpn_peers(created_by);
CREATE INDEX idx_vpn_peers_mikrotik ON vpn_peers(mikrotik_id);

-- ============================================
-- ONU Config Templates
-- ============================================
CREATE TABLE onu_config_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mikrotik_id UUID REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT 'latic',
  template_content TEXT NOT NULL,
  file_format TEXT NOT NULL DEFAULT 'xml',
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- ============================================
CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_mikrotik_access_user ON user_mikrotik_access(user_id);
CREATE INDEX idx_mikrotik_access_device ON user_mikrotik_access(mikrotik_id);
CREATE INDEX idx_isp_clients_mikrotik ON isp_clients(mikrotik_id);
CREATE INDEX idx_isp_clients_username ON isp_clients(username);
CREATE INDEX idx_isp_clients_identification ON isp_clients(identification_number);
CREATE INDEX idx_invoices_client ON client_invoices(client_id);
CREATE INDEX idx_invoices_status ON client_invoices(status);
CREATE INDEX idx_invoices_due_date ON client_invoices(due_date);
CREATE INDEX idx_vouchers_mikrotik ON vouchers(mikrotik_id);
CREATE INDEX idx_vouchers_code ON vouchers(code);
CREATE INDEX idx_vouchers_status ON vouchers(status);
CREATE INDEX idx_profiles_user_id ON profiles(user_id);
CREATE INDEX idx_telegram_messages_mikrotik ON telegram_messages(mikrotik_id);
CREATE INDEX idx_whatsapp_messages_mikrotik ON whatsapp_messages(mikrotik_id);
CREATE INDEX idx_portal_ads_mikrotik ON portal_ads(mikrotik_id);
CREATE INDEX idx_portal_ads_active ON portal_ads(is_active, mikrotik_id);
CREATE INDEX idx_onu_devices_mikrotik ON onu_devices(mikrotik_id);
CREATE INDEX idx_onu_devices_client ON onu_devices(client_id);
CREATE INDEX idx_onu_devices_serial ON onu_devices(serial_number);
CREATE INDEX idx_onu_templates_mikrotik ON onu_config_templates(mikrotik_id);
CREATE INDEX idx_onu_templates_brand ON onu_config_templates(brand);

-- ============================================
-- Helper Functions
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = _user_id AND role = _role
  );
$$ LANGUAGE sql STABLE;

-- ============================================
-- ONU Signal History (Optical Power Monitoring)
-- ============================================
CREATE TABLE onu_signal_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  onu_id UUID NOT NULL REFERENCES onu_devices(id) ON DELETE CASCADE,
  mikrotik_id UUID NOT NULL REFERENCES mikrotik_devices(id) ON DELETE CASCADE,
  rx_power NUMERIC,
  tx_power NUMERIC,
  quality TEXT DEFAULT 'unknown',
  temperature NUMERIC,
  cpu_usage NUMERIC,
  wan_status TEXT,
  recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_onu_signal_history_onu_id ON onu_signal_history(onu_id);
CREATE INDEX idx_onu_signal_history_recorded_at ON onu_signal_history(recorded_at);
CREATE INDEX idx_onu_signal_history_mikrotik ON onu_signal_history(mikrotik_id, recorded_at);

-- Apply updated_at triggers
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'mikrotik_devices', 'billing_config', 'client_billing_settings',
    'client_invoices', 'payment_transactions', 'isp_contracts', 'vouchers',
    'service_options', 'payment_platforms', 'telegram_config', 'whatsapp_config',
    'cloudflare_config', 'company_info', 'profiles', 'portal_ads',
    'onu_devices', 'onu_config_templates', 'vpn_peers'
  ] LOOP
    EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t, t);
  END LOOP;
END $$;

-- ============================================
-- Default Super Admin (password: admin123)
-- CAMBIAR EN PRODUCCIÓN
-- ============================================
INSERT INTO users (id, email, password_hash, full_name)
VALUES (
  uuid_generate_v4(),
  'admin@omnisync.local',
  crypt('admin123', gen_salt('bf')),
  'Super Admin'
);

-- ============================================
-- Ubiquiti airOS Devices
-- ============================================
CREATE TABLE ubiquiti_global_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by UUID NOT NULL REFERENCES users(id),
  default_username TEXT NOT NULL DEFAULT 'ubnt',
  default_password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(created_by)
);

CREATE TABLE ubiquiti_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  username TEXT,
  password TEXT,
  model TEXT,
  mac_address TEXT,
  client_id UUID REFERENCES isp_clients(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  last_signal INTEGER,
  last_noise INTEGER,
  last_ccq INTEGER,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ubiquiti_devices_created_by ON ubiquiti_devices(created_by);
CREATE INDEX idx_ubiquiti_devices_client ON ubiquiti_devices(client_id);

SELECT id, 'super_admin'::app_role FROM users WHERE email = 'admin@omnisync.local';

INSERT INTO profiles (user_id, email, full_name)
SELECT id, email, full_name FROM users WHERE email = 'admin@omnisync.local';
