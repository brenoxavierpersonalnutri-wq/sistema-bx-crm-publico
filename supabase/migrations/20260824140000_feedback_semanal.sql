-- Base principal do Feedback Semanal / Quinzenal das alunas da consultoria.
-- Mesma convenção de RLS da pesquisa de satisfação: a aluna (anon) só insere,
-- o time autenticado lê tudo pelo dashboard. Idempotente.

CREATE TABLE IF NOT EXISTS public.feedback_semanal_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  produto text,
  periodicidade text,

  nome text NOT NULL,
  telefone text,

  -- Treino: qualidade de execução
  treino_execucao int CHECK (treino_execucao BETWEEN 0 AND 10),
  treino_progressao_carga int CHECK (treino_progressao_carga BETWEEN 0 AND 10),
  treino_series_validas int CHECK (treino_series_validas BETWEEN 0 AND 10),

  -- Treino: volume
  treino_frequencia_semanal text,
  treino_minutos_semanais text,
  cardio_intensidade int CHECK (cardio_intensidade BETWEEN 0 AND 10),

  -- Dieta
  dieta_nota int CHECK (dieta_nota BETWEEN 0 AND 10),
  dieta_adesao int CHECK (dieta_adesao BETWEEN 0 AND 10),
  dieta_refeicoes_fora text,
  dieta_beliscando text,

  -- Leitura geral
  maior_gargalo text,
  percebe_mudanca text,
  mudanca_descricao text,
  consultoria_feedback text
);

ALTER TABLE public.feedback_semanal_responses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feedback_semanal_responses'
      AND policyname = 'Anon can insert feedback_semanal_responses'
  ) THEN
    CREATE POLICY "Anon can insert feedback_semanal_responses"
    ON public.feedback_semanal_responses
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feedback_semanal_responses'
      AND policyname = 'Authenticated can read feedback_semanal_responses'
  ) THEN
    CREATE POLICY "Authenticated can read feedback_semanal_responses"
    ON public.feedback_semanal_responses
    FOR SELECT
    TO authenticated
    USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS feedback_semanal_responses_created_at_idx
ON public.feedback_semanal_responses (created_at DESC);

CREATE INDEX IF NOT EXISTS feedback_semanal_responses_produto_idx
ON public.feedback_semanal_responses (produto);

-- Busca por aluna no dashboard (histórico semana a semana da mesma pessoa).
CREATE INDEX IF NOT EXISTS feedback_semanal_responses_nome_idx
ON public.feedback_semanal_responses (lower(nome));
