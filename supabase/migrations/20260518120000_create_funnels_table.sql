-- Funis customizados criados pelo profissional (self-service)
-- Cada funil é uma combinação nome + UTMs que o profissional usa nas campanhas

CREATE TABLE public.funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  destination_url text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_funnels_slug ON public.funnels(slug);
CREATE INDEX idx_funnels_active ON public.funnels(active);

ALTER TABLE public.funnels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can manage funnels" ON public.funnels
  FOR ALL TO authenticated USING (is_approved(auth.uid())) WITH CHECK (is_approved(auth.uid()));

CREATE OR REPLACE FUNCTION public.update_funnels_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_funnels_updated_at
BEFORE UPDATE ON public.funnels
FOR EACH ROW EXECUTE FUNCTION public.update_funnels_updated_at();
