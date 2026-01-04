-- Create table for additional service options with prices
CREATE TABLE public.service_options (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mikrotik_id uuid NOT NULL REFERENCES public.mikrotik_devices(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  name text NOT NULL,
  description text,
  price numeric NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(mikrotik_id, name)
);

-- Enable RLS
ALTER TABLE public.service_options ENABLE ROW LEVEL SECURITY;

-- Policies for admins
CREATE POLICY "Admins can manage service options for their mikrotiks"
ON public.service_options
FOR ALL
USING (
  has_role(auth.uid(), 'admin'::app_role) AND 
  EXISTS (
    SELECT 1 FROM user_mikrotik_access 
    WHERE user_mikrotik_access.user_id = auth.uid() 
    AND user_mikrotik_access.mikrotik_id = service_options.mikrotik_id
  )
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) AND 
  EXISTS (
    SELECT 1 FROM user_mikrotik_access 
    WHERE user_mikrotik_access.user_id = auth.uid() 
    AND user_mikrotik_access.mikrotik_id = service_options.mikrotik_id
  )
);

-- Policies for super admins
CREATE POLICY "Super admins can manage all service options"
ON public.service_options
FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

-- Policies for secretaries to view
CREATE POLICY "Secretaries can view service options for assigned mikrotiks"
ON public.service_options
FOR SELECT
USING (
  has_role(auth.uid(), 'secretary'::app_role) AND 
  EXISTS (
    SELECT 1 FROM secretary_assignments 
    WHERE secretary_assignments.secretary_id = auth.uid() 
    AND secretary_assignments.mikrotik_id = service_options.mikrotik_id
  )
);

-- Trigger for updated_at
CREATE TRIGGER update_service_options_updated_at
BEFORE UPDATE ON public.service_options
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();