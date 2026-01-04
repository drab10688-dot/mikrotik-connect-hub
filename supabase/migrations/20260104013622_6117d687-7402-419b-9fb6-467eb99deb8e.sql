-- Agregar columnas para servicios adicionales en isp_clients
ALTER TABLE public.isp_clients 
ADD COLUMN IF NOT EXISTS service_option TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS service_price NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_monthly_price NUMERIC DEFAULT 0;

-- Agregar columnas en isp_contracts para servicios adicionales  
ALTER TABLE public.isp_contracts
ADD COLUMN IF NOT EXISTS service_option TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS service_price TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS total_price TEXT DEFAULT NULL;

-- Agregar columna en client_invoices para desglose de servicios
ALTER TABLE public.client_invoices
ADD COLUMN IF NOT EXISTS service_breakdown JSONB DEFAULT NULL;