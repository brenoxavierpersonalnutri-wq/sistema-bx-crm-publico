CREATE POLICY "Approved users can delete sales_events"
ON public.sales_events
FOR DELETE
TO authenticated
USING (public.is_approved(auth.uid()));