ALTER TABLE public.custom_programs ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS "Admins can manage programs" ON public.custom_programs;
DROP POLICY IF EXISTS "Authenticated users can view programs" ON public.custom_programs;
DROP POLICY IF EXISTS "Authenticated can view programs" ON public.custom_programs;
DROP POLICY IF EXISTS "Authenticated can insert programs" ON public.custom_programs;
DROP POLICY IF EXISTS "Authenticated can update programs" ON public.custom_programs;
DROP POLICY IF EXISTS "Authenticated can delete programs" ON public.custom_programs;

CREATE POLICY "Authenticated can view programs"
  ON public.custom_programs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert programs"
  ON public.custom_programs FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update programs"
  ON public.custom_programs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete programs"
  ON public.custom_programs FOR DELETE TO authenticated USING (true);