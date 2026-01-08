-- Add billing type and invoice maturity to billing_config
ALTER TABLE public.billing_config 
ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'advance' CHECK (billing_type IN ('advance', 'due')),
ADD COLUMN IF NOT EXISTS invoice_maturity_days INTEGER NOT NULL DEFAULT 15,
ADD COLUMN IF NOT EXISTS auto_send_telegram BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_send_whatsapp BOOLEAN NOT NULL DEFAULT false;

-- Add comment for clarity
COMMENT ON COLUMN public.billing_config.billing_type IS 'advance = factura anticipada al crear cliente, due = factura al final del mes';
COMMENT ON COLUMN public.billing_config.invoice_maturity_days IS 'Días de madurez de la factura antes de vencer';