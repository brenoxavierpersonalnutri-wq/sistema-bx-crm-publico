-- =============================================================================
-- APP DA ALUNA — treino, dieta e feedback
-- =============================================================================
-- Camada que serve o aplicativo da aluna (inspirado no MFit Personal):
--   * biblioteca de exercicios com video do YouTube
--   * fases de treino reutilizaveis (ex.: as 12 fases do metodo)
--   * plano da aluna = fila de fases liberadas automaticamente mes a mes
--   * execucao de treino registrada pela aluna
--   * dieta (PDF ou texto) entregue dentro do app
--   * feedback semanal / quinzenal
--
-- Regra de acesso, em duas faixas:
--   * time (profiles.approved = true) -> enxerga e edita tudo
--   * aluna (auth.users vinculada em aluna_acessos) -> so o que e dela,
--     e so as fases cuja data de liberacao ja chegou
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Acesso da aluna: liga um usuario do auth a uma linha de public.alunas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aluna_acessos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluna_id      uuid NOT NULL REFERENCES public.alunas(id) ON DELETE CASCADE,
  user_id       uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email         text NOT NULL,
  convite_token text UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  ativo         boolean NOT NULL DEFAULT true,
  ultimo_acesso timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aluna_id)
);

CREATE INDEX IF NOT EXISTS idx_aluna_acessos_user  ON public.aluna_acessos(user_id);
CREATE INDEX IF NOT EXISTS idx_aluna_acessos_email ON public.aluna_acessos(lower(email));

-- Resolve "qual aluna e este usuario logado". SECURITY DEFINER para nao cair
-- em recursao de RLS quando as outras policies chamarem esta funcao.
CREATE OR REPLACE FUNCTION public.aluna_do_usuario(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT aluna_id
  FROM public.aluna_acessos
  WHERE user_id = _user_id AND ativo = true
  LIMIT 1
$$;

-- Açúcar para as policies: "a linha pertence a aluna logada?"
CREATE OR REPLACE FUNCTION public.e_minha_aluna(_aluna_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _aluna_id IS NOT NULL
     AND _aluna_id = public.aluna_do_usuario(auth.uid())
$$;


-- -----------------------------------------------------------------------------
-- 2. Biblioteca de exercicios (com video do YouTube)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exercicios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            text NOT NULL,
  grupo_muscular  text NOT NULL DEFAULT 'outro',
  equipamento     text,
  youtube_url     text,
  youtube_id      text,
  thumbnail_url   text,
  instrucoes      text,
  nivel           text NOT NULL DEFAULT 'todos',
  tags            text[] NOT NULL DEFAULT '{}',
  ativo           boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exercicios_grupo ON public.exercicios(grupo_muscular);
CREATE INDEX IF NOT EXISTS idx_exercicios_ativo ON public.exercicios(ativo);
CREATE INDEX IF NOT EXISTS idx_exercicios_nome  ON public.exercicios(lower(nome));

-- Extrai o id de 11 caracteres de qualquer formato de link do YouTube
-- (watch?v=, youtu.be/, /embed/, /shorts/) e deriva a thumbnail.
CREATE OR REPLACE FUNCTION public.exercicio_preenche_youtube()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  vid text;
BEGIN
  IF NEW.youtube_url IS NULL OR btrim(NEW.youtube_url) = '' THEN
    NEW.youtube_id := NULL;
    NEW.thumbnail_url := NULL;
    RETURN NEW;
  END IF;

  vid := substring(NEW.youtube_url from '(?:v=|youtu\.be/|/embed/|/shorts/|/live/)([A-Za-z0-9_-]{11})');

  -- Link ja colado como id puro
  IF vid IS NULL AND NEW.youtube_url ~ '^[A-Za-z0-9_-]{11}$' THEN
    vid := NEW.youtube_url;
  END IF;

  NEW.youtube_id := vid;
  NEW.thumbnail_url := CASE
    WHEN vid IS NULL THEN NULL
    ELSE 'https://i.ytimg.com/vi/' || vid || '/hqdefault.jpg'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exercicios_youtube ON public.exercicios;
CREATE TRIGGER trg_exercicios_youtube
  BEFORE INSERT OR UPDATE OF youtube_url ON public.exercicios
  FOR EACH ROW EXECUTE FUNCTION public.exercicio_preenche_youtube();


-- -----------------------------------------------------------------------------
-- 3. Fases de treino (templates reutilizaveis)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.treino_fases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            text NOT NULL,
  ordem           int  NOT NULL DEFAULT 1,
  objetivo        text,
  descricao       text,
  duracao_semanas int  NOT NULL DEFAULT 4,
  nivel           text NOT NULL DEFAULT 'todos',
  cor             text,
  ativo           boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treino_fases_ordem ON public.treino_fases(ordem);

-- Um dia de treino dentro da fase (Treino A, Treino B, ...)
CREATE TABLE IF NOT EXISTS public.treino_dias (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fase_id    uuid NOT NULL REFERENCES public.treino_fases(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  ordem      int  NOT NULL DEFAULT 1,
  foco       text,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treino_dias_fase ON public.treino_dias(fase_id, ordem);

-- A prescricao em si: exercicio + series/reps/cadencia/metodo/observacao
CREATE TABLE IF NOT EXISTS public.treino_exercicios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dia_id          uuid NOT NULL REFERENCES public.treino_dias(id) ON DELETE CASCADE,
  exercicio_id    uuid NOT NULL REFERENCES public.exercicios(id) ON DELETE RESTRICT,
  ordem           int  NOT NULL DEFAULT 1,
  series          int  NOT NULL DEFAULT 3,
  repeticoes      text NOT NULL DEFAULT '12',
  carga_sugerida  text,
  cadencia        text,
  descanso_seg    int,
  metodo_avancado text,
  observacao      text,
  -- Letra do agrupamento: exercicios com a mesma letra formam bi-set / tri-set
  agrupamento     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treino_exercicios_dia ON public.treino_exercicios(dia_id, ordem);


-- -----------------------------------------------------------------------------
-- 4. Plano da aluna: fila de fases com liberacao automatica mes a mes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aluna_planos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluna_id       uuid NOT NULL REFERENCES public.alunas(id) ON DELETE CASCADE,
  nome           text NOT NULL DEFAULT 'Plano de treino',
  data_inicio    date NOT NULL DEFAULT CURRENT_DATE,
  intervalo_dias int  NOT NULL DEFAULT 30,
  auto_avancar   boolean NOT NULL DEFAULT true,
  status         text NOT NULL DEFAULT 'ativo',
  observacao     text,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aluna_planos_aluna ON public.aluna_planos(aluna_id, status);

-- Cada fase enfileirada, com a data em que abre para a aluna
CREATE TABLE IF NOT EXISTS public.aluna_plano_fases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id        uuid NOT NULL REFERENCES public.aluna_planos(id) ON DELETE CASCADE,
  fase_id         uuid NOT NULL REFERENCES public.treino_fases(id) ON DELETE RESTRICT,
  ordem           int  NOT NULL,
  data_liberacao  date NOT NULL,
  concluida_em    timestamptz,
  observacao      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plano_id, ordem)
);

CREATE INDEX IF NOT EXISTS idx_aluna_plano_fases_plano ON public.aluna_plano_fases(plano_id, ordem);


-- -----------------------------------------------------------------------------
-- 5. Execucao: o que a aluna marcou como feito
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aluna_treino_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluna_id       uuid NOT NULL REFERENCES public.alunas(id) ON DELETE CASCADE,
  plano_fase_id  uuid REFERENCES public.aluna_plano_fases(id) ON DELETE SET NULL,
  dia_id         uuid REFERENCES public.treino_dias(id) ON DELETE SET NULL,
  data           date NOT NULL DEFAULT CURRENT_DATE,
  concluido      boolean NOT NULL DEFAULT true,
  duracao_min    int,
  intensidade    int CHECK (intensidade BETWEEN 1 AND 10),
  observacao     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aluna_id, dia_id, data)
);

CREATE INDEX IF NOT EXISTS idx_treino_logs_aluna ON public.aluna_treino_logs(aluna_id, data DESC);

CREATE TABLE IF NOT EXISTS public.aluna_exercicio_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treino_log_id       uuid NOT NULL REFERENCES public.aluna_treino_logs(id) ON DELETE CASCADE,
  treino_exercicio_id uuid REFERENCES public.treino_exercicios(id) ON DELETE SET NULL,
  series_feitas       int,
  carga_usada         text,
  observacao          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exercicio_logs_treino ON public.aluna_exercicio_logs(treino_log_id);


-- -----------------------------------------------------------------------------
-- 6. Dieta entregue dentro do app
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aluna_dietas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluna_id         uuid NOT NULL REFERENCES public.alunas(id) ON DELETE CASCADE,
  titulo           text NOT NULL DEFAULT 'Plano alimentar',
  tipo             text NOT NULL DEFAULT 'pdf',
  arquivo_path     text,
  arquivo_nome     text,
  conteudo         text,
  observacao       text,
  vigencia_inicio  date NOT NULL DEFAULT CURRENT_DATE,
  vigencia_fim     date,
  ativo            boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aluna_dietas_aluna ON public.aluna_dietas(aluna_id, ativo, vigencia_inicio DESC);


-- -----------------------------------------------------------------------------
-- 7. Feedback semanal / quinzenal
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feedback_ciclos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluna_id      uuid NOT NULL REFERENCES public.alunas(id) ON DELETE CASCADE,
  periodicidade text NOT NULL DEFAULT 'quinzenal',
  dia_semana    int  NOT NULL DEFAULT 1 CHECK (dia_semana BETWEEN 0 AND 6),
  proxima_data  date NOT NULL DEFAULT CURRENT_DATE,
  ativo         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aluna_id)
);

CREATE TABLE IF NOT EXISTS public.feedback_respostas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluna_id         uuid NOT NULL REFERENCES public.alunas(id) ON DELETE CASCADE,
  data_referencia  date NOT NULL DEFAULT CURRENT_DATE,
  peso             numeric,
  medidas          jsonb NOT NULL DEFAULT '{}'::jsonb,
  adesao_dieta     int CHECK (adesao_dieta BETWEEN 0 AND 10),
  adesao_treino    int CHECK (adesao_treino BETWEEN 0 AND 10),
  energia          int CHECK (energia BETWEEN 0 AND 10),
  sono             int CHECK (sono BETWEEN 0 AND 10),
  intestino        text,
  ciclo_menstrual  text,
  dificuldades     text,
  observacao       text,
  fotos            text[] NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'respondido',
  resposta_time    text,
  respondido_em    timestamptz,
  respondido_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aluna_id, data_referencia)
);

CREATE INDEX IF NOT EXISTS idx_feedback_respostas_aluna ON public.feedback_respostas(aluna_id, data_referencia DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_respostas_status ON public.feedback_respostas(status);


-- -----------------------------------------------------------------------------
-- 8. updated_at automatico
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'aluna_acessos', 'exercicios', 'treino_fases', 'treino_dias',
    'treino_exercicios', 'aluna_planos', 'aluna_plano_fases',
    'aluna_dietas', 'feedback_ciclos', 'feedback_respostas'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t, t);
  END LOOP;
END;
$$;


-- -----------------------------------------------------------------------------
-- 9. Liberacao das fases
-- -----------------------------------------------------------------------------
-- A fase so existe para a aluna quando a data de liberacao chega. E isso que
-- faz "uma fase nova por mes" — as demais ficam invisiveis ate a data.
CREATE OR REPLACE FUNCTION public.fase_liberada_para_mim(_fase_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.aluna_plano_fases pf
    JOIN public.aluna_planos p ON p.id = pf.plano_id
    WHERE pf.fase_id = _fase_id
      AND p.aluna_id = public.aluna_do_usuario(auth.uid())
      AND p.status = 'ativo'
      AND pf.data_liberacao <= CURRENT_DATE
  )
$$;

-- Enfileira as fases escolhidas para a aluna, uma a cada `_intervalo_dias`.
-- Substitui o plano ativo anterior (arquiva) para nao duplicar cronograma.
CREATE OR REPLACE FUNCTION public.atribuir_fases_para_aluna(
  _aluna_id       uuid,
  _fase_ids       uuid[],
  _data_inicio    date DEFAULT CURRENT_DATE,
  _intervalo_dias int  DEFAULT 30,
  _nome           text DEFAULT 'Plano de treino'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  novo_plano_id uuid;
  i int;
BEGIN
  IF NOT public.is_approved(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para atribuir plano';
  END IF;

  IF _fase_ids IS NULL OR array_length(_fase_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecione ao menos uma fase';
  END IF;

  IF _intervalo_dias < 1 THEN
    RAISE EXCEPTION 'Intervalo entre fases precisa ser de no minimo 1 dia';
  END IF;

  UPDATE public.aluna_planos
     SET status = 'arquivado'
   WHERE aluna_id = _aluna_id AND status = 'ativo';

  INSERT INTO public.aluna_planos (aluna_id, nome, data_inicio, intervalo_dias, created_by)
  VALUES (_aluna_id, _nome, _data_inicio, _intervalo_dias, auth.uid())
  RETURNING id INTO novo_plano_id;

  FOR i IN 1 .. array_length(_fase_ids, 1) LOOP
    INSERT INTO public.aluna_plano_fases (plano_id, fase_id, ordem, data_liberacao)
    VALUES (
      novo_plano_id,
      _fase_ids[i],
      i,
      _data_inicio + ((i - 1) * _intervalo_dias)
    );
  END LOOP;

  RETURN novo_plano_id;
END;
$$;

REVOKE ALL ON FUNCTION public.atribuir_fases_para_aluna(uuid, uuid[], date, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.atribuir_fases_para_aluna(uuid, uuid[], date, int, text) TO authenticated;

-- Copia uma fase inteira (dias + exercicios). Serve para montar as 12 fases
-- partindo de uma que ja existe em vez de digitar tudo de novo.
CREATE OR REPLACE FUNCTION public.duplicar_fase(_fase_id uuid, _novo_nome text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nova_fase_id uuid;
  dia record;
  novo_dia_id uuid;
BEGIN
  IF NOT public.is_approved(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para duplicar fase';
  END IF;

  INSERT INTO public.treino_fases (nome, ordem, objetivo, descricao, duracao_semanas, nivel, cor, created_by)
  SELECT COALESCE(_novo_nome, nome || ' (copia)'),
         (SELECT COALESCE(MAX(ordem), 0) + 1 FROM public.treino_fases),
         objetivo, descricao, duracao_semanas, nivel, cor, auth.uid()
  FROM public.treino_fases
  WHERE id = _fase_id
  RETURNING id INTO nova_fase_id;

  IF nova_fase_id IS NULL THEN
    RAISE EXCEPTION 'Fase de origem nao encontrada';
  END IF;

  FOR dia IN SELECT * FROM public.treino_dias WHERE fase_id = _fase_id ORDER BY ordem LOOP
    INSERT INTO public.treino_dias (fase_id, nome, ordem, foco, observacao)
    VALUES (nova_fase_id, dia.nome, dia.ordem, dia.foco, dia.observacao)
    RETURNING id INTO novo_dia_id;

    INSERT INTO public.treino_exercicios
      (dia_id, exercicio_id, ordem, series, repeticoes, carga_sugerida,
       cadencia, descanso_seg, metodo_avancado, observacao, agrupamento)
    SELECT novo_dia_id, exercicio_id, ordem, series, repeticoes, carga_sugerida,
           cadencia, descanso_seg, metodo_avancado, observacao, agrupamento
    FROM public.treino_exercicios
    WHERE dia_id = dia.id;
  END LOOP;

  RETURN nova_fase_id;
END;
$$;

REVOKE ALL ON FUNCTION public.duplicar_fase(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.duplicar_fase(uuid, text) TO authenticated;


-- -----------------------------------------------------------------------------
-- 10. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.aluna_acessos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercicios            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treino_fases          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treino_dias           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treino_exercicios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aluna_planos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aluna_plano_fases     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aluna_treino_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aluna_exercicio_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aluna_dietas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_ciclos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_respostas    ENABLE ROW LEVEL SECURITY;

-- ---- Time: acesso total a todas as tabelas da camada -------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'aluna_acessos', 'exercicios', 'treino_fases', 'treino_dias',
    'treino_exercicios', 'aluna_planos', 'aluna_plano_fases',
    'aluna_treino_logs', 'aluna_exercicio_logs', 'aluna_dietas',
    'feedback_ciclos', 'feedback_respostas'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "time_gerencia_%s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "time_gerencia_%s" ON public.%I
         FOR ALL TO authenticated
         USING (public.is_approved(auth.uid()))
         WITH CHECK (public.is_approved(auth.uid()))', t, t);
  END LOOP;
END;
$$;

-- ---- Aluna: leitura da biblioteca de exercicios ------------------------------
-- Videos de demonstracao nao carregam dado pessoal; qualquer aluna vinculada le
-- os exercicios ativos. O que e restrito por fase e a PRESCRICAO, abaixo.
--
-- O segundo ramo importa: arquivar um exercicio (ativo = false) e um soft delete
-- para nao quebrar fases antigas. Sem ele, arquivar um exercicio que esta numa
-- fase ja liberada faria o video sumir do treino da aluna no meio do mes.
DROP POLICY IF EXISTS "aluna_le_exercicios" ON public.exercicios;
CREATE POLICY "aluna_le_exercicios" ON public.exercicios
  FOR SELECT TO authenticated
  USING (
    public.aluna_do_usuario(auth.uid()) IS NOT NULL
    AND (
      ativo = true
      OR EXISTS (
        SELECT 1
        FROM public.treino_exercicios te
        JOIN public.treino_dias d ON d.id = te.dia_id
        WHERE te.exercicio_id = exercicios.id
          AND public.fase_liberada_para_mim(d.fase_id)
      )
    )
  );

-- ---- Aluna: so as fases ja liberadas ----------------------------------------
DROP POLICY IF EXISTS "aluna_le_fases_liberadas" ON public.treino_fases;
CREATE POLICY "aluna_le_fases_liberadas" ON public.treino_fases
  FOR SELECT TO authenticated
  USING (public.fase_liberada_para_mim(id));

DROP POLICY IF EXISTS "aluna_le_dias_liberados" ON public.treino_dias;
CREATE POLICY "aluna_le_dias_liberados" ON public.treino_dias
  FOR SELECT TO authenticated
  USING (public.fase_liberada_para_mim(fase_id));

DROP POLICY IF EXISTS "aluna_le_prescricao_liberada" ON public.treino_exercicios;
CREATE POLICY "aluna_le_prescricao_liberada" ON public.treino_exercicios
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.treino_dias d
    WHERE d.id = treino_exercicios.dia_id
      AND public.fase_liberada_para_mim(d.fase_id)
  ));

-- ---- Aluna: o proprio plano --------------------------------------------------
DROP POLICY IF EXISTS "aluna_le_seu_plano" ON public.aluna_planos;
CREATE POLICY "aluna_le_seu_plano" ON public.aluna_planos
  FOR SELECT TO authenticated
  USING (public.e_minha_aluna(aluna_id));

DROP POLICY IF EXISTS "aluna_le_suas_fases" ON public.aluna_plano_fases;
CREATE POLICY "aluna_le_suas_fases" ON public.aluna_plano_fases
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.aluna_planos p
    WHERE p.id = aluna_plano_fases.plano_id
      AND public.e_minha_aluna(p.aluna_id)
      AND aluna_plano_fases.data_liberacao <= CURRENT_DATE
  ));

-- ---- Aluna: registra o treino que fez ---------------------------------------
DROP POLICY IF EXISTS "aluna_le_seus_logs" ON public.aluna_treino_logs;
CREATE POLICY "aluna_le_seus_logs" ON public.aluna_treino_logs
  FOR SELECT TO authenticated
  USING (public.e_minha_aluna(aluna_id));

DROP POLICY IF EXISTS "aluna_cria_seus_logs" ON public.aluna_treino_logs;
CREATE POLICY "aluna_cria_seus_logs" ON public.aluna_treino_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.e_minha_aluna(aluna_id));

DROP POLICY IF EXISTS "aluna_edita_seus_logs" ON public.aluna_treino_logs;
CREATE POLICY "aluna_edita_seus_logs" ON public.aluna_treino_logs
  FOR UPDATE TO authenticated
  USING (public.e_minha_aluna(aluna_id))
  WITH CHECK (public.e_minha_aluna(aluna_id));

DROP POLICY IF EXISTS "aluna_apaga_seus_logs" ON public.aluna_treino_logs;
CREATE POLICY "aluna_apaga_seus_logs" ON public.aluna_treino_logs
  FOR DELETE TO authenticated
  USING (public.e_minha_aluna(aluna_id));

DROP POLICY IF EXISTS "aluna_le_logs_exercicio" ON public.aluna_exercicio_logs;
CREATE POLICY "aluna_le_logs_exercicio" ON public.aluna_exercicio_logs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.aluna_treino_logs l
    WHERE l.id = aluna_exercicio_logs.treino_log_id
      AND public.e_minha_aluna(l.aluna_id)
  ));

DROP POLICY IF EXISTS "aluna_cria_logs_exercicio" ON public.aluna_exercicio_logs;
CREATE POLICY "aluna_cria_logs_exercicio" ON public.aluna_exercicio_logs
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.aluna_treino_logs l
    WHERE l.id = aluna_exercicio_logs.treino_log_id
      AND public.e_minha_aluna(l.aluna_id)
  ));

-- ---- Aluna: dieta (somente leitura) -----------------------------------------
DROP POLICY IF EXISTS "aluna_le_sua_dieta" ON public.aluna_dietas;
CREATE POLICY "aluna_le_sua_dieta" ON public.aluna_dietas
  FOR SELECT TO authenticated
  USING (ativo = true AND public.e_minha_aluna(aluna_id));

-- ---- Aluna: feedback ---------------------------------------------------------
DROP POLICY IF EXISTS "aluna_le_seu_ciclo" ON public.feedback_ciclos;
CREATE POLICY "aluna_le_seu_ciclo" ON public.feedback_ciclos
  FOR SELECT TO authenticated
  USING (public.e_minha_aluna(aluna_id));

DROP POLICY IF EXISTS "aluna_le_seus_feedbacks" ON public.feedback_respostas;
CREATE POLICY "aluna_le_seus_feedbacks" ON public.feedback_respostas
  FOR SELECT TO authenticated
  USING (public.e_minha_aluna(aluna_id));

DROP POLICY IF EXISTS "aluna_envia_feedback" ON public.feedback_respostas;
CREATE POLICY "aluna_envia_feedback" ON public.feedback_respostas
  FOR INSERT TO authenticated
  WITH CHECK (public.e_minha_aluna(aluna_id));

-- A aluna corrige o que enviou, mas nao escreve a resposta do time nem se
-- auto-marca como respondida.
DROP POLICY IF EXISTS "aluna_edita_seu_feedback" ON public.feedback_respostas;
CREATE POLICY "aluna_edita_seu_feedback" ON public.feedback_respostas
  FOR UPDATE TO authenticated
  USING (public.e_minha_aluna(aluna_id) AND respondido_em IS NULL)
  WITH CHECK (public.e_minha_aluna(aluna_id) AND resposta_time IS NULL AND respondido_em IS NULL);

-- ---- Aluna: le o proprio vinculo (para descobrir quem ela e) ------------------
DROP POLICY IF EXISTS "aluna_le_seu_acesso" ON public.aluna_acessos;
CREATE POLICY "aluna_le_seu_acesso" ON public.aluna_acessos
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Nome da aluna para o cabecalho do app, sem abrir a tabela de alunas inteira
CREATE OR REPLACE FUNCTION public.meu_perfil_aluna()
RETURNS TABLE (aluna_id uuid, nome_completo text, programa text, data_vencimento date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.nome_completo, a.programa, a.data_vencimento
  FROM public.alunas a
  WHERE a.id = public.aluna_do_usuario(auth.uid())
$$;

REVOKE ALL ON FUNCTION public.meu_perfil_aluna() FROM public;
GRANT EXECUTE ON FUNCTION public.meu_perfil_aluna() TO authenticated;


-- -----------------------------------------------------------------------------
-- 11. Storage: PDF da dieta e fotos de feedback (buckets privados)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dietas', 'dietas', false, 20971520,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback-fotos', 'feedback-fotos', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Convencao de caminho: <aluna_id>/<arquivo>. A primeira pasta identifica a dona.
--
-- storage.objects pertence a `supabase_storage_admin`, nao ao papel que roda a
-- migration. Pelo CLI (`supabase db push`) isso passa; colado no SQL Editor o
-- papel e `postgres`, que nao e dono e leva "must be owner of table objects".
-- O postgres do Supabase costuma ser MEMBRO de supabase_storage_admin, entao
-- basta assumir o papel. Se nem isso der, o bloco avisa e segue — o resto da
-- migration nao pode cair por causa disso, e as policies podem ser criadas
-- depois na tela Storage -> Policies.
DO $storage$
DECLARE
  assumiu boolean := false;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE supabase_storage_admin';
    assumiu := true;
  EXCEPTION WHEN OTHERS THEN
    assumiu := false;   -- segue com o papel atual; se ja for dono, funciona
  END;

  EXECUTE $p$DROP POLICY IF EXISTS "dietas_time_gerencia" ON storage.objects$p$;
  EXECUTE $p$
    CREATE POLICY "dietas_time_gerencia" ON storage.objects
      FOR ALL TO authenticated
      USING (bucket_id = 'dietas' AND public.is_approved(auth.uid()))
      WITH CHECK (bucket_id = 'dietas' AND public.is_approved(auth.uid()))
  $p$;

  EXECUTE $p$DROP POLICY IF EXISTS "dietas_aluna_le" ON storage.objects$p$;
  EXECUTE $p$
    CREATE POLICY "dietas_aluna_le" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'dietas'
        AND (storage.foldername(name))[1] = public.aluna_do_usuario(auth.uid())::text
      )
  $p$;

  EXECUTE $p$DROP POLICY IF EXISTS "feedback_fotos_time_gerencia" ON storage.objects$p$;
  EXECUTE $p$
    CREATE POLICY "feedback_fotos_time_gerencia" ON storage.objects
      FOR ALL TO authenticated
      USING (bucket_id = 'feedback-fotos' AND public.is_approved(auth.uid()))
      WITH CHECK (bucket_id = 'feedback-fotos' AND public.is_approved(auth.uid()))
  $p$;

  EXECUTE $p$DROP POLICY IF EXISTS "feedback_fotos_aluna" ON storage.objects$p$;
  EXECUTE $p$
    CREATE POLICY "feedback_fotos_aluna" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'feedback-fotos'
        AND (storage.foldername(name))[1] = public.aluna_do_usuario(auth.uid())::text
      )
  $p$;

  EXECUTE $p$DROP POLICY IF EXISTS "feedback_fotos_aluna_envia" ON storage.objects$p$;
  EXECUTE $p$
    CREATE POLICY "feedback_fotos_aluna_envia" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'feedback-fotos'
        AND (storage.foldername(name))[1] = public.aluna_do_usuario(auth.uid())::text
      )
  $p$;

  IF assumiu THEN EXECUTE 'RESET ROLE'; END IF;
  RAISE NOTICE 'Policies de storage criadas.';
EXCEPTION WHEN insufficient_privilege THEN
  -- RESET ROLE aqui tambem: sem isso o resto da migration rodaria com o papel
  -- trocado, e os objetos seguintes nasceriam com o dono errado.
  EXECUTE 'RESET ROLE';
  RAISE WARNING 'Sem permissao para criar as policies de storage. O resto da migration foi aplicado. Crie as 5 policies em Storage -> Policies (buckets dietas e feedback-fotos) ou rode este bloco pelo CLI com supabase db push.';
END
$storage$;


-- -----------------------------------------------------------------------------
-- 12. Vinculo no primeiro login
-- -----------------------------------------------------------------------------
-- O time cadastra o e-mail da aluna em aluna_acessos. Quando ela entra pela
-- primeira vez, o app chama esta funcao: casa o e-mail do JWT com o cadastro
-- pendente e amarra o user_id. Idempotente.
CREATE OR REPLACE FUNCTION public.vincular_meu_acesso()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meu_email text;
  ja_vinculada uuid;
  alvo uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT aluna_id INTO ja_vinculada
  FROM public.aluna_acessos
  WHERE user_id = auth.uid() AND ativo = true;

  IF ja_vinculada IS NOT NULL THEN
    UPDATE public.aluna_acessos
       SET ultimo_acesso = now()
     WHERE user_id = auth.uid();
    RETURN ja_vinculada;
  END IF;

  SELECT lower(email) INTO meu_email FROM auth.users WHERE id = auth.uid();
  IF meu_email IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.aluna_acessos
     SET user_id = auth.uid(), ultimo_acesso = now()
   WHERE lower(email) = meu_email
     AND user_id IS NULL
     AND ativo = true
  RETURNING aluna_id INTO alvo;

  RETURN alvo;
END;
$$;

REVOKE ALL ON FUNCTION public.vincular_meu_acesso() FROM public;
GRANT EXECUTE ON FUNCTION public.vincular_meu_acesso() TO authenticated;


-- -----------------------------------------------------------------------------
-- 13. GRANTs
-- -----------------------------------------------------------------------------
-- O Supabase concede isso por default privileges, mas deixar explicito evita
-- depender da configuracao do projeto. Quem barra de fato e a RLS acima —
-- o GRANT so abre a porta, a policy decide o que passa. `anon` fica de fora.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'aluna_acessos', 'exercicios', 'treino_fases', 'treino_dias',
    'treino_exercicios', 'aluna_planos', 'aluna_plano_fases',
    'aluna_treino_logs', 'aluna_exercicio_logs', 'aluna_dietas',
    'feedback_ciclos', 'feedback_respostas'
  ] LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END;
$$;
