-- =============================================================================
-- APP DA ALUNA — infraestrutura para o app nativo (App Store / Play Store)
-- =============================================================================
-- O que um app de loja precisa e a camada web nao exigia:
--   * push notifications (token por dispositivo + fila de envio)
--   * exclusao de conta dentro do app  -> App Store Review 5.1.1(v), obrigatorio
--   * exportacao dos proprios dados    -> LGPD art. 18
--   * versao minima suportada          -> forcar atualizacao quando a API mudar
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Dispositivos (tokens de push)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dispositivos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  aluna_id      uuid REFERENCES public.alunas(id) ON DELETE CASCADE,
  token         text NOT NULL,
  plataforma    text NOT NULL CHECK (plataforma IN ('ios', 'android', 'web')),
  -- 'expo' | 'fcm' | 'apns' — de quem e o token, para o worker saber por onde enviar
  provedor      text NOT NULL DEFAULT 'expo',
  app_versao    text,
  modelo        text,
  ativo         boolean NOT NULL DEFAULT true,
  ultimo_uso    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_dispositivos_user  ON public.dispositivos(user_id) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_dispositivos_aluna ON public.dispositivos(aluna_id) WHERE ativo;


-- -----------------------------------------------------------------------------
-- 2. Fila de notificacoes
-- -----------------------------------------------------------------------------
-- As triggers abaixo so ENFILEIRAM. Um worker externo (cron chamando a Edge
-- Function `mobile-push`) le as pendentes e entrega. Separar as duas coisas
-- evita que uma falha do provedor de push derrube a transacao do banco.
CREATE TABLE IF NOT EXISTS public.notificacoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluna_id     uuid NOT NULL REFERENCES public.alunas(id) ON DELETE CASCADE,
  tipo         text NOT NULL,
  titulo       text NOT NULL,
  corpo        text NOT NULL,
  -- Para deep link no app: {"rota": "treino"} etc.
  dados        jsonb NOT NULL DEFAULT '{}'::jsonb,
  agendada_para timestamptz NOT NULL DEFAULT now(),
  enviada_em   timestamptz,
  lida_em      timestamptz,
  erro         text,
  tentativas   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notificacoes_pendentes
  ON public.notificacoes(agendada_para)
  WHERE enviada_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_notificacoes_aluna
  ON public.notificacoes(aluna_id, created_at DESC);


