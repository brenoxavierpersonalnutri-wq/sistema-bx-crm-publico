CREATE TABLE IF NOT EXISTS public.pesquisa_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  nome text NOT NULL,
  tempo_programa text,
  plano text,
  satisfacao_geral int CHECK (satisfacao_geral BETWEEN 0 AND 10),
  expectativa_resultado int CHECK (expectativa_resultado BETWEEN 0 AND 10),
  surpreendeu text,
  decepcionou text,
  wpp_satisfacao int CHECK (wpp_satisfacao BETWEEN 0 AND 10),
  wpp_tempo_resposta int CHECK (wpp_tempo_resposta BETWEEN 0 AND 10),
  wpp_clareza int CHECK (wpp_clareza BETWEEN 0 AND 10),
  wpp_frequencia text,
  wpp_ouvida text,
  wpp_melhorar text,
  comercial_nota int CHECK (comercial_nota BETWEEN 0 AND 10),
  comercial_pressao text,
  comercial_clareza text,
  comercial_melhorar text,
  insta_frequencia text,
  insta_utilidade int CHECK (insta_utilidade BETWEEN 0 AND 10),
  insta_tipos text[],
  insta_ver_mais text,
  insta_cortar text,
  nps_nota int CHECK (nps_nota BETWEEN 0 AND 10),
  nps_motivo text,
  nps_indicou text,
  nps_quem_fechou text,
  nps_depoimento text,
  mudaria_uma_coisa text,
  impede_resultado text,
  livre text
);

ALTER TABLE public.pesquisa_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can insert pesquisa_responses"
ON public.pesquisa_responses
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated can read pesquisa_responses"
ON public.pesquisa_responses
FOR SELECT
TO authenticated
USING (true);

CREATE INDEX IF NOT EXISTS pesquisa_responses_created_at_idx
ON public.pesquisa_responses (created_at DESC);