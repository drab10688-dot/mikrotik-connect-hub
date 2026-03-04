
ALTER TABLE public.secretary_assignments
  -- Clientes sub-permissions
  ADD COLUMN IF NOT EXISTS can_create_clients boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_edit_clients boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_delete_clients boolean DEFAULT true,
  -- Pagos sub-permissions
  ADD COLUMN IF NOT EXISTS can_record_payments boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_view_payment_history boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_reactivate_services boolean DEFAULT true,
  -- Facturación sub-permissions
  ADD COLUMN IF NOT EXISTS can_create_invoices boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_edit_invoices boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_delete_invoices boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_send_invoices boolean DEFAULT true,
  -- Reportes sub-permissions
  ADD COLUMN IF NOT EXISTS can_view_reports_dashboard boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_export_reports boolean DEFAULT true,
  -- Address List sub-permissions
  ADD COLUMN IF NOT EXISTS can_create_address_list boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_delete_address_list boolean DEFAULT true,
  -- Backup sub-permissions
  ADD COLUMN IF NOT EXISTS can_create_backup boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_restore_backup boolean DEFAULT true,
  -- VPS sub-permissions
  ADD COLUMN IF NOT EXISTS can_view_vps boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_manage_vps_docker boolean DEFAULT true;
