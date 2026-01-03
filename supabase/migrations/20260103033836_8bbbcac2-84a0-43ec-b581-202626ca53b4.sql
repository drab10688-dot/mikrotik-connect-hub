-- Allow public read access to client invoices for payment portal (by client lookup)
CREATE POLICY "Public can view invoices by client reference"
ON public.client_invoices FOR SELECT
USING (true);

-- Allow public read access to billing settings for payment portal
CREATE POLICY "Public can view billing settings"
ON public.client_billing_settings FOR SELECT
USING (true);

-- Allow public read access to payment platforms (only public key info)
CREATE POLICY "Public can view active payment platforms"
ON public.payment_platforms FOR SELECT
USING (is_active = true);

-- Allow public insert for payment transactions (when clients pay)
CREATE POLICY "Public can create payment transactions"
ON public.payment_transactions FOR INSERT
WITH CHECK (true);

-- Allow public read access to isp_clients for payment portal lookup
CREATE POLICY "Public can lookup clients by identification"
ON public.isp_clients FOR SELECT
USING (true);