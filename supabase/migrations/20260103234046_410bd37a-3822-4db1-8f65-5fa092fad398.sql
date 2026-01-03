-- Remove the hardcoded email bypass trigger and function
-- This is a security vulnerability that grants automatic access to specific devices based on hardcoded email

-- Drop the trigger first (if it exists)
DROP TRIGGER IF EXISTS on_profile_created_assign_device ON public.profiles;

-- Drop the function that contains the hardcoded email bypass
DROP FUNCTION IF EXISTS public.auto_assign_device_by_email();
