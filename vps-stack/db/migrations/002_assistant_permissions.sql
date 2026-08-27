-- ============================================
-- OmniSync · Asistentes (antes "secretarias")
-- MikroTik opcional + permisos de todos los módulos
-- Idempotente: seguro de ejecutar varias veces
-- ============================================

-- 1. El dispositivo MikroTik deja de ser obligatorio
ALTER TABLE secretary_assignments ALTER COLUMN mikrotik_id DROP NOT NULL;

-- El UNIQUE(secretary_id, mikrotik_id) no cubre NULL: garantizamos
-- una sola asignación global por asistente.
CREATE UNIQUE INDEX IF NOT EXISTS secretary_assignments_global_uniq
  ON secretary_assignments (secretary_id)
  WHERE mikrotik_id IS NULL;

-- 2. Permisos faltantes por módulo
DO $$
DECLARE
  col TEXT;
  cols TEXT[] := ARRAY[
    -- ONU / TR-069
    'can_manage_onu','can_view_onu','can_configure_onu_wifi','can_reboot_onu','can_delete_onu',
    -- RADIUS
    'can_manage_radius','can_view_radius_sessions','can_manage_radius_users','can_disconnect_radius',
    -- VPN / WireGuard
    'can_manage_vpn','can_create_vpn_peers','can_delete_vpn_peers',
    -- Contratos
    'can_manage_contracts','can_create_contracts','can_sign_contracts','can_delete_contracts',
    -- Mensajería (Telegram / WhatsApp)
    'can_manage_messaging','can_send_telegram','can_send_whatsapp','can_config_messaging',
    -- Portal cautivo
    'can_manage_portal','can_edit_portal_templates','can_manage_portal_ads',
    -- Monitoreo y diagnóstico
    'can_manage_monitoring','can_view_dashboard','can_view_traffic','can_run_diagnostics','can_view_map',
    -- Dispositivos MikroTik
    'can_manage_devices','can_view_devices','can_edit_devices'
  ];
BEGIN
  FOREACH col IN ARRAY cols LOOP
    EXECUTE format(
      'ALTER TABLE secretary_assignments ADD COLUMN IF NOT EXISTS %I BOOLEAN DEFAULT true',
      col
    );
  END LOOP;
END $$;
