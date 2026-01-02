-- Create storage bucket for company assets (logos, etc.)
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-assets', 'company-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload company assets
CREATE POLICY "Authenticated users can upload company assets"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'company-assets');

-- Allow public read access to company assets
CREATE POLICY "Public can view company assets"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'company-assets');

-- Allow users to update their own uploaded assets
CREATE POLICY "Users can update their own company assets"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'company-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow users to delete their own uploaded assets
CREATE POLICY "Users can delete their own company assets"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'company-assets' AND auth.uid()::text = (storage.foldername(name))[1]);