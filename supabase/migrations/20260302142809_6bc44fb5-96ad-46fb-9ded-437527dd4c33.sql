
-- Table to store Cloudflare configuration per MikroTik device
CREATE TABLE public.cloudflare_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mikrotik_id UUID NOT NULL REFERENCES public.mikrotik_devices(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'free' CHECK (mode IN ('free', 'paid')),
  api_token TEXT,
  tunnel_id TEXT,
  tunnel_name TEXT,
  tunnel_url TEXT,
  domain TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(mikrotik_id)
);

ALTER TABLE public.cloudflare_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage cloudflare config for their devices"
ON public.cloudflare_config FOR ALL
USING (
  has_role(auth.uid(), 'admin'::app_role) AND 
  EXISTS (SELECT 1 FROM user_mikrotik_access WHERE user_id = auth.uid() AND mikrotik_id = cloudflare_config.mikrotik_id)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) AND 
  EXISTS (SELECT 1 FROM user_mikrotik_access WHERE user_id = auth.uid() AND mikrotik_id = cloudflare_config.mikrotik_id)
);

CREATE POLICY "Super admins can manage all cloudflare config"
ON public.cloudflare_config FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE TRIGGER update_cloudflare_config_updated_at
BEFORE UPDATE ON public.cloudflare_config
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
