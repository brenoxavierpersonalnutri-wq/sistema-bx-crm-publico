
CREATE TABLE IF NOT EXISTS public.funnels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  destination_url TEXT,
  tracked_url TEXT,
  parent_id UUID REFERENCES public.funnels(id) ON DELETE CASCADE,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_funnels_parent ON public.funnels(parent_id);

ALTER TABLE public.funnels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can read funnels"
  ON public.funnels FOR SELECT TO authenticated
  USING (is_approved(auth.uid()));

CREATE POLICY "Approved users can insert funnels"
  ON public.funnels FOR INSERT TO authenticated
  WITH CHECK (is_approved(auth.uid()));

CREATE POLICY "Approved users can update funnels"
  ON public.funnels FOR UPDATE TO authenticated
  USING (is_approved(auth.uid()));

CREATE POLICY "Approved users can delete funnels"
  ON public.funnels FOR DELETE TO authenticated
  USING (is_approved(auth.uid()));

CREATE TRIGGER update_funnels_updated_at
BEFORE UPDATE ON public.funnels
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
