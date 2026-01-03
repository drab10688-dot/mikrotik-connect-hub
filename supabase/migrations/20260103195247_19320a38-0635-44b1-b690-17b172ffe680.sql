-- Drop the old restrictive insert policy
DROP POLICY IF EXISTS "Authenticated users can upload company assets" ON storage.objects;

-- Create a more flexible insert policy that allows authenticated users to upload to company-assets bucket
CREATE POLICY "Authenticated users can upload to company-assets" 
ON storage.objects 
FOR INSERT 
TO authenticated
WITH CHECK (bucket_id = 'company-assets');

-- Also allow authenticated users to update files in the invoices folder
DROP POLICY IF EXISTS "Users can update their own company assets" ON storage.objects;

CREATE POLICY "Authenticated users can update company assets" 
ON storage.objects 
FOR UPDATE 
TO authenticated
USING (bucket_id = 'company-assets')
WITH CHECK (bucket_id = 'company-assets');

-- Allow authenticated users to delete their uploaded files
DROP POLICY IF EXISTS "Users can delete their own company assets" ON storage.objects;

CREATE POLICY "Authenticated users can delete company assets" 
ON storage.objects 
FOR DELETE 
TO authenticated
USING (bucket_id = 'company-assets');