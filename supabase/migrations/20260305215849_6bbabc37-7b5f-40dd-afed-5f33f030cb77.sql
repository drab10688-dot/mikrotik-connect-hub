ALTER TABLE public.mikrotik_devices 
ADD COLUMN latitude text DEFAULT NULL,
ADD COLUMN longitude text DEFAULT NULL;