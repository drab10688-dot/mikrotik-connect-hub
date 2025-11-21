-- Función para asignar dispositivo automáticamente basado en email
CREATE OR REPLACE FUNCTION public.auto_assign_device_by_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  device_id uuid;
  super_admin_id uuid;
BEGIN
  -- Si el email es alvarezduber@hotmail.com, asignar el dispositivo Drst_5G
  IF NEW.email = 'alvarezduber@hotmail.com' THEN
    -- Buscar el dispositivo Drst_5G
    SELECT id INTO device_id
    FROM public.mikrotik_devices
    WHERE name = 'Drst_5G'
    LIMIT 1;
    
    -- Si el dispositivo existe, crear el acceso
    IF device_id IS NOT NULL THEN
      -- Buscar un super_admin para usar como granted_by
      SELECT user_id INTO super_admin_id
      FROM public.user_roles
      WHERE role = 'super_admin'
      LIMIT 1;
      
      -- Si no hay super admin, usar el mismo user_id
      IF super_admin_id IS NULL THEN
        super_admin_id := NEW.user_id;
      END IF;
      
      -- Crear el acceso si no existe ya
      INSERT INTO public.user_mikrotik_access (user_id, mikrotik_id, granted_by)
      VALUES (NEW.user_id, device_id, super_admin_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger que se ejecuta después de insertar un perfil
CREATE TRIGGER on_profile_created_assign_device
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_device_by_email();