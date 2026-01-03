-- Create table for contract history
CREATE TABLE public.isp_contracts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mikrotik_id UUID NOT NULL,
  client_id UUID REFERENCES public.isp_clients(id) ON DELETE SET NULL,
  created_by UUID NOT NULL,
  contract_number TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  identification TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  plan TEXT NOT NULL,
  speed TEXT,
  price TEXT,
  equipment TEXT[],
  client_signature_url TEXT,
  manager_signature_url TEXT,
  signed_at TIMESTAMP WITH TIME ZONE,
  pdf_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.isp_contracts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Super admins can manage all contracts"
ON public.isp_contracts
FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Admins can view contracts for their mikrotiks"
ON public.isp_contracts
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) AND 
  EXISTS (
    SELECT 1 FROM user_mikrotik_access 
    WHERE user_mikrotik_access.user_id = auth.uid() 
    AND user_mikrotik_access.mikrotik_id = isp_contracts.mikrotik_id
  )
);

CREATE POLICY "Admins can create contracts for their mikrotiks"
ON public.isp_contracts
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) AND 
  EXISTS (
    SELECT 1 FROM user_mikrotik_access 
    WHERE user_mikrotik_access.user_id = auth.uid() 
    AND user_mikrotik_access.mikrotik_id = isp_contracts.mikrotik_id
  )
);

CREATE POLICY "Admins can update their contracts"
ON public.isp_contracts
FOR UPDATE
USING (created_by = auth.uid());

CREATE POLICY "Admins can delete their contracts"
ON public.isp_contracts
FOR DELETE
USING (created_by = auth.uid());

CREATE POLICY "Secretaries can view contracts for assigned mikrotiks"
ON public.isp_contracts
FOR SELECT
USING (
  has_role(auth.uid(), 'secretary'::app_role) AND 
  EXISTS (
    SELECT 1 FROM secretary_assignments 
    WHERE secretary_assignments.secretary_id = auth.uid() 
    AND secretary_assignments.mikrotik_id = isp_contracts.mikrotik_id
  )
);

CREATE POLICY "Secretaries can create contracts for assigned mikrotiks"
ON public.isp_contracts
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'secretary'::app_role) AND 
  EXISTS (
    SELECT 1 FROM secretary_assignments 
    WHERE secretary_assignments.secretary_id = auth.uid() 
    AND secretary_assignments.mikrotik_id = isp_contracts.mikrotik_id
  )
);

-- Trigger for updated_at
CREATE TRIGGER update_isp_contracts_updated_at
BEFORE UPDATE ON public.isp_contracts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();