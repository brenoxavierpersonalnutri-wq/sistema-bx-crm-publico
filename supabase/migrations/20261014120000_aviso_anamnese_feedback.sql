-- -----------------------------------------------------------------------------
-- Aviso na agenda do time quando a aluna responde a anamnese ou manda feedback.
--
-- Onde cada coisa é gravada (e por isso o gatilho fica na tabela, não na tela):
--   anamnese  -> public.anamnese_respostas. A aluna abre /anamnese/<token> e a
--                função anamnese_enviar() (SECURITY DEFINER, chamada por anon)
--                troca status 'pendente' -> 'respondida'.
--   feedback  -> public.feedback_semanal_responses. O formulário /feedback/*
--                faz INSERT direto (anon), com aluna_id quando ela se
--                identificou pelo WhatsApp; os antigos só têm telefone.
--
-- O aviso é uma linha em public.collaborator_tasks (a mesma agenda das
-- reavaliações e liberações):
--   type      = 'aviso'  (camada "Reavaliações": quem tem o módulo
--               agenda-alunas vê os avisos de todas as alunas, igual às
--               reavaliações; admin vê tudo)
--   user_id   = o responsável da aluna (alunas.user_id, quem cuida da ficha),
--               se for alguém aprovado; senão o dono do sistema; senão um admin
--   title     = 'Anamnese preenchida: <nome>' / 'Feedback enviado: <nome>'
--   due_date  = agora
--   metadata  = alunaId, alunaNome, link '/alunas/ficha/<id>', origem e a
--               avisoChave ('anamnese:<id>' / 'feedback:<id>'), que tem índice
--               único: a mesma resposta nunca gera dois avisos.
--
-- Falha no aviso NUNCA derruba o envio da aluna: o corpo roda num bloco com
-- EXCEPTION que só registra WARNING.
--
-- RLS: nenhuma policy existente é alterada. Entram só duas novas (ler e
-- atualizar 'aviso' com o módulo agenda-alunas), no mesmo molde da camada.
--
-- Idempotente: pode rodar mais de uma vez.
-- -----------------------------------------------------------------------------

BEGIN;

-- 0. Garantias de coluna (já existem em produção; só pra banco que não as tem).
ALTER TABLE public.feedback_semanal_responses ADD COLUMN IF NOT EXISTS aluna_id uuid;

-- A CHECK antiga de type (se ainda existir) barraria 'aviso'. A migration
-- 20261011120000 já remove; repete aqui por garantia.
ALTER TABLE public.collaborator_tasks DROP CONSTRAINT IF EXISTS collaborator_tasks_type_check;

-- has_module já existe em produção (drizzle 0002 / 20261011120000); recria igual.
CREATE OR REPLACE FUNCTION public.has_module(_user_id uuid, _module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_modules WHERE user_id = _user_id AND module = _module)
$$;

-- 1. Um aviso por resposta.
CREATE UNIQUE INDEX IF NOT EXISTS collaborator_tasks_aviso_chave_uidx
  ON public.collaborator_tasks ((metadata->>'avisoChave'))
  WHERE (metadata ? 'avisoChave');

-- 2. Quem recebe o aviso.
CREATE OR REPLACE FUNCTION public.aviso_responsavel(_aluna uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v uuid;
BEGIN
  -- O responsável da aluna, se ainda é do time (aprovado).
  IF _aluna IS NOT NULL THEN
    SELECT a.user_id INTO v
    FROM public.alunas a
    JOIN public.profiles p ON p.id = a.user_id AND p.approved IS TRUE
    WHERE a.id = _aluna;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END IF;

  -- Senão, o dono do sistema (função criada pela migration 20261013200000).
  IF to_regprocedure('public.dono_do_sistema()') IS NOT NULL THEN
    EXECUTE 'SELECT public.dono_do_sistema()' INTO v;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END IF;

  -- Senão, um admin aprovado (o mais antigo).
  SELECT r.user_id INTO v
  FROM public.user_roles r
  JOIN public.profiles p ON p.id = r.user_id AND p.approved IS TRUE
  WHERE r.role = 'admin'
  ORDER BY p.created_at, r.user_id
  LIMIT 1;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.aviso_responsavel(uuid) FROM PUBLIC, anon, authenticated;

-- 3. Cria o aviso (núcleo comum aos dois gatilhos).
CREATE OR REPLACE FUNCTION public.criar_aviso_aluna(
  _origem text,      -- 'anamnese' | 'feedback'
  _origem_id uuid,   -- id da resposta
  _aluna uuid,       -- pode ser nulo (feedback de quem não está no cadastro)
  _nome text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resp  uuid;
  v_nome  text;
  v_titulo text;
  v_desc  text;
  v_meta  jsonb;
BEGIN
  SELECT a.nome_completo INTO v_nome FROM public.alunas a WHERE a.id = _aluna;
  v_nome := coalesce(nullif(btrim(v_nome), ''), nullif(btrim(_nome), ''), 'aluna sem nome');

  v_resp := public.aviso_responsavel(_aluna);
  IF v_resp IS NULL THEN
    RAISE WARNING 'aviso %: ninguem para receber (sem responsavel e sem admin)', _origem;
    RETURN;
  END IF;

  IF _origem = 'anamnese' THEN
    v_titulo := 'Anamnese preenchida: ' || v_nome;
    v_desc   := 'Ela respondeu a anamnese.';
  ELSE
    v_titulo := 'Feedback enviado: ' || v_nome;
    v_desc   := 'Ela mandou o feedback.';
  END IF;

  IF _aluna IS NOT NULL THEN
    v_desc := v_desc || ' Respostas na ficha: https://equipe.brenoxavier.com.br/alunas/ficha/' || _aluna;
  ELSE
    v_desc := v_desc || ' Não achei a aluna no cadastro pelo telefone; veja em Feedbacks (/alunas/feedback).';
  END IF;

  v_meta := jsonb_build_object(
    'avisoChave', _origem || ':' || _origem_id,
    'origem', _origem,
    'origemId', _origem_id,
    'alunaNome', v_nome
  );
  IF _aluna IS NOT NULL THEN
    v_meta := v_meta || jsonb_build_object('alunaId', _aluna, 'link', '/alunas/ficha/' || _aluna);
  END IF;

  INSERT INTO public.collaborator_tasks (user_id, title, description, due_date, status, type, metadata)
  VALUES (v_resp, v_titulo, v_desc, now(), 'pending', 'aviso', v_meta)
  ON CONFLICT ((metadata->>'avisoChave')) WHERE (metadata ? 'avisoChave') DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_aviso_aluna(text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- 4. Gatilho da anamnese: só na passagem para 'respondida'.
CREATE OR REPLACE FUNCTION public.trg_aviso_anamnese()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'respondida' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'respondida' THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.criar_aviso_aluna('anamnese', NEW.id, NEW.aluna_id, NEW.nome_completo);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso da anamnese % falhou: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_aviso_anamnese() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_aviso_anamnese ON public.anamnese_respostas;
CREATE TRIGGER trg_aviso_anamnese
  AFTER INSERT OR UPDATE OF status ON public.anamnese_respostas
  FOR EACH ROW
  WHEN (NEW.status = 'respondida')
  EXECUTE FUNCTION public.trg_aviso_anamnese();

-- 5. Gatilho do feedback: todo INSERT. Sem aluna_id, tenta casar pelo
-- telefone com a mesma regra do login do formulário.
CREATE OR REPLACE FUNCTION public.trg_aviso_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_aluna uuid := NEW.aluna_id;
BEGIN
  BEGIN
    IF v_aluna IS NULL AND NEW.telefone IS NOT NULL
       AND to_regprocedure('public.identificar_aluna_por_whatsapp(text)') IS NOT NULL THEN
      EXECUTE 'SELECT id FROM public.identificar_aluna_por_whatsapp($1)' INTO v_aluna USING NEW.telefone;
    END IF;
    PERFORM public.criar_aviso_aluna('feedback', NEW.id, v_aluna, NEW.nome);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso do feedback % falhou: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_aviso_feedback() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_aviso_feedback ON public.feedback_semanal_responses;
CREATE TRIGGER trg_aviso_feedback
  AFTER INSERT ON public.feedback_semanal_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_aviso_feedback();

-- 6. Camada "Reavaliações" (agenda-alunas) passa a enxergar os avisos.
-- Policies novas; as existentes ficam como estão.
DROP POLICY IF EXISTS "Agenda alunas access can read aviso tasks" ON public.collaborator_tasks;
CREATE POLICY "Agenda alunas access can read aviso tasks" ON public.collaborator_tasks
FOR SELECT TO authenticated
USING (type = 'aviso' AND public.has_module(auth.uid(), 'agenda-alunas'));

DROP POLICY IF EXISTS "Agenda alunas access can update aviso tasks" ON public.collaborator_tasks;
CREATE POLICY "Agenda alunas access can update aviso tasks" ON public.collaborator_tasks
FOR UPDATE TO authenticated
USING (type = 'aviso' AND public.has_module(auth.uid(), 'agenda-alunas'))
WITH CHECK (type = 'aviso' AND public.has_module(auth.uid(), 'agenda-alunas'));

COMMIT;

NOTIFY pgrst, 'reload schema';
