-- Enable realtime for mikrotik_devices table
ALTER TABLE public.mikrotik_devices REPLICA IDENTITY FULL;

-- Add the table to the realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.mikrotik_devices;