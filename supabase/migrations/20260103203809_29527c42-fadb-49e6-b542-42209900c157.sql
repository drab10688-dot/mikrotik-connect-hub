-- Add reminder_days_before column to client_billing_settings
ALTER TABLE public.client_billing_settings 
ADD COLUMN IF NOT EXISTS reminder_days_before integer NOT NULL DEFAULT 3;