-- Crear tabla para asignación de permisos específicos de secretarias
CREATE TABLE IF NOT EXISTS public.secretary_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secretary_id uuid NOT NULL,
  mikrotik_id uuid REFERENCES public.mikrotik_devices(id) ON DELETE CASCADE NOT NULL,
  assigned_by uuid NOT NULL,
  can_manage_pppoe boolean DEFAULT true,
  can_manage_queues boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(secretary_id, mikrotik_id)
);

-- Habilitar RLS en secretary_assignments
ALTER TABLE public.secretary_assignments ENABLE ROW LEVEL SECURITY;

-- Políticas para secretary_assignments
CREATE POLICY "Admins can create secretary assignments"
ON public.secretary_assignments
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin') AND
  EXISTS (
    SELECT 1 FROM public.user_mikrotik_access
    WHERE user_id = auth.uid() AND mikrotik_id = secretary_assignments.mikrotik_id
  )
);

CREATE POLICY "Admins can view secretary assignments for their devices"
ON public.secretary_assignments
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin') AND
  EXISTS (
    SELECT 1 FROM public.user_mikrotik_access
    WHERE user_id = auth.uid() AND mikrotik_id = secretary_assignments.mikrotik_id
  )
);

CREATE POLICY "Admins can update their secretary assignments"
ON public.secretary_assignments
FOR UPDATE
TO authenticated
USING (assigned_by = auth.uid());

CREATE POLICY "Admins can delete their secretary assignments"
ON public.secretary_assignments
FOR DELETE
TO authenticated
USING (assigned_by = auth.uid());

CREATE POLICY "Secretaries can view their assignments"
ON public.secretary_assignments
FOR SELECT
TO authenticated
USING (secretary_id = auth.uid());

CREATE POLICY "Super admins can manage all secretary assignments"
ON public.secretary_assignments
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'super_admin'))
WITH CHECK (has_role(auth.uid(), 'super_admin'));

-- Permitir que secretarias vean dispositivos asignados
CREATE POLICY "Secretaries can view assigned mikrotik devices"
ON public.mikrotik_devices
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'secretary') AND
  EXISTS (
    SELECT 1 FROM public.secretary_assignments
    WHERE secretary_id = auth.uid() AND mikrotik_id = mikrotik_devices.id
  ) AND
  status = 'active'
);