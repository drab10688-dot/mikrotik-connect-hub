-- Drop existing secretary policy for mikrotik_devices if it exists
DROP POLICY IF EXISTS "Secretaries can view assigned mikrotik devices" ON public.mikrotik_devices;

-- Create comprehensive policy for secretaries to view assigned devices
CREATE POLICY "Secretaries can view assigned mikrotik devices"
ON public.mikrotik_devices
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'secretary'::app_role) 
  AND EXISTS (
    SELECT 1
    FROM public.secretary_assignments
    WHERE secretary_assignments.secretary_id = auth.uid()
      AND secretary_assignments.mikrotik_id = mikrotik_devices.id
  )
  AND status = 'active'
);

-- Allow secretaries to update device connection info (but not delete or create)
CREATE POLICY "Secretaries can update assigned mikrotik devices"
ON public.mikrotik_devices
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'secretary'::app_role) 
  AND EXISTS (
    SELECT 1
    FROM public.secretary_assignments
    WHERE secretary_assignments.secretary_id = auth.uid()
      AND secretary_assignments.mikrotik_id = mikrotik_devices.id
  )
  AND status = 'active'
)
WITH CHECK (
  public.has_role(auth.uid(), 'secretary'::app_role) 
  AND EXISTS (
    SELECT 1
    FROM public.secretary_assignments
    WHERE secretary_assignments.secretary_id = auth.uid()
      AND secretary_assignments.mikrotik_id = mikrotik_devices.id
  )
  AND status = 'active'
);

-- Ensure secretaries can view their own assignments
DROP POLICY IF EXISTS "Secretaries can view their assignments" ON public.secretary_assignments;

CREATE POLICY "Secretaries can view their assignments"
ON public.secretary_assignments
FOR SELECT
TO authenticated
USING (secretary_id = auth.uid());