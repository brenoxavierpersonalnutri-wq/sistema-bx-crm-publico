CREATE OR REPLACE FUNCTION public.has_module(_user_id uuid, _module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_modules WHERE user_id = _user_id AND module = _module)
$$;

CREATE POLICY "Agenda alunas access can read student tasks" ON public.collaborator_tasks
FOR SELECT TO authenticated
USING (type IN ('reavaliacao','liberacao','residuo') AND public.has_module(auth.uid(), 'agenda-alunas'));

CREATE POLICY "Agenda alunas access can update student tasks" ON public.collaborator_tasks
FOR UPDATE TO authenticated
USING (type IN ('reavaliacao','liberacao','residuo') AND public.has_module(auth.uid(), 'agenda-alunas'))
WITH CHECK (type IN ('reavaliacao','liberacao','residuo') AND public.has_module(auth.uid(), 'agenda-alunas'));