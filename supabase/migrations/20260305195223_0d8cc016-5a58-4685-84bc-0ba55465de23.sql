
-- ONU Devices table
CREATE TABLE public.onu_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mikrotik_id UUID NOT NULL REFERENCES public.mikrotik_devices(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.isp_clients(id) ON DELETE SET NULL,
  created_by UUID NOT NULL,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ONU Config Templates table
CREATE TABLE public.onu_config_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mikrotik_id UUID REFERENCES public.mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT 'latic',
  template_content TEXT NOT NULL,
  file_format TEXT NOT NULL DEFAULT 'xml',
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_onu_devices_mikrotik ON public.onu_devices(mikrotik_id);
CREATE INDEX idx_onu_devices_client ON public.onu_devices(client_id);
CREATE INDEX idx_onu_devices_serial ON public.onu_devices(serial_number);
CREATE INDEX idx_onu_templates_mikrotik ON public.onu_config_templates(mikrotik_id);
CREATE INDEX idx_onu_templates_brand ON public.onu_config_templates(brand);

-- Updated_at triggers
CREATE TRIGGER update_onu_devices_updated_at BEFORE UPDATE ON public.onu_devices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_onu_config_templates_updated_at BEFORE UPDATE ON public.onu_config_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.onu_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onu_config_templates ENABLE ROW LEVEL SECURITY;

-- onu_devices policies
CREATE POLICY "Super admins can manage all ONUs" ON public.onu_devices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Admins can manage ONUs for their mikrotiks" ON public.onu_devices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) AND EXISTS (SELECT 1 FROM public.user_mikrotik_access WHERE user_id = auth.uid() AND mikrotik_id = onu_devices.mikrotik_id))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND EXISTS (SELECT 1 FROM public.user_mikrotik_access WHERE user_id = auth.uid() AND mikrotik_id = onu_devices.mikrotik_id));

CREATE POLICY "Secretaries can view ONUs for assigned mikrotiks" ON public.onu_devices FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'secretary'::app_role) AND EXISTS (SELECT 1 FROM public.secretary_assignments WHERE secretary_id = auth.uid() AND mikrotik_id = onu_devices.mikrotik_id));

-- onu_config_templates policies
CREATE POLICY "Super admins can manage all templates" ON public.onu_config_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Admins can manage templates for their mikrotiks" ON public.onu_config_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) AND (mikrotik_id IS NULL OR EXISTS (SELECT 1 FROM public.user_mikrotik_access WHERE user_id = auth.uid() AND mikrotik_id = onu_config_templates.mikrotik_id)))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND (mikrotik_id IS NULL OR EXISTS (SELECT 1 FROM public.user_mikrotik_access WHERE user_id = auth.uid() AND mikrotik_id = onu_config_templates.mikrotik_id)));

CREATE POLICY "Secretaries can view templates for assigned mikrotiks" ON public.onu_config_templates FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'secretary'::app_role) AND (mikrotik_id IS NULL OR EXISTS (SELECT 1 FROM public.secretary_assignments WHERE secretary_id = auth.uid() AND mikrotik_id = onu_config_templates.mikrotik_id)));
