-- Paso 2: Crear tabla de presets de vouchers
CREATE TABLE IF NOT EXISTS public.voucher_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  validity TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  description TEXT,
  mikrotik_id UUID REFERENCES public.mikrotik_devices(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.voucher_presets ENABLE ROW LEVEL SECURITY;

-- Políticas para presets
CREATE POLICY "Users can view presets for their mikrotiks"
  ON public.voucher_presets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_mikrotik_access
      WHERE user_id = auth.uid() AND mikrotik_id = voucher_presets.mikrotik_id
    )
  );

CREATE POLICY "Admins can create presets for their mikrotiks"
  ON public.voucher_presets
  FOR INSERT
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) AND
    EXISTS (
      SELECT 1 FROM public.user_mikrotik_access
      WHERE user_id = auth.uid() AND mikrotik_id = voucher_presets.mikrotik_id
    )
  );

CREATE POLICY "Admins can update their presets"
  ON public.voucher_presets
  FOR UPDATE
  USING (created_by = auth.uid());

CREATE POLICY "Admins can delete their presets"
  ON public.voucher_presets
  FOR DELETE
  USING (created_by = auth.uid());

CREATE POLICY "Super admins can manage all presets"
  ON public.voucher_presets
  FOR ALL
  USING (has_role(auth.uid(), 'super_admin'::app_role));

-- Tabla para asignación de resellers a dispositivos específicos
CREATE TABLE IF NOT EXISTS public.reseller_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id UUID NOT NULL,
  mikrotik_id UUID NOT NULL REFERENCES public.mikrotik_devices(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL,
  commission_percentage NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(reseller_id, mikrotik_id)
);

-- Habilitar RLS para reseller_assignments
ALTER TABLE public.reseller_assignments ENABLE ROW LEVEL SECURITY;

-- Políticas para reseller_assignments
CREATE POLICY "Admins can view reseller assignments for their devices"
  ON public.reseller_assignments
  FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role) AND
    EXISTS (
      SELECT 1 FROM public.user_mikrotik_access
      WHERE user_id = auth.uid() AND mikrotik_id = reseller_assignments.mikrotik_id
    )
  );

CREATE POLICY "Resellers can view their own assignments"
  ON public.reseller_assignments
  FOR SELECT
  USING (reseller_id = auth.uid());

CREATE POLICY "Admins can create reseller assignments"
  ON public.reseller_assignments
  FOR INSERT
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) AND
    EXISTS (
      SELECT 1 FROM public.user_mikrotik_access
      WHERE user_id = auth.uid() AND mikrotik_id = reseller_assignments.mikrotik_id
    )
  );

CREATE POLICY "Admins can update reseller assignments"
  ON public.reseller_assignments
  FOR UPDATE
  USING (assigned_by = auth.uid());

CREATE POLICY "Admins can delete reseller assignments"
  ON public.reseller_assignments
  FOR DELETE
  USING (assigned_by = auth.uid());

CREATE POLICY "Super admins can manage all assignments"
  ON public.reseller_assignments
  FOR ALL
  USING (has_role(auth.uid(), 'super_admin'::app_role));

-- Actualizar políticas de vouchers para resellers
CREATE POLICY "Resellers can view vouchers for assigned mikrotiks"
  ON public.vouchers
  FOR SELECT
  USING (
    has_role(auth.uid(), 'reseller'::app_role) AND
    EXISTS (
      SELECT 1 FROM public.reseller_assignments
      WHERE reseller_id = auth.uid() AND mikrotik_id = vouchers.mikrotik_id
    )
  );

CREATE POLICY "Resellers can sell vouchers"
  ON public.vouchers
  FOR UPDATE
  USING (
    has_role(auth.uid(), 'reseller'::app_role) AND
    EXISTS (
      SELECT 1 FROM public.reseller_assignments
      WHERE reseller_id = auth.uid() AND mikrotik_id = vouchers.mikrotik_id
    ) AND
    status = 'available'
  )
  WITH CHECK (
    status = 'sold' AND sold_by = auth.uid()
  );

-- Trigger para actualizar updated_at en presets
CREATE TRIGGER update_voucher_presets_updated_at
  BEFORE UPDATE ON public.voucher_presets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();