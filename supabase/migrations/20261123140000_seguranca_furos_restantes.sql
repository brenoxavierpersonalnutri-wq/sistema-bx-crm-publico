-- =============================================================
-- Segurança: os 3 furos que a verificação adversarial de 21/10/2026 achou FORA das permissões do CRM (já existiam em
-- produção antes de 20261123100000..130000). Rodar DEPOIS delas. Idempotente (o arnês roda duas vezes).
-- Testado só em Postgres local descartável (supabase/tests/permissoes/rodar.sh). Não apaga dado: o token da Meta é
-- COPIADO para a tabela nova antes de a coluna sair de profiles.
--
--  1) identificar_aluna_por_whatsapp: anon mandava um telefone e recebia id, nome completo e programa da aluna.
--     Quem usa: só as telas PÚBLICAS /feedback* (FeedbackSemanalForm) e /troca (TrocaCerta), sem login — o telefone é
--     o "login" da aluna. Nenhuma edge chama. Por isso não dá para revogar de anon sem derrubar as duas telas.
--     Agora devolve o MÍNIMO que as telas usam, mantendo o formato (o front que está no ar continua funcionando):
--       id            -> NULL sempre (a tela não precisa: o servidor liga o feedback à aluna pelo telefone, item 1b)
--       nome_completo -> só o PRIMEIRO nome (é o que as telas mostram: "Bem-vinda, Fulana!")
--       programa      -> só o produto do formulário: 'elite' | 'plataforma' | 'mgmd' | NULL (mesma regra de
--                        produtoDoPrograma() em src/types/feedbackSemanal.ts, que aceita essas palavras)
--     A versão completa vira public.aluna_por_telefone_interno(text): só service_role e funções do banco.
--  1b) feedback_semanal_responses (INSERT público): aluna_id deixa de ser confiado ao navegador. Quando o INSERT vem da
--     API (anon/authenticated), o servidor resolve a aluna pelo telefone, grava aluna_id e o nome completo do cadastro.
--     Antes, qualquer um podia pendurar um feedback na ficha de outra aluna mandando o aluna_id dela.
--  2) profiles.meta_access_token: todo aprovado lia o token dos colegas (policy "Approved users can read team profiles").
--     Quem usa: NINGUÉM no código (front, edges e types.ts não citam a coluna; as edges da Meta usam o segredo
--     META_ACCESS_TOKEN do ambiente). Vai para public.profiles_meta_credenciais, RLS própria: o próprio e o admin.
--  3) profiles.is_closer e full_name: o usuário marcava is_closer em si mesmo e podia se renomear com o nome de um
--     colega. O "Atribuir" dos fluxos grava o NOME em whatsapp_contacts.atendente e o gatilho
--     crm_contato_atendente_guarda casa nome -> atendente_id. Agora:
--       - só admin muda is_closer pela API (funções SECURITY DEFINER e service_role seguem);
--       - quem não é admin não pode se renomear com o nome (sem caixa/espaços) de OUTRO usuário aprovado;
--       - o passo Atribuir passa a levar atendente_id (front + edge crm-automacoes), e o nome vira só rótulo.
-- =============================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.profiles_guarda_aprovacao()') IS NULL THEN
    RAISE EXCEPTION 'rode antes 20261123100000, 20261123110000, 20261123120000 e 20261123130000';
  END IF;
END $$;

-- 0) Funções de telefone da 20260927010000 ------------------------------------------------------------------------
-- A 20260927010000 nunca foi aplicada em produção (21/10/2026: telefone_nucleo não existia e esta migration falhou com
-- 42883). Para ela ser autossuficiente, recria as TRÊS funções de que a regra de casamento depende (telefone_nucleo e
-- telefone_ddd chamam telefone_local), com o corpo IDÊNTICO ao da 20260927010000. CREATE OR REPLACE: onde a 20260927
-- já rodou, não muda nada.

