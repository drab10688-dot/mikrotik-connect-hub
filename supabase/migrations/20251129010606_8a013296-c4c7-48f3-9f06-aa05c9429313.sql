-- Add granular permissions to secretary_assignments table
ALTER TABLE public.secretary_assignments
ADD COLUMN IF NOT EXISTS can_create_pppoe boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS can_edit_pppoe boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS can_delete_pppoe boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS can_disconnect_pppoe boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS can_toggle_pppoe boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS can_create_queues boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS can_edit_queues boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS can_delete_queues boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS can_toggle_queues boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS can_suspend_queues boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS can_reactivate_queues boolean DEFAULT true;

-- Add comment to explain the permissions
COMMENT ON COLUMN public.secretary_assignments.can_create_pppoe IS 'Permite crear usuarios PPPoE';
COMMENT ON COLUMN public.secretary_assignments.can_edit_pppoe IS 'Permite editar usuarios PPPoE';
COMMENT ON COLUMN public.secretary_assignments.can_delete_pppoe IS 'Permite eliminar usuarios PPPoE';
COMMENT ON COLUMN public.secretary_assignments.can_disconnect_pppoe IS 'Permite desconectar sesiones PPPoE activas';
COMMENT ON COLUMN public.secretary_assignments.can_toggle_pppoe IS 'Permite activar/desactivar usuarios PPPoE';
COMMENT ON COLUMN public.secretary_assignments.can_create_queues IS 'Permite crear colas simples';
COMMENT ON COLUMN public.secretary_assignments.can_edit_queues IS 'Permite editar colas simples';
COMMENT ON COLUMN public.secretary_assignments.can_delete_queues IS 'Permite eliminar colas simples';
COMMENT ON COLUMN public.secretary_assignments.can_toggle_queues IS 'Permite activar/desactivar colas';
COMMENT ON COLUMN public.secretary_assignments.can_suspend_queues IS 'Permite suspender servicios (agregar a address list)';
COMMENT ON COLUMN public.secretary_assignments.can_reactivate_queues IS 'Permite reactivar servicios (remover de address list)';