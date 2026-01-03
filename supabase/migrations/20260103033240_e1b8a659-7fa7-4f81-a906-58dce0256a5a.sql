-- Create table for payment platform configurations
CREATE TABLE public.payment_platforms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mikrotik_id UUID NOT NULL,
  created_by UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('wompi', 'mercadopago')),
  is_active BOOLEAN NOT NULL DEFAULT false,
  public_key TEXT,
  private_key TEXT,
  webhook_secret TEXT,
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(mikrotik_id, platform)
);

-- Create table for client invoices/billing
CREATE TABLE public.client_invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mikrotik_id UUID NOT NULL,
  client_id UUID REFERENCES public.isp_clients(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES public.isp_contracts(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  due_date DATE NOT NULL,
  billing_period_start DATE NOT NULL,
  billing_period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')),
  payment_reference TEXT,
  paid_at TIMESTAMP WITH TIME ZONE,
  paid_via TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for payment transactions
CREATE TABLE public.payment_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID REFERENCES public.client_invoices(id) ON DELETE CASCADE,
  mikrotik_id UUID NOT NULL,
  platform TEXT NOT NULL,
  external_reference TEXT,
  transaction_id TEXT,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'COP',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'refunded')),
  payer_email TEXT,
  payer_name TEXT,
  raw_response JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for billing settings per client
CREATE TABLE public.client_billing_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.isp_clients(id) ON DELETE CASCADE UNIQUE,
  mikrotik_id UUID NOT NULL,
  billing_day INTEGER NOT NULL DEFAULT 1 CHECK (billing_day >= 1 AND billing_day <= 28),
  grace_period_days INTEGER NOT NULL DEFAULT 5,
  monthly_amount NUMERIC NOT NULL,
  is_suspended BOOLEAN NOT NULL DEFAULT false,
  suspended_at TIMESTAMP WITH TIME ZONE,
  last_payment_date DATE,
  next_billing_date DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.payment_platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_billing_settings ENABLE ROW LEVEL SECURITY;

-- Policies for payment_platforms
CREATE POLICY "Admins can manage payment platforms for their mikrotiks"
ON public.payment_platforms FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) AND EXISTS (
  SELECT 1 FROM user_mikrotik_access WHERE user_id = auth.uid() AND mikrotik_id = payment_platforms.mikrotik_id
))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND EXISTS (
  SELECT 1 FROM user_mikrotik_access WHERE user_id = auth.uid() AND mikrotik_id = payment_platforms.mikrotik_id
));

CREATE POLICY "Super admins can manage all payment platforms"
ON public.payment_platforms FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

-- Policies for client_invoices
CREATE POLICY "Admins can manage invoices for their mikrotiks"
ON public.client_invoices FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) AND EXISTS (
  SELECT 1 FROM user_mikrotik_access WHERE user_id = auth.uid() AND mikrotik_id = client_invoices.mikrotik_id
))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND EXISTS (
  SELECT 1 FROM user_mikrotik_access WHERE user_id = auth.uid() AND mikrotik_id = client_invoices.mikrotik_id
));

CREATE POLICY "Super admins can manage all invoices"
ON public.client_invoices FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Secretaries can view invoices for assigned mikrotiks"
ON public.client_invoices FOR SELECT
USING (has_role(auth.uid(), 'secretary'::app_role) AND EXISTS (
  SELECT 1 FROM secretary_assignments WHERE secretary_id = auth.uid() AND mikrotik_id = client_invoices.mikrotik_id
));

-- Policies for payment_transactions
CREATE POLICY "Admins can view transactions for their mikrotiks"
ON public.payment_transactions FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) AND EXISTS (
  SELECT 1 FROM user_mikrotik_access WHERE user_id = auth.uid() AND mikrotik_id = payment_transactions.mikrotik_id
));

CREATE POLICY "Super admins can manage all transactions"
ON public.payment_transactions FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

-- Policies for client_billing_settings
CREATE POLICY "Admins can manage billing settings for their mikrotiks"
ON public.client_billing_settings FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) AND EXISTS (
  SELECT 1 FROM user_mikrotik_access WHERE user_id = auth.uid() AND mikrotik_id = client_billing_settings.mikrotik_id
))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND EXISTS (
  SELECT 1 FROM user_mikrotik_access WHERE user_id = auth.uid() AND mikrotik_id = client_billing_settings.mikrotik_id
));

CREATE POLICY "Super admins can manage all billing settings"
ON public.client_billing_settings FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

-- Create indexes for performance
CREATE INDEX idx_client_invoices_client_id ON public.client_invoices(client_id);
CREATE INDEX idx_client_invoices_status ON public.client_invoices(status);
CREATE INDEX idx_client_invoices_due_date ON public.client_invoices(due_date);
CREATE INDEX idx_payment_transactions_invoice_id ON public.payment_transactions(invoice_id);
CREATE INDEX idx_client_billing_settings_client_id ON public.client_billing_settings(client_id);
CREATE INDEX idx_client_billing_settings_next_billing ON public.client_billing_settings(next_billing_date);

-- Add trigger for updated_at
CREATE TRIGGER update_payment_platforms_updated_at
BEFORE UPDATE ON public.payment_platforms
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_client_invoices_updated_at
BEFORE UPDATE ON public.client_invoices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_payment_transactions_updated_at
BEFORE UPDATE ON public.payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_client_billing_settings_updated_at
BEFORE UPDATE ON public.client_billing_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();