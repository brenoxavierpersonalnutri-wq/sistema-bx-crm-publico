
CREATE TABLE public.candidaturas_parceria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  nome text NOT NULL,
  idade int,
  cidade text,
  whatsapp text,
  instagram text,
  seguidores int,
  media_stories int,
  media_comentarios int,
  publico_cliente text,
  comunidade text,
  objetivo text,
  motivo_interesse text,
  rede_ativo int,
  interesse_crescer int,
  retorno_financeiro text,
  interesse_formato text[],
  contribuicao text,
  quer_parceria int,
  observacao text,
  status text NOT NULL DEFAULT 'pendente',
  slug text UNIQUE,
  checkin jsonb NOT NULL DEFAULT '{}'::jsonb,
  notas text
);

GRANT INSERT ON public.candidaturas_parceria TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidaturas_parceria TO authenticated;
GRANT ALL ON public.candidaturas_parceria TO service_role;

ALTER TABLE public.candidaturas_parceria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit application"
  ON public.candidaturas_parceria
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can view"
  ON public.candidaturas_parceria
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can update"
  ON public.candidaturas_parceria
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated can delete"
  ON public.candidaturas_parceria
  FOR DELETE
  TO authenticated
  USING (true);

CREATE TRIGGER update_candidaturas_parceria_updated_at
  BEFORE UPDATE ON public.candidaturas_parceria
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
