CREATE POLICY "Approved users can read team profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.is_approved(auth.uid()));