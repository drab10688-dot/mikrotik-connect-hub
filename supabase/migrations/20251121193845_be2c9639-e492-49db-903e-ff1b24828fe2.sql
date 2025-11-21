-- Add status column to mikrotik_devices table
ALTER TABLE public.mikrotik_devices 
ADD COLUMN status text NOT NULL DEFAULT 'pending';

-- Add check constraint for valid statuses
ALTER TABLE public.mikrotik_devices 
ADD CONSTRAINT mikrotik_devices_status_check 
CHECK (status IN ('pending', 'active', 'rejected'));

-- Update existing devices to be active
UPDATE public.mikrotik_devices 
SET status = 'active';

-- Create index for faster queries on status
CREATE INDEX idx_mikrotik_devices_status ON public.mikrotik_devices(status);

-- Update RLS policies to allow users to only see their active devices
DROP POLICY IF EXISTS "Users can view their own mikrotik devices" ON public.mikrotik_devices;

CREATE POLICY "Users can view their own mikrotik devices"
ON public.mikrotik_devices
FOR SELECT
TO authenticated
USING (created_by = auth.uid());

-- Admins can only use active devices they have access to
DROP POLICY IF EXISTS "Admins can view assigned mikrotik devices" ON public.mikrotik_devices;

CREATE POLICY "Admins can view assigned mikrotik devices"
ON public.mikrotik_devices
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  AND EXISTS (
    SELECT 1 FROM user_mikrotik_access 
    WHERE user_id = auth.uid() 
    AND mikrotik_id = mikrotik_devices.id
  )
  AND status = 'active'
);