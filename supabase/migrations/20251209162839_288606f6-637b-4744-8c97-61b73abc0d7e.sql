-- Create voucher_sales_history table to store completed voucher sales
CREATE TABLE public.voucher_sales_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  voucher_code TEXT NOT NULL,
  voucher_password TEXT NOT NULL,
  profile TEXT NOT NULL,
  validity TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  mikrotik_id UUID NOT NULL REFERENCES public.mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  sold_by UUID,
  sold_at TIMESTAMP WITH TIME ZONE,
  activated_at TIMESTAMP WITH TIME ZONE,
  expired_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  total_uptime TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.voucher_sales_history ENABLE ROW LEVEL SECURITY;

-- Super admins can manage all history
CREATE POLICY "Super admins can manage all voucher history"
ON public.voucher_sales_history
FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

-- Admins can view history for their devices
CREATE POLICY "Admins can view voucher history for their mikrotiks"
ON public.voucher_sales_history
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) AND
  EXISTS (
    SELECT 1 FROM user_mikrotik_access
    WHERE user_mikrotik_access.user_id = auth.uid()
    AND user_mikrotik_access.mikrotik_id = voucher_sales_history.mikrotik_id
  )
);

-- Admins can insert history for their devices
CREATE POLICY "Admins can insert voucher history for their mikrotiks"
ON public.voucher_sales_history
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) AND
  EXISTS (
    SELECT 1 FROM user_mikrotik_access
    WHERE user_mikrotik_access.user_id = auth.uid()
    AND user_mikrotik_access.mikrotik_id = voucher_sales_history.mikrotik_id
  )
);

-- Resellers can view history for assigned devices
CREATE POLICY "Resellers can view voucher history for assigned mikrotiks"
ON public.voucher_sales_history
FOR SELECT
USING (
  has_role(auth.uid(), 'reseller'::app_role) AND
  EXISTS (
    SELECT 1 FROM reseller_assignments
    WHERE reseller_assignments.reseller_id = auth.uid()
    AND reseller_assignments.mikrotik_id = voucher_sales_history.mikrotik_id
  )
);

-- Add validity column to vouchers table to track the original validity
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS validity TEXT;

-- Add activated_at column to vouchers to track when voucher was first used
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE;