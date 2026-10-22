-- -----------------------------------------------------------------------------
-- Anamnese inicial da aluna, saindo do Google Forms pra dentro do sistema.
--
-- O time clica na aluna e gera a anamnese: nasce uma linha com um token, e o
-- link /anamnese/<token> é só dela. A aluna responde sem login; a resposta cai
-- na ficha dela.
--
-- A tabela NÃO é exposta pra quem não está logado. A aluna chega nela por duas
-- funções SECURITY DEFINER: uma pra abrir (devolve só o nome e o status) e uma
-- pra enviar. Assim o token dá acesso ao formulário, não à tabela.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.anamnese_respostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluna_id uuid NOT NULL REFERENCES public.alunas(id) ON DELETE CASCADE,
  -- gen_random_uuid() é nativo do Postgres; não depende do pgcrypto estar no
  -- search_path, que é o tipo de detalhe que quebra ao colar no SQL Editor.
  token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'respondida')),
  respondida_em timestamptz,

  -- Seção 1: quem é ela
  nome_completo text,
  instagram text,
  treina_onde text,
  data_nascimento date,
  profissao text,
  peso_altura text,
  restricao_medica text,
  ansiedade text,
  horas_trabalho text,
  esforco_diario text,
  horas_sono text,
  qualidade_sono text,
  intestino text,
  objetivo_atingido text,
  tres_incomodos text,
  modelo_corpo text,
  historico_corpo text,

  -- Seção 2: treino
  dores text,
  treina_musculacao text,
  treina_musculacao_outro text,
  dias_disponiveis text, -- múltipla escolha, valores separados por vírgula
  tempo_sessao text,
  outro_exercicio text,
  comentario_treino text,

  -- Seção 3: alimentação
  acompanhamento_nutricional text,
  restricao_alimentar text,
  define_alimentacao text,
  bebida_alcoolica text,
  fuma text,
  ingestao_doces text,
  dificuldade_alimentacao text,
  leva_refeicoes text,
  historico_cardiovascular text,
  refeicoes_dia integer CHECK (refeicoes_dia BETWEEN 1 AND 6),
  suplemento text,
  medicacao text,
  desconta_estresse text,
  pronta_mudanca integer CHECK (pronta_mudanca BETWEEN 0 AND 10),
  capaz_mudanca integer CHECK (capaz_mudanca BETWEEN 0 AND 10),
  suporte_ambiente integer CHECK (suporte_ambiente BETWEEN 0 AND 10),
  rotina_alimentar text,
  aceite boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anamnese_aluna ON public.anamnese_respostas (aluna_id, created_at DESC);

-- Pra quem já rodou este arquivo antes desta coluna existir.
ALTER TABLE public.anamnese_respostas
  ADD COLUMN IF NOT EXISTS treina_musculacao_outro text;

ALTER TABLE public.anamnese_respostas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_gerencia_anamnese" ON public.anamnese_respostas;
CREATE POLICY "time_gerencia_anamnese" ON public.anamnese_respostas
  FOR ALL TO authenticated
  USING (public.is_approved(auth.uid()))
  WITH CHECK (public.is_approved(auth.uid()));

-- A aluna logada no app vê a própria anamnese.
DROP POLICY IF EXISTS "aluna_le_sua_anamnese" ON public.anamnese_respostas;
CREATE POLICY "aluna_le_sua_anamnese" ON public.anamnese_respostas
  FOR SELECT TO authenticated
  USING (anamnese_respostas.aluna_id = public.aluna_do_usuario(auth.uid()));

NOTIFY pgrst, 'reload schema';
