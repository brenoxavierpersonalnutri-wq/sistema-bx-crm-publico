CREATE POLICY "Approved users can read consultations"
ON public.consultations
FOR SELECT
TO authenticated
USING (is_approved(auth.uid()));