-- Número sem o DDI: descarta um 55 colado na frente, mas só quando sobram mais
-- de 11 dígitos — assim o DDD 55 (Santa Maria) não é mutilado.
CREATE OR REPLACE FUNCTION public.telefone_local(_tel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
           WHEN length(d) > 11 AND left(d, 2) = '55' THEN substr(d, 3)
           ELSE d
         END
  FROM (SELECT regexp_replace(coalesce(_tel, ''), '\D', '', 'g') AS d) t
$$;

-- Os 8 dígitos finais: o "miolo" do número, que o nono dígito não altera.
CREATE OR REPLACE FUNCTION public.telefone_nucleo(_tel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN length(l) >= 8 THEN right(l, 8) END
  FROM (SELECT public.telefone_local(_tel) AS l) t
$$;

-- DDD só existe quando o número tem 10 (DDD + 8) ou 11 (DDD + 9 + 8) dígitos.
CREATE OR REPLACE FUNCTION public.telefone_ddd(_tel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN length(l) IN (10, 11) THEN left(l, 2) END
  FROM (SELECT public.telefone_local(_tel) AS l) t
$$;

-- 1) Aluna pelo telefone -------------------------------------------------------------------------------------------
-- Versão completa (a regra de casamento é a de 20260927010000, sem mudança). Fora da API pública.
CREATE OR REPLACE FUNCTION public.aluna_por_telefone_interno(p_telefone text)
RETURNS TABLE(id uuid, nome_completo text, programa text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.nome_completo, a.programa
  FROM public.alunas a
  WHERE public.telefone_nucleo(p_telefone) IS NOT NULL
    AND public.telefone_nucleo(a.telefone) = public.telefone_nucleo(p_telefone)
    AND (
      public.telefone_ddd(a.telefone) IS NULL
      OR public.telefone_ddd(p_telefone) IS NULL
      OR public.telefone_ddd(a.telefone) = public.telefone_ddd(p_telefone)
    )
  ORDER BY
    (public.telefone_ddd(a.telefone) IS NOT NULL
      AND public.telefone_ddd(a.telefone) = public.telefone_ddd(p_telefone)) DESC,
    a.created_at DESC
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.aluna_por_telefone_interno(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aluna_por_telefone_interno(text) TO service_role;

-- Produto do formulário a partir do programa (espelho de produtoDoPrograma, src/types/feedbackSemanal.ts).
CREATE OR REPLACE FUNCTION public.feedback_produto_do_programa(p_programa text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN l = '' THEN NULL
    WHEN l LIKE '%elite%' THEN 'elite'
    WHEN l LIKE '%plataforma%' THEN 'plataforma'
    WHEN l LIKE '%mgmd%' OR l LIKE '%magra%' OR l LIKE '%definic%' THEN
      CASE WHEN l LIKE '%magra%' AND l LIKE '%definida%' THEN 'plataforma' ELSE 'mgmd' END
    WHEN l LIKE '%gordura%' THEN 'mgmd'
  END
  FROM (SELECT btrim(translate(lower(coalesce(p_programa, '')),
                               'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) AS l) t
$$;
REVOKE ALL ON FUNCTION public.feedback_produto_do_programa(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feedback_produto_do_programa(text) TO authenticated, service_role;

-- Pública (telas /feedback e /troca): mesmo formato de antes, conteúdo mínimo.
CREATE OR REPLACE FUNCTION public.identificar_aluna_por_whatsapp(p_telefone text)
RETURNS TABLE(id uuid, nome_completo text, programa text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NULL::uuid,
         nullif(split_part(regexp_replace(btrim(coalesce(i.nome_completo, '')), '\s+', ' ', 'g'), ' ', 1), ''),
         public.feedback_produto_do_programa(i.programa)
  FROM public.aluna_por_telefone_interno(p_telefone) i
$$;
COMMENT ON FUNCTION public.identificar_aluna_por_whatsapp(text) IS
  'Portão público das telas /feedback e /troca. Devolve id NULL, só o primeiro nome e o produto (elite|plataforma|mgmd). '
  'Dado completo: aluna_por_telefone_interno (service_role). Migration 20261123140000.';
REVOKE ALL ON FUNCTION public.identificar_aluna_por_whatsapp(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identificar_aluna_por_whatsapp(text) TO anon, authenticated, service_role;

-- 1b) Feedback público: aluna_id e nome vêm do cadastro, não do navegador.
CREATE OR REPLACE FUNCTION public.feedback_resolver_aluna()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v record;
BEGIN
  -- só quando o INSERT veio da API. Dentro de SECURITY DEFINER current_user é o dono; o papel do pedido continua no
  -- GUC "role" (o PostgREST faz SET LOCAL role anon|authenticated; service_role e o banco ficam de fora).
  IF coalesce(current_setting('role', true), '') NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v FROM public.aluna_por_telefone_interno(NEW.telefone) LIMIT 1;
  NEW.aluna_id := v.id;  -- NULL quando o telefone não é de aluna: nada de aluna_id escolhido pelo navegador
  IF v.id IS NOT NULL AND coalesce(btrim(v.nome_completo), '') <> '' THEN
    NEW.nome := v.nome_completo;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.feedback_resolver_aluna() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_feedback_resolver_aluna ON public.feedback_semanal_responses;
CREATE TRIGGER trg_feedback_resolver_aluna BEFORE INSERT ON public.feedback_semanal_responses
FOR EACH ROW EXECUTE FUNCTION public.feedback_resolver_aluna();

-- O aviso do feedback (20261014120000) pegava o id pela função pública, que agora devolve NULL: passa para a interna.
CREATE OR REPLACE FUNCTION public.trg_aviso_feedback()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_aluna uuid := NEW.aluna_id;
BEGIN
  BEGIN
    IF v_aluna IS NULL AND NEW.telefone IS NOT NULL THEN
      SELECT id INTO v_aluna FROM public.aluna_por_telefone_interno(NEW.telefone);
    END IF;
    PERFORM public.criar_aviso_aluna('feedback', NEW.id, v_aluna, NEW.nome);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso do feedback % falhou: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_aviso_feedback() FROM PUBLIC, anon, authenticated;

-- 2) Token da Meta fora de profiles ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles_meta_credenciais (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  meta_access_token text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles_meta_credenciais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles_meta_credenciais FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles_meta_credenciais FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles_meta_credenciais TO authenticated;
GRANT ALL ON public.profiles_meta_credenciais TO service_role;

DROP POLICY IF EXISTS "meta_credenciais: o proprio e o admin" ON public.profiles_meta_credenciais;
CREATE POLICY "meta_credenciais: o proprio e o admin" ON public.profiles_meta_credenciais
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.has_role(auth.uid(), 'admin')))
  WITH CHECK (user_id = (SELECT auth.uid()) OR (SELECT public.has_role(auth.uid(), 'admin')));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'meta_access_token') THEN
    INSERT INTO public.profiles_meta_credenciais (user_id, meta_access_token)
    SELECT id, meta_access_token FROM public.profiles WHERE coalesce(meta_access_token, '') <> ''
    ON CONFLICT (user_id) DO NOTHING;
    -- sem CASCADE: se algo depender da coluna, a migration para em vez de derrubar a dependência calada
    ALTER TABLE public.profiles DROP COLUMN meta_access_token;
  END IF;
END $$;

-- 3) is_closer só pelo admin; ninguém se renomeia com o nome de outro aprovado --------------------------------
-- Nome já usado por OUTRO aprovado. DEFINER: quem chama (até pendente) não enxerga os perfis dos colegas pelo RLS.
CREATE OR REPLACE FUNCTION public.profiles_nome_em_uso(p_id uuid, p_nome text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id <> p_id AND p.approved AND lower(btrim(p.full_name)) = lower(btrim(p_nome)))
$$;
REVOKE ALL ON FUNCTION public.profiles_nome_em_uso(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profiles_nome_em_uso(uuid, text) TO authenticated, service_role;

-- INVOKER de propósito (mesma ideia de profiles_guarda_aprovacao): current_user = authenticated/anon só no UPDATE
-- direto pela API; dentro de SECURITY DEFINER (handle_new_user, RPCs) e service_role passa.
CREATE OR REPLACE FUNCTION public.profiles_guarda_campos()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR coalesce(public.has_role(auth.uid(), 'admin'), false) THEN
    RETURN NEW;
  END IF;
  IF NEW.is_closer IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.is_closer END) THEN
    RAISE EXCEPTION 'só admin marca ou desmarca closer' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(NEW.full_name), '') <> ''
     AND (TG_OP = 'INSERT' OR lower(btrim(NEW.full_name)) IS DISTINCT FROM lower(btrim(coalesce(OLD.full_name, ''))))
     AND public.profiles_nome_em_uso(NEW.id, NEW.full_name) THEN
    RAISE EXCEPTION 'já existe um usuário com esse nome' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.profiles_guarda_campos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profiles_guarda_campos() TO authenticated, service_role;
DROP TRIGGER IF EXISTS trg_profiles_guarda_campos ON public.profiles;
CREATE TRIGGER trg_profiles_guarda_campos BEFORE INSERT OR UPDATE OF is_closer, full_name ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_guarda_campos();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferir depois de aplicar (só leitura):
--   SELECT * FROM identificar_aluna_por_whatsapp('<telefone de aluna>');   -- id NULL, primeiro nome, produto
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'meta_access_token';  -- 0 linhas
--   SELECT count(*) FROM profiles_meta_credenciais;
--   SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_feedback_resolver_aluna', 'trg_profiles_guarda_campos');
