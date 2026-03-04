
-- Add new permission columns to secretary_assignments
ALTER TABLE public.secretary_assignments
  ADD COLUMN IF NOT EXISTS can_manage_clients boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_manage_payments boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_manage_billing boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_manage_reports boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_manage_hotspot boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_manage_address_list boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_manage_backup boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_manage_vps_services boolean DEFAULT true;
