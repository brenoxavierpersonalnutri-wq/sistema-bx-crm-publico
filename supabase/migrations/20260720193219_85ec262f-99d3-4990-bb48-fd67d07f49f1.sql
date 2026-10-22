GRANT INSERT ON public.candidaturas_parceria TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidaturas_parceria TO authenticated;
GRANT ALL ON public.candidaturas_parceria TO service_role;
NOTIFY pgrst, 'reload schema';