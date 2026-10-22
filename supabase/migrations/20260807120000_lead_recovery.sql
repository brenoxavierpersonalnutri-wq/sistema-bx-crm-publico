-- Marcação manual do time sobre a recuperação de cada lead do formulário.
-- Uma linha por resposta (form_response_id), criada só quando o time marca algo.
CREATE TABLE IF NOT EXISTS public.lead_recovery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_response_id uuid NOT NULL UNIQUE
    REFERENCES public.lead_form_responses(id) ON DELETE CASCADE,
  -- nao_trabalhado | tentando | sem_resposta | numero_errado | recuperada | descartada
  status text NOT NULL DEFAULT 'nao_trabalhado',
  nota text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_recovery_form_response_id_idx
  ON public.lead_recovery(form_response_id);
CREATE INDEX IF NOT EXISTS lead_recovery_status_idx
  ON public.lead_recovery(status);

ALTER TABLE public.lead_recovery ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all" ON public.lead_recovery;
CREATE POLICY "auth_all" ON public.lead_recovery
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_recovery TO authenticated;
GRANT ALL ON public.lead_recovery TO service_role;

NOTIFY pgrst, 'reload schema';
