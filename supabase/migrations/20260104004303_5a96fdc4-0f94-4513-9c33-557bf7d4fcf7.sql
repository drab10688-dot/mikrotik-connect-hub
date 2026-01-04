-- Add DELETE policies for client_invoices
CREATE POLICY "Admins can delete invoices for their mikrotiks" 
ON public.client_invoices 
FOR DELETE 
USING (
  has_role(auth.uid(), 'admin'::app_role) AND 
  EXISTS (
    SELECT 1 FROM user_mikrotik_access 
    WHERE user_mikrotik_access.user_id = auth.uid() 
    AND user_mikrotik_access.mikrotik_id = client_invoices.mikrotik_id
  )
);

-- Add DELETE policy for telegram_config
CREATE POLICY "Users can delete telegram config for their devices" 
ON public.telegram_config 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM user_mikrotik_access 
    WHERE user_mikrotik_access.mikrotik_id = telegram_config.mikrotik_id 
    AND user_mikrotik_access.user_id = auth.uid()
  )
);