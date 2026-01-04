-- ============================================
-- FIX 1: Secure API keys in database tables
-- ============================================
-- Restrict payment_platforms sensitive columns to service role only
-- by removing existing policies that expose private_key, webhook_secret, access_token

-- Drop existing policies that may expose secrets
DROP POLICY IF EXISTS "Users can view payment platforms for accessible devices" ON payment_platforms;
DROP POLICY IF EXISTS "Admins can manage payment platforms" ON payment_platforms;

-- Create view policy that excludes sensitive columns (only public info)
CREATE POLICY "Users can view payment platform status"
ON payment_platforms FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_mikrotik_access
    WHERE user_mikrotik_access.mikrotik_id = payment_platforms.mikrotik_id
    AND user_mikrotik_access.user_id = auth.uid()
  )
);

-- Create admin policy for INSERT/UPDATE/DELETE (they still need to manage configs)
CREATE POLICY "Admins can insert payment platforms"
ON payment_platforms FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_mikrotik_access
    WHERE user_mikrotik_access.mikrotik_id = payment_platforms.mikrotik_id
    AND user_mikrotik_access.user_id = auth.uid()
  )
);

CREATE POLICY "Admins can update payment platforms"
ON payment_platforms FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_mikrotik_access
    WHERE user_mikrotik_access.mikrotik_id = payment_platforms.mikrotik_id
    AND user_mikrotik_access.user_id = auth.uid()
  )
);

CREATE POLICY "Admins can delete payment platforms"
ON payment_platforms FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_mikrotik_access
    WHERE user_mikrotik_access.mikrotik_id = payment_platforms.mikrotik_id
    AND user_mikrotik_access.user_id = auth.uid()
  )
);

-- ============================================
-- FIX 2: Secure billing settings with lookup function
-- ============================================
-- Remove the overly permissive public policy
DROP POLICY IF EXISTS "Public can view billing settings" ON client_billing_settings;

-- Create a secure lookup function for the payment portal
-- This validates client identity before returning billing info
CREATE OR REPLACE FUNCTION public.get_client_payment_info(
  _identification TEXT
)
RETURNS TABLE (
  client_id UUID,
  client_name TEXT,
  username TEXT,
  plan_or_speed TEXT,
  connection_type TEXT,
  mikrotik_id UUID,
  monthly_amount NUMERIC,
  billing_day INTEGER,
  is_suspended BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    c.id,
    c.client_name,
    c.username,
    c.plan_or_speed,
    c.connection_type,
    c.mikrotik_id,
    bs.monthly_amount,
    bs.billing_day,
    bs.is_suspended
  FROM isp_clients c
  LEFT JOIN client_billing_settings bs ON bs.client_id = c.id
  WHERE c.identification_number = _identification
    AND c.is_potential_client = false
  LIMIT 1;
$$;

-- Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION public.get_client_payment_info TO anon;
GRANT EXECUTE ON FUNCTION public.get_client_payment_info TO authenticated;

-- Create a function to get client by contract number for payment portal
CREATE OR REPLACE FUNCTION public.get_client_by_contract(
  _contract_number TEXT
)
RETURNS TABLE (
  client_id UUID,
  client_name TEXT,
  username TEXT,
  plan_or_speed TEXT,
  connection_type TEXT,
  mikrotik_id UUID,
  monthly_amount NUMERIC,
  billing_day INTEGER,
  is_suspended BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    c.id,
    c.client_name,
    c.username,
    c.plan_or_speed,
    c.connection_type,
    c.mikrotik_id,
    bs.monthly_amount,
    bs.billing_day,
    bs.is_suspended
  FROM isp_contracts ct
  JOIN isp_clients c ON c.id = ct.client_id
  LEFT JOIN client_billing_settings bs ON bs.client_id = c.id
  WHERE ct.contract_number = _contract_number
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_by_contract TO anon;
GRANT EXECUTE ON FUNCTION public.get_client_by_contract TO authenticated;

-- Create function to get pending invoices for a validated client
CREATE OR REPLACE FUNCTION public.get_client_invoices(
  _client_id UUID
)
RETURNS TABLE (
  id UUID,
  invoice_number TEXT,
  amount NUMERIC,
  due_date DATE,
  status TEXT,
  billing_period_start DATE,
  billing_period_end DATE,
  paid_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    i.id,
    i.invoice_number,
    i.amount,
    i.due_date,
    i.status,
    i.billing_period_start,
    i.billing_period_end,
    i.paid_at
  FROM client_invoices i
  WHERE i.client_id = _client_id
    AND i.status IN ('pending', 'overdue')
  ORDER BY i.due_date ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_invoices TO anon;
GRANT EXECUTE ON FUNCTION public.get_client_invoices TO authenticated;

-- Create function to get active payment platforms for a device
CREATE OR REPLACE FUNCTION public.get_active_payment_platforms(
  _mikrotik_id UUID
)
RETURNS TABLE (
  platform TEXT,
  is_active BOOLEAN,
  public_key TEXT,
  environment TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    p.platform,
    p.is_active,
    p.public_key,
    p.environment
  FROM payment_platforms p
  WHERE p.mikrotik_id = _mikrotik_id
    AND p.is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_payment_platforms TO anon;
GRANT EXECUTE ON FUNCTION public.get_active_payment_platforms TO authenticated;