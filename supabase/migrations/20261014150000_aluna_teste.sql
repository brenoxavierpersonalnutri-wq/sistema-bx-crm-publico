-- -----------------------------------------------------------------------------
-- Aluna de teste, para o time treinar (anamnese, feedback, agenda) sem sujar
-- os números nem arriscar aluna real.
--
--   alunas.is_teste           marca persistente. Nasce false em toda aluna.
--   criar_aluna_teste()       única porta para criar uma aluna com is_teste = true:
--                             nome "TESTE – Treinamento <data hora>", telefone
--                             (00) 90000-NNNN (DDD 00 não existe e o miolo
--                             começa com 0, então não casa com número real
--                             nenhum no identificar_aluna_por_whatsapp),
--                             MGMD trimestral, paga, ativa.
--   apagar_aluna_teste(id)    apaga a aluna de teste e o que foi gerado para
--                             ela. RECUSA (42501) se a aluna não for de teste.
--   trava                     is_teste não muda depois que a aluna existe
--                             (aluna real nunca vira "de teste" para poder ser
--                             apagada por aqui) e INSERT com is_teste = true
--                             só passa pela criar_aluna_teste().
--
-- O que apagar_aluna_teste remove:
--   anamnese_respostas  (aluna_id; também cairia pelo ON DELETE CASCADE)
--   feedback_semanal_responses  (aluna_id, ou o telefone de teste quando o
--                       feedback chegou sem aluna_id)
--   collaborator_tasks  (agenda: metadata.alunaId = a aluna, ou
--                       metadata.origemId = um dos feedbacks/anamneses apagados
--                       — cobre liberação, reavaliação e os avisos)
--   alunas              (e por CASCADE: aluna_planos, aluna_treino_logs,
--                       aluna_dietas, feedback_ciclos, feedback_respostas,
--                       notificacoes, dispositivos, aluna_acessos,
--                       conteudo_progresso)
-- Arquivos no storage (dietas/<id>/, feedback-fotos/<id>/) a tela apaga
-- depois que o banco confirma que era de teste.
--
-- Quem pode: aprovado E (admin OU módulo "alunas"). Nenhuma policy existente
-- é alterada; o "Excluir" normal da Gestão de Alunas continua como está.
--
-- Idempotente: pode rodar mais de uma vez.
-- -----------------------------------------------------------------------------

BEGIN;

-- 1. A marca.
ALTER TABLE public.alunas ADD COLUMN IF NOT EXISTS is_teste boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS alunas_is_teste_idx ON public.alunas (created_at DESC) WHERE is_teste;

-- has_module já existe em produção (drizzle 0002 / 20261011120000); recria igual.
CREATE OR REPLACE FUNCTION public.has_module(_user_id uuid, _module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_modules WHERE user_id = _user_id AND module = _module)
$$;

-- 2. Trava da marca.
CREATE OR REPLACE FUNCTION public.alunas_trava_is_teste()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_teste IS TRUE
       AND coalesce(current_setting('app.criando_aluna_teste', true), '') <> 'sim' THEN
      RAISE EXCEPTION 'Aluna de teste só nasce pelo botão "Criar aluna de teste".'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.is_teste IS DISTINCT FROM OLD.is_teste THEN
    RAISE EXCEPTION 'A marca de aluna de teste não pode ser mudada depois de criada.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alunas_trava_is_teste ON public.alunas;
CREATE TRIGGER trg_alunas_trava_is_teste
  BEFORE INSERT OR UPDATE OF is_teste ON public.alunas
  FOR EACH ROW
  EXECUTE FUNCTION public.alunas_trava_is_teste();

REVOKE ALL ON FUNCTION public.alunas_trava_is_teste() FROM PUBLIC, anon, authenticated;

-- 3. Quem pode criar/apagar aluna de teste.
CREATE OR REPLACE FUNCTION public.pode_gerir_aluna_teste(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _uid IS NOT NULL
     AND public.is_approved(_uid)
     AND (public.has_role(_uid, 'admin') OR public.has_module(_uid, 'alunas'))
$$;

REVOKE ALL ON FUNCTION public.pode_gerir_aluna_teste(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Criar.
CREATE OR REPLACE FUNCTION public.criar_aluna_teste()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_agora timestamp := (now() AT TIME ZONE 'America/Sao_Paulo');
  v_hoje  date := v_agora::date;
  v_base  text := 'TESTE – Treinamento ' || to_char(v_agora, 'DD/MM/YYYY HH24:MI');
  v_nome  text;
  v_tel   text;
  v_id    uuid;
  i       int;
BEGIN
  IF NOT public.pode_gerir_aluna_teste(v_uid) THEN
    RAISE EXCEPTION 'Sem permissão para criar aluna de teste.' USING ERRCODE = '42501';
  END IF;

  -- Telefone (00) 90000-NNNN, diferente das outras alunas de teste.
  FOR i IN 1..50 LOOP
    v_tel := '(00) 90000-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.alunas a
      WHERE regexp_replace(coalesce(a.telefone, ''), '\D', '', 'g') = regexp_replace(v_tel, '\D', '', 'g')
    );
  END LOOP;

  PERFORM set_config('app.criando_aluna_teste', 'sim', true);

  -- O nome é chave única por responsável: duas no mesmo minuto ganham (2), (3)...
  FOR i IN 1..20 LOOP
    v_nome := v_base || CASE WHEN i = 1 THEN '' ELSE ' (' || i || ')' END;
    BEGIN
      INSERT INTO public.alunas (
        user_id, nome_completo, programa, data_compra, duracao_plano, data_vencimento,
        forma_pagamento, pago, telefone, origem_lead, status, is_teste
      ) VALUES (
        v_uid, v_nome, 'menos_gordura', v_hoje, '3', (v_hoje + interval '3 months')::date,
        'pix', true, v_tel, 'outro', 'ativa', true
      )
      RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_id := NULL;
    END;
  END LOOP;

  PERFORM set_config('app.criando_aluna_teste', '', true);

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Não consegui criar a aluna de teste (nome repetido). Tente de novo em um minuto.';
  END IF;

  RETURN jsonb_build_object('id', v_id, 'nome', v_nome, 'telefone', v_tel);
END;
$$;

REVOKE ALL ON FUNCTION public.criar_aluna_teste() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_aluna_teste() TO authenticated;

-- 5. Apagar (só de teste).
CREATE OR REPLACE FUNCTION public.apagar_aluna_teste(_aluna uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_teste      boolean;
  v_tel        text;
  v_digitos    text;
  v_feedbacks  uuid[] := '{}';
  v_anamneses  uuid[] := '{}';
  v_tarefas    int := 0;
  v_alunas     int := 0;
BEGIN
  IF NOT public.pode_gerir_aluna_teste(v_uid) THEN
    RAISE EXCEPTION 'Sem permissão para apagar aluna de teste.' USING ERRCODE = '42501';
  END IF;

  SELECT a.is_teste, a.telefone INTO v_teste, v_tel
  FROM public.alunas a
  WHERE a.id = _aluna
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aluna não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_teste IS NOT TRUE THEN
    RAISE EXCEPTION 'Recusado: essa aluna é real, não é de teste. Nada foi apagado.'
      USING ERRCODE = '42501';
  END IF;

  v_digitos := regexp_replace(coalesce(v_tel, ''), '\D', '', 'g');

  WITH apagados AS (
    DELETE FROM public.anamnese_respostas r WHERE r.aluna_id = _aluna RETURNING r.id
  ) SELECT coalesce(array_agg(id), '{}') INTO v_anamneses FROM apagados;

  -- Feedback pelo aluna_id, ou pelo telefone de teste quando chegou sem ele.
  -- O casamento por telefone só vale para o número de teste (DDD 00), que não
  -- pertence a ninguém.
  WITH apagados AS (
    DELETE FROM public.feedback_semanal_responses f
    WHERE f.aluna_id = _aluna
       OR (v_digitos LIKE '00%' AND length(v_digitos) >= 10
           AND regexp_replace(coalesce(f.telefone, ''), '\D', '', 'g') IN (v_digitos, '55' || v_digitos))
    RETURNING f.id
  ) SELECT coalesce(array_agg(id), '{}') INTO v_feedbacks FROM apagados;

  DELETE FROM public.collaborator_tasks t
  WHERE t.metadata->>'alunaId' = _aluna::text
     OR t.metadata->>'origemId' = ANY (SELECT x::text FROM unnest(v_feedbacks || v_anamneses) x);
  GET DIAGNOSTICS v_tarefas = ROW_COUNT;

  DELETE FROM public.alunas a WHERE a.id = _aluna AND a.is_teste IS TRUE;
  GET DIAGNOSTICS v_alunas = ROW_COUNT;

  RETURN jsonb_build_object(
    'aluna', v_alunas,
    'anamneses', coalesce(array_length(v_anamneses, 1), 0),
    'feedbacks', coalesce(array_length(v_feedbacks, 1), 0),
    'tarefas', v_tarefas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apagar_aluna_teste(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apagar_aluna_teste(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
