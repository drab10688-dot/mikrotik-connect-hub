-- Create table for ISP client registration history
CREATE TABLE public.isp_clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mikrotik_id UUID NOT NULL REFERENCES public.mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Client info
  client_name TEXT NOT NULL,
  identification_number TEXT,
  phone TEXT,
  email TEXT,
  
  -- Location
  address TEXT,
  city TEXT,
  latitude TEXT,
  longitude TEXT,
  
  -- Connection details
  connection_type TEXT NOT NULL CHECK (connection_type IN ('pppoe', 'simple_queue')),
  username TEXT NOT NULL,
  assigned_ip TEXT,
  plan_or_speed TEXT,
  
  -- Status
  is_potential_client BOOLEAN DEFAULT false,
  comment TEXT
);

-- Enable RLS
ALTER TABLE public.isp_clients ENABLE ROW LEVEL SECURITY;

-- Super admins can manage all clients
CREATE POLICY "Super admins can manage all isp clients"
ON public.isp_clients
FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

-- Admins can view clients for their mikrotiks
CREATE POLICY "Admins can view isp clients for their mikrotiks"
ON public.isp_clients
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) AND
  EXISTS (
    SELECT 1 FROM user_mikrotik_access
    WHERE user_mikrotik_access.user_id = auth.uid()
    AND user_mikrotik_access.mikrotik_id = isp_clients.mikrotik_id
  )
);

-- Admins can create clients for their mikrotiks
CREATE POLICY "Admins can create isp clients for their mikrotiks"
ON public.isp_clients
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) AND
  EXISTS (
    SELECT 1 FROM user_mikrotik_access
    WHERE user_mikrotik_access.user_id = auth.uid()
    AND user_mikrotik_access.mikrotik_id = isp_clients.mikrotik_id
  )
);

-- Admins can update clients they created
CREATE POLICY "Admins can update their isp clients"
ON public.isp_clients
FOR UPDATE
USING (created_by = auth.uid());

-- Admins can delete clients they created
CREATE POLICY "Admins can delete their isp clients"
ON public.isp_clients
FOR DELETE
USING (created_by = auth.uid());

-- Secretaries can view clients for their assigned mikrotiks
CREATE POLICY "Secretaries can view isp clients for assigned mikrotiks"
ON public.isp_clients
FOR SELECT
USING (
  has_role(auth.uid(), 'secretary'::app_role) AND
  EXISTS (
    SELECT 1 FROM secretary_assignments
    WHERE secretary_assignments.secretary_id = auth.uid()
    AND secretary_assignments.mikrotik_id = isp_clients.mikrotik_id
  )
);

-- Secretaries can create clients for assigned mikrotiks
CREATE POLICY "Secretaries can create isp clients for assigned mikrotiks"
ON public.isp_clients
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'secretary'::app_role) AND
  EXISTS (
    SELECT 1 FROM secretary_assignments
    WHERE secretary_assignments.secretary_id = auth.uid()
    AND secretary_assignments.mikrotik_id = isp_clients.mikrotik_id
  )
);