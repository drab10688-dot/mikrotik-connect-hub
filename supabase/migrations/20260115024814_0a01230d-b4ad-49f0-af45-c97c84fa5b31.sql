-- Add suspension address list column to billing_config table
ALTER TABLE public.billing_config 
ADD COLUMN IF NOT EXISTS suspension_address_list TEXT DEFAULT 'morosos';