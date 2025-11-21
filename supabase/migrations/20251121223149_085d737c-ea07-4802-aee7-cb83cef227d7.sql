-- Agregar política DELETE para super admins en profiles
CREATE POLICY "Super admins can delete profiles"
ON public.profiles
FOR DELETE
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
);

-- Agregar política DELETE para super admins en user_roles
CREATE POLICY "Super admins can delete user roles"
ON public.user_roles
FOR DELETE  
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
);