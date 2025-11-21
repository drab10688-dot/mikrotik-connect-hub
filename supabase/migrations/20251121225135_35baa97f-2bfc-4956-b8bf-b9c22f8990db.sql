-- Función para asignar rol de admin cuando un usuario crea su primer dispositivo
CREATE OR REPLACE FUNCTION public.auto_assign_admin_role_on_device()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  user_role_exists boolean;
  user_current_role app_role;
BEGIN
  -- Verificar si el usuario ya tiene un rol
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = NEW.created_by
  ) INTO user_role_exists;
  
  IF user_role_exists THEN
    -- Obtener el rol actual del usuario
    SELECT role INTO user_current_role
    FROM public.user_roles
    WHERE user_id = NEW.created_by
    LIMIT 1;
    
    -- Si el usuario es 'user', actualizarlo a 'admin'
    IF user_current_role = 'user' THEN
      UPDATE public.user_roles
      SET role = 'admin'
      WHERE user_id = NEW.created_by;
    END IF;
  ELSE
    -- Si no tiene rol, asignarle 'admin'
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.created_by, 'admin');
  END IF;
  
  RETURN NEW;
END;
$$;

-- Crear trigger que se ejecuta después de insertar un dispositivo
DROP TRIGGER IF EXISTS on_device_created_assign_admin ON public.mikrotik_devices;
CREATE TRIGGER on_device_created_assign_admin
  AFTER INSERT ON public.mikrotik_devices
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_admin_role_on_device();