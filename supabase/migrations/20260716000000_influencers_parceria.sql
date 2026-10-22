-- Tabela para influencers cadastradas manualmente (monitoramento de parceria)
CREATE TABLE IF NOT EXISTS influencers_parceria (
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
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE influencers_parceria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all" ON influencers_parceria
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
