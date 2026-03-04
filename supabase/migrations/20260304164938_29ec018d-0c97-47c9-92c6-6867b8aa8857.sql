
ALTER TABLE public.secretary_assignments
  ADD COLUMN IF NOT EXISTS can_create_hotspot_users boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_edit_hotspot_users boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_delete_hotspot_users boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_manage_vouchers boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_sell_vouchers boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_print_vouchers boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_view_hotspot_accounting boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_view_hotspot_reports boolean DEFAULT true;
