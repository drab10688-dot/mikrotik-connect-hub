-- Create table for Telegram config
CREATE TABLE public.telegram_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mikrotik_id UUID NOT NULL REFERENCES public.mikrotik_devices(id) ON DELETE CASCADE,
  bot_token TEXT NOT NULL,
  bot_username TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(mikrotik_id)
);

-- Create table for Telegram messages log
CREATE TABLE public.telegram_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mikrotik_id UUID NOT NULL REFERENCES public.mikrotik_devices(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.isp_clients(id) ON DELETE SET NULL,
  chat_id TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  message_content TEXT NOT NULL,
  related_invoice_id UUID REFERENCES public.client_invoices(id) ON DELETE SET NULL,
  related_contract_id UUID REFERENCES public.isp_contracts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  telegram_message_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.telegram_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_messages ENABLE ROW LEVEL SECURITY;

-- RLS policies for telegram_config
CREATE POLICY "Users can view telegram config for their devices"
ON public.telegram_config FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_mikrotik_access
    WHERE user_mikrotik_access.mikrotik_id = telegram_config.mikrotik_id
    AND user_mikrotik_access.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert telegram config for their devices"
ON public.telegram_config FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_mikrotik_access
    WHERE user_mikrotik_access.mikrotik_id = telegram_config.mikrotik_id
    AND user_mikrotik_access.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update telegram config for their devices"
ON public.telegram_config FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_mikrotik_access
    WHERE user_mikrotik_access.mikrotik_id = telegram_config.mikrotik_id
    AND user_mikrotik_access.user_id = auth.uid()
  )
);

-- RLS policies for telegram_messages
CREATE POLICY "Users can view telegram messages for their devices"
ON public.telegram_messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_mikrotik_access
    WHERE user_mikrotik_access.mikrotik_id = telegram_messages.mikrotik_id
    AND user_mikrotik_access.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert telegram messages for their devices"
ON public.telegram_messages FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_mikrotik_access
    WHERE user_mikrotik_access.mikrotik_id = telegram_messages.mikrotik_id
    AND user_mikrotik_access.user_id = auth.uid()
  )
);

-- Trigger for updated_at
CREATE TRIGGER update_telegram_config_updated_at
BEFORE UPDATE ON public.telegram_config
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();