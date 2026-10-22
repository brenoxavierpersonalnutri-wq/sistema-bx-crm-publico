CREATE TABLE public.influencers_parceria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  instagram text,
  phone text,
  email text,
  status text NOT NULL DEFAULT 'contato',
  feed_post_date date,
  stories_rating int CHECK (stories_rating >= 0 AND stories_rating <= 10),
  stories_active boolean,
  sales_count int NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.influencers_parceria TO authenticated;
GRANT ALL ON public.influencers_parceria TO service_role;

ALTER TABLE public.influencers_parceria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários autenticados gerenciam influencers" ON public.influencers_parceria
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_influencers_parceria_updated_at
  BEFORE UPDATE ON public.influencers_parceria
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();