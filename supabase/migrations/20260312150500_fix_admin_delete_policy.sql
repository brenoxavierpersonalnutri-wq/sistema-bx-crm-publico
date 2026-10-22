-- Add delete policy for admins on the profiles table
CREATE POLICY "Admins can delete all profiles"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
