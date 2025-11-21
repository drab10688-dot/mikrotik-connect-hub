-- Create a trigger function to set status to 'active' for super admins
CREATE OR REPLACE FUNCTION public.set_device_status_for_super_admin()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if the user creating the device is a super admin
  IF public.has_role(NEW.created_by, 'super_admin'::app_role) THEN
    NEW.status := 'active';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to automatically set status before insert
CREATE TRIGGER set_device_status_before_insert
  BEFORE INSERT ON public.mikrotik_devices
  FOR EACH ROW
  EXECUTE FUNCTION public.set_device_status_for_super_admin();