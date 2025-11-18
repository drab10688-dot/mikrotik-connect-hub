-- Add hotspot_url field to mikrotik_devices table
ALTER TABLE public.mikrotik_devices 
ADD COLUMN hotspot_url TEXT DEFAULT 'http://192.168.88.1/login';

-- Add comment to explain the column
COMMENT ON COLUMN public.mikrotik_devices.hotspot_url IS 'URL del portal hotspot para generar QR codes de acceso directo';