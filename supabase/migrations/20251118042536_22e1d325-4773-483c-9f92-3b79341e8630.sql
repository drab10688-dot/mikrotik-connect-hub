-- Permitir que usuarios regulares creen y gestionen sus propios dispositivos MikroTik

-- Política para que usuarios puedan ver sus propios dispositivos
CREATE POLICY "Users can view their own mikrotik devices" 
ON public.mikrotik_devices 
FOR SELECT 
USING (created_by = auth.uid());

-- Política para que usuarios puedan crear sus propios dispositivos
CREATE POLICY "Users can create their own mikrotik devices" 
ON public.mikrotik_devices 
FOR INSERT 
WITH CHECK (created_by = auth.uid());

-- Política para que usuarios puedan actualizar sus propios dispositivos
CREATE POLICY "Users can update their own mikrotik devices" 
ON public.mikrotik_devices 
FOR UPDATE 
USING (created_by = auth.uid());

-- Política para que usuarios puedan eliminar sus propios dispositivos
CREATE POLICY "Users can delete their own mikrotik devices" 
ON public.mikrotik_devices 
FOR DELETE 
USING (created_by = auth.uid());