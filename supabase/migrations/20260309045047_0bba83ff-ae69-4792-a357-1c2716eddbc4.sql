-- Tighten rotator RLS to use is_approved
DROP POLICY "Authenticated users can manage rotator_links" ON public.rotator_links;
CREATE POLICY "Approved users can manage rotator_links" ON public.rotator_links
  FOR ALL TO authenticated USING (is_approved(auth.uid())) WITH CHECK (is_approved(auth.uid()));

DROP POLICY "Authenticated users can manage rotator_destinations" ON public.rotator_destinations;
CREATE POLICY "Approved users can manage rotator_destinations" ON public.rotator_destinations
  FOR ALL TO authenticated USING (is_approved(auth.uid())) WITH CHECK (is_approved(auth.uid()));

DROP POLICY "Authenticated users can read rotator_clicks" ON public.rotator_clicks;
CREATE POLICY "Approved users can read rotator_clicks" ON public.rotator_clicks
  FOR SELECT TO authenticated USING (is_approved(auth.uid()));

DROP POLICY "Authenticated users can read rotator_events" ON public.rotator_events;
CREATE POLICY "Approved users can read rotator_events" ON public.rotator_events
  FOR SELECT TO authenticated USING (is_approved(auth.uid()));