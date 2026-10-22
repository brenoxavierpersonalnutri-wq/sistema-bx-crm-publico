
CREATE TABLE public.custom_programs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  value TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  programa TEXT NOT NULL DEFAULT 'consultoria_slim',
  duracao TEXT NOT NULL DEFAULT '1',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.custom_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view programs"
ON public.custom_programs FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can manage programs"
ON public.custom_programs FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
