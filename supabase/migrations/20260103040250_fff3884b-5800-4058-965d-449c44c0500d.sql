-- Create table for WhatsApp API configuration
CREATE TABLE public.whatsapp_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mikrotik_id UUID NOT NULL REFERENCES public.mikrotik_devices(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  business_account_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  UNIQUE(mikrotik_id)
);

-- Enable RLS
ALTER TABLE public.whatsapp_config ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view whatsapp config for their devices"
ON public.whatsapp_config
FOR SELECT
USING (
  mikrotik_id IN (
    SELECT mikrotik_id FROM public.user_mikrotik_access WHERE user_id = auth.uid()
    UNION
    SELECT id FROM public.mikrotik_devices WHERE created_by = auth.uid()
    UNION
    SELECT mikrotik_id FROM public.secretary_assignments WHERE secretary_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Users can insert whatsapp config for their devices"
ON public.whatsapp_config
FOR INSERT
WITH CHECK (
  mikrotik_id IN (
    SELECT id FROM public.mikrotik_devices WHERE created_by = auth.uid()
  )
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Users can update whatsapp config for their devices"
ON public.whatsapp_config
FOR UPDATE
USING (
  mikrotik_id IN (
    SELECT id FROM public.mikrotik_devices WHERE created_by = auth.uid()
  )
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Users can delete whatsapp config for their devices"
ON public.whatsapp_config
FOR DELETE
USING (
  mikrotik_id IN (
    SELECT id FROM public.mikrotik_devices WHERE created_by = auth.uid()
  )
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
);

-- Create table for WhatsApp message history
CREATE TABLE public.whatsapp_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mikrotik_id UUID NOT NULL REFERENCES public.mikrotik_devices(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.isp_clients(id) ON DELETE SET NULL,
  phone_number TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  message_content TEXT NOT NULL,
  related_invoice_id UUID REFERENCES public.client_invoices(id) ON DELETE SET NULL,
  related_contract_id UUID REFERENCES public.isp_contracts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  whatsapp_message_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID NOT NULL
);

-- Enable RLS
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Create policies for whatsapp_messages
CREATE POLICY "Users can view messages for their devices"
ON public.whatsapp_messages
FOR SELECT
USING (
  mikrotik_id IN (
    SELECT mikrotik_id FROM public.user_mikrotik_access WHERE user_id = auth.uid()
    UNION
    SELECT id FROM public.mikrotik_devices WHERE created_by = auth.uid()
    UNION
    SELECT mikrotik_id FROM public.secretary_assignments WHERE secretary_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Users can insert messages for their devices"
ON public.whatsapp_messages
FOR INSERT
WITH CHECK (
  mikrotik_id IN (
    SELECT mikrotik_id FROM public.user_mikrotik_access WHERE user_id = auth.uid()
    UNION
    SELECT id FROM public.mikrotik_devices WHERE created_by = auth.uid()
    UNION
    SELECT mikrotik_id FROM public.secretary_assignments WHERE secretary_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);

-- Add trigger for updated_at
CREATE TRIGGER update_whatsapp_config_updated_at
BEFORE UPDATE ON public.whatsapp_config
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();