-- -----------------------------------------------------------------------------
-- 3. Config do app (versao minima, avisos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_config (
  id                  int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  versao_minima_ios     text NOT NULL DEFAULT '1.0.0',
  versao_minima_android text NOT NULL DEFAULT '1.0.0',
  url_loja_ios        text,
  url_loja_android    text,
  aviso_titulo        text,
  aviso_corpo         text,
  aviso_ativo         boolean NOT NULL DEFAULT false,
  manutencao          boolean NOT NULL DEFAULT false,
  manutencao_mensagem text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 4. Triggers que enfileiram notificacao
-- -----------------------------------------------------------------------------

-- Fase nova abriu para a aluna
CREATE OR REPLACE FUNCTION public.notificar_fase_liberada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dona uuid;
  nome_fase text;
BEGIN
  SELECT p.aluna_id INTO dona FROM public.aluna_planos p WHERE p.id = NEW.plano_id;
  IF dona IS NULL THEN RETURN NEW; END IF;

  SELECT f.nome INTO nome_fase FROM public.treino_fases f WHERE f.id = NEW.fase_id;

  INSERT INTO public.notificacoes (aluna_id, tipo, titulo, corpo, dados, agendada_para)
  VALUES (
    dona,
    'fase_liberada',
    'Fase nova liberada',
    COALESCE(nome_fase, 'Sua próxima fase') || ' já está no app.',
    jsonb_build_object('rota', 'treino', 'fase_id', NEW.fase_id),
    -- 12h do dia da liberacao, no fuso de Brasilia
    (NEW.data_liberacao::timestamp + interval '12 hours') AT TIME ZONE 'America/Sao_Paulo'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_fase_liberada ON public.aluna_plano_fases;
CREATE TRIGGER trg_notificar_fase_liberada
  AFTER INSERT ON public.aluna_plano_fases
  FOR EACH ROW EXECUTE FUNCTION public.notificar_fase_liberada();

-- Time respondeu o feedback
CREATE OR REPLACE FUNCTION public.notificar_feedback_respondido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.respondido_em IS NOT NULL AND OLD.respondido_em IS NULL THEN
    INSERT INTO public.notificacoes (aluna_id, tipo, titulo, corpo, dados)
    VALUES (
      NEW.aluna_id,
      'feedback_respondido',
      'Seu feedback foi respondido',
      'O Breno deixou um ajuste para você. Abre lá.',
      jsonb_build_object('rota', 'feedback', 'feedback_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_feedback ON public.feedback_respostas;
CREATE TRIGGER trg_notificar_feedback
  AFTER UPDATE ON public.feedback_respostas
  FOR EACH ROW EXECUTE FUNCTION public.notificar_feedback_respondido();

-- Dieta nova publicada
CREATE OR REPLACE FUNCTION public.notificar_dieta_nova()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.ativo THEN
    INSERT INTO public.notificacoes (aluna_id, tipo, titulo, corpo, dados, agendada_para)
    VALUES (
      NEW.aluna_id,
      'dieta_nova',
      'Dieta nova disponível',
      NEW.titulo || ' já está no app.',
      jsonb_build_object('rota', 'dieta', 'dieta_id', NEW.id),
      GREATEST(now(), (NEW.vigencia_inicio::timestamp + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo')
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_dieta ON public.aluna_dietas;
CREATE TRIGGER trg_notificar_dieta
  AFTER INSERT ON public.aluna_dietas
  FOR EACH ROW EXECUTE FUNCTION public.notificar_dieta_nova();


-- -----------------------------------------------------------------------------
-- 5. Exclusao de conta — App Store Review Guideline 5.1.1(v)
-- -----------------------------------------------------------------------------
-- App que deixa criar conta PRECISA deixar excluir dentro do app, senao a
-- Apple recusa a publicacao.
--
-- O que sai: o login, os dispositivos, as notificacoes e o conteudo que a
-- aluna gerou no app (feedbacks, fotos, logs de treino).
-- O que fica: a linha em `alunas`. E registro comercial e fiscal do Breno
-- (contrato, pagamento, vencimento), com base legal propria — nao e "conta
-- de usuario". O vinculo de acesso e desligado, entao aquela linha deixa de
-- apontar para qualquer pessoa logada.
--
-- Guarda um rastro em `exclusoes_conta` para provar o atendimento do pedido.
CREATE TABLE IF NOT EXISTS public.exclusoes_conta (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluna_id    uuid,
  email       text,
  motivo      text,
  excluido_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.exclusoes_conta ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.excluir_minha_conta(_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meu_id    uuid := auth.uid();
  minha_aluna uuid;
  meu_email text;
BEGIN
  IF meu_id IS NULL THEN
    RAISE EXCEPTION 'Sem sessão ativa';
  END IF;

  minha_aluna := public.aluna_do_usuario(meu_id);
  SELECT email INTO meu_email FROM auth.users WHERE id = meu_id;

  IF minha_aluna IS NOT NULL THEN
    DELETE FROM public.aluna_exercicio_logs
     WHERE treino_log_id IN (
       SELECT id FROM public.aluna_treino_logs WHERE aluna_id = minha_aluna
     );
    DELETE FROM public.aluna_treino_logs  WHERE aluna_id = minha_aluna;
    DELETE FROM public.feedback_respostas WHERE aluna_id = minha_aluna;
    DELETE FROM public.feedback_ciclos    WHERE aluna_id = minha_aluna;
    DELETE FROM public.notificacoes       WHERE aluna_id = minha_aluna;

    -- Solta o vinculo: a linha comercial deixa de apontar para uma pessoa logada
    DELETE FROM public.aluna_acessos WHERE aluna_id = minha_aluna;
  END IF;

  DELETE FROM public.dispositivos WHERE user_id = meu_id;

  INSERT INTO public.exclusoes_conta (aluna_id, email, motivo)
  VALUES (minha_aluna, meu_email, _motivo);

  -- Por ultimo o login. Os arquivos no storage saem no passo seguinte,
  -- feito pela Edge Function (o Postgres nao apaga objeto de bucket).
  DELETE FROM auth.users WHERE id = meu_id;

  RETURN jsonb_build_object(
    'excluido', true,
    'aluna_id', minha_aluna,
    'em', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_minha_conta(text) FROM public;
GRANT EXECUTE ON FUNCTION public.excluir_minha_conta(text) TO authenticated;


-- -----------------------------------------------------------------------------
-- 6. Exportacao dos proprios dados — LGPD art. 18, V
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exportar_meus_dados()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  minha_aluna uuid := public.aluna_do_usuario(auth.uid());
BEGIN
  IF minha_aluna IS NULL THEN
    RAISE EXCEPTION 'Sem acesso vinculado';
  END IF;

  RETURN jsonb_build_object(
    'gerado_em', now(),
    'perfil', (
      SELECT to_jsonb(x) FROM (
        SELECT a.nome_completo, a.programa, a.data_compra, a.data_vencimento, a.telefone
        FROM public.alunas a WHERE a.id = minha_aluna
      ) x
    ),
    'treinos_realizados', COALESCE((
      SELECT jsonb_agg(to_jsonb(l) ORDER BY l.data DESC)
      FROM public.aluna_treino_logs l WHERE l.aluna_id = minha_aluna
    ), '[]'::jsonb),
    'feedbacks', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.data_referencia DESC)
      FROM public.feedback_respostas f WHERE f.aluna_id = minha_aluna
    ), '[]'::jsonb),
    'dietas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'titulo', d.titulo, 'tipo', d.tipo, 'conteudo', d.conteudo,
        'vigencia_inicio', d.vigencia_inicio, 'vigencia_fim', d.vigencia_fim
      ) ORDER BY d.vigencia_inicio DESC)
      FROM public.aluna_dietas d WHERE d.aluna_id = minha_aluna
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.exportar_meus_dados() FROM public;
GRANT EXECUTE ON FUNCTION public.exportar_meus_dados() TO authenticated;


-- -----------------------------------------------------------------------------
-- 7. Registro de dispositivo
-- -----------------------------------------------------------------------------
-- Um token pertence a um aparelho, nao a uma pessoa: se outra aluna logar no
-- mesmo celular, o token tem que trocar de dono, senao ela recebe push da
-- anterior. Por isso o upsert e por `token`.
CREATE OR REPLACE FUNCTION public.registrar_dispositivo(
  _token      text,
  _plataforma text,
  _provedor   text DEFAULT 'expo',
  _app_versao text DEFAULT NULL,
  _modelo     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  novo_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessão ativa';
  END IF;
  IF _token IS NULL OR btrim(_token) = '' THEN
    RAISE EXCEPTION 'Token vazio';
  END IF;
  IF _plataforma NOT IN ('ios', 'android', 'web') THEN
    RAISE EXCEPTION 'Plataforma inválida: %', _plataforma;
  END IF;

  INSERT INTO public.dispositivos
    (user_id, aluna_id, token, plataforma, provedor, app_versao, modelo, ativo, ultimo_uso)
  VALUES
    (auth.uid(), public.aluna_do_usuario(auth.uid()), btrim(_token),
     _plataforma, _provedor, _app_versao, _modelo, true, now())
  ON CONFLICT (token) DO UPDATE SET
    user_id    = EXCLUDED.user_id,
    aluna_id   = EXCLUDED.aluna_id,
    plataforma = EXCLUDED.plataforma,
    provedor   = EXCLUDED.provedor,
    app_versao = EXCLUDED.app_versao,
    modelo     = EXCLUDED.modelo,
    ativo      = true,
    ultimo_uso = now()
  RETURNING id INTO novo_id;

  RETURN novo_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_dispositivo(text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.registrar_dispositivo(text, text, text, text, text) TO authenticated;


-- -----------------------------------------------------------------------------
-- 8. RLS e grants
-- -----------------------------------------------------------------------------
ALTER TABLE public.dispositivos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config     ENABLE ROW LEVEL SECURITY;

-- Time gerencia tudo
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dispositivos', 'notificacoes', 'exclusoes_conta', 'app_config'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "time_gerencia_%s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "time_gerencia_%s" ON public.%I
         FOR ALL TO authenticated
         USING (public.is_approved(auth.uid()))
         WITH CHECK (public.is_approved(auth.uid()))', t, t);
  END LOOP;
END;
$$;

-- Aluna: so os proprios dispositivos
DROP POLICY IF EXISTS "aluna_le_seus_dispositivos" ON public.dispositivos;
CREATE POLICY "aluna_le_seus_dispositivos" ON public.dispositivos
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "aluna_desliga_seu_dispositivo" ON public.dispositivos;
CREATE POLICY "aluna_desliga_seu_dispositivo" ON public.dispositivos
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "aluna_remove_seu_dispositivo" ON public.dispositivos;
CREATE POLICY "aluna_remove_seu_dispositivo" ON public.dispositivos
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Aluna: le e marca como lida a propria notificacao
DROP POLICY IF EXISTS "aluna_le_suas_notificacoes" ON public.notificacoes;
CREATE POLICY "aluna_le_suas_notificacoes" ON public.notificacoes
  FOR SELECT TO authenticated
  USING (public.e_minha_aluna(aluna_id));

DROP POLICY IF EXISTS "aluna_marca_lida" ON public.notificacoes;
CREATE POLICY "aluna_marca_lida" ON public.notificacoes
  FOR UPDATE TO authenticated
  USING (public.e_minha_aluna(aluna_id))
  WITH CHECK (public.e_minha_aluna(aluna_id));

-- Config do app: leitura livre para quem esta logado (nao tem dado sensivel);
-- escrita so pelo time, pela policy acima.
DROP POLICY IF EXISTS "todos_leem_config" ON public.app_config;
CREATE POLICY "todos_leem_config" ON public.app_config
  FOR SELECT TO authenticated
  USING (true);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dispositivos', 'notificacoes', 'exclusoes_conta', 'app_config'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispositivos_updated_at ON public.dispositivos;
CREATE TRIGGER trg_dispositivos_updated_at
  BEFORE UPDATE ON public.dispositivos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_app_config_updated_at ON public.app_config;
CREATE TRIGGER trg_app_config_updated_at
  BEFORE UPDATE ON public.app_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
