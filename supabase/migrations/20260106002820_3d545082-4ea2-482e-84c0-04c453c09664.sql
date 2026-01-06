-- Create table for universal billing configuration per MikroTik device
CREATE TABLE public.billing_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mikrotik_id UUID NOT NULL REFERENCES public.mikrotik_devices(id) ON DELETE CASCADE,
  billing_day INT NOT NULL DEFAULT 1 CHECK (billing_day >= 1 AND billing_day <= 28),
  grace_period_days INT NOT NULL DEFAULT 5,
  reminder_days_before INT NOT NULL DEFAULT 3,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  UNIQUE(mikrotik_id)
);

-- Enable RLS
ALTER TABLE public.billing_config ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view billing config for their devices"
ON public.billing_config
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_mikrotik_access uma 
    WHERE uma.mikrotik_id = billing_config.mikrotik_id 
    AND uma.user_id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM mikrotik_devices md 
    WHERE md.id = billing_config.mikrotik_id 
    AND md.created_by = auth.uid()
  )
);

CREATE POLICY "Users can insert billing config for their devices"
ON public.billing_config
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM mikrotik_devices md 
    WHERE md.id = billing_config.mikrotik_id 
    AND md.created_by = auth.uid()
  )
);

CREATE POLICY "Users can update billing config for their devices"
ON public.billing_config
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM mikrotik_devices md 
    WHERE md.id = billing_config.mikrotik_id 
    AND md.created_by = auth.uid()
  )
);

-- Create trigger for updated_at
CREATE TRIGGER update_billing_config_updated_at
BEFORE UPDATE ON public.billing_config
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();