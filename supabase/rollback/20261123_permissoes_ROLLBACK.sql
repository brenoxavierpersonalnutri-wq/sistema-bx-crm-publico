-- =============================================================
-- ROLLBACK DE EMERGÊNCIA das migrations 20261123100000 / 110000 / 120000 / 130000 / 140000
-- (permissões do CRM, RLS, departamentos, correções e furos restantes).
--
-- NÃO é migration: fica fora de supabase/migrations de propósito. Rodar à mão no SQL editor do Lovable Cloud
-- SÓ se o CRM parar para os usuários depois de aplicar as migrations (ver CHECKLIST-aplicar-permissoes.md).
-- Idempotente: pode rodar 2, 3 vezes, e também num banco onde as migrations nem foram aplicadas.
-- Testado só em Postgres local descartável: bash supabase/tests/permissoes/rollback.sh
--
-- O QUE FAZ (seção 1, a que roda por padrão):
--  1.1 Tira TODAS as policies RESTRITIVAS "crm_acesso: ..." (110000 e 130000). Sem elas, cada tabela volta a valer só
--      pelas policies permissivas de antes ("Approved users ...", "Aprovados ...", "Lives ..."): aprovado vê e grava tudo.
--  1.2 "Service can insert/update whatsapp_contacts / whatsapp_messages" voltam a ser TO public, como em 20260321191255.
--      ATENÇÃO: era o único UPDATE que o usuário logado tinha em whatsapp_messages; também reabre o furo de anon
--      inserir contato/mensagem com a chave pública (o furo que a 110000 fechou). Foi pedido "como antes".
--  1.3 Storage whatsapp-media: tira as 3 policies novas e recria as 3 de 20260817202007, texto idêntico
--      (qualquer logado lê, sobe e sobrescreve no bucket).
--  1.4 Desliga (DROP TRIGGER) os gatilhos novos que BARRAM gravação:
--        trg_crm_contato_zz_acoes_guarda (ações por UPDATE direto em whatsapp_contacts, 130000)
--        trg_profiles_guarda_campos      (is_closer e nome repetido em profiles, 140000)
--      As funções ficam (reaplicar a migration recria o gatilho).
--  1.5 Funções que a 110000/130000 reescreveram por troca de texto voltam ao texto de antes (troca inversa, exata):
--        crm_ai_aplicar_tags_inicio, crm_ai_pausar_por_humano, crm_ai_transferir_para_ia, crm_ai_enfileirar,
--        crm_ai_ref_do_contato, crm_numero_renomear, crm_tag_criar, grupos_cancelar_mensagem,
--        crm_tags_existentes, crm_eventos_disponiveis.
--  1.6 crm_ai_assumir volta à definição de 20261111100000 (cópia exata).
--
-- O QUE FICA (de propósito):
--  - Tabelas e colunas novas (crm_acessos, crm_departamentos, atendente_id, departamento_id, profiles_meta_credenciais...)
--    e TODO o dado gravado nelas. Nada é apagado.
--  - As policies das tabelas NOVAS (crm_acessos etc.): só a tela nova usa essas tabelas.
--  - O formato InitPlan "(SELECT is_approved((SELECT auth.uid())))" que a 110000 aplicou nas permissivas antigas:
--    é a MESMA regra, só mais rápida (uma vez por consulta em vez de por linha). Desfazer só deixaria lento.
--  - Gatilhos que só PREENCHEM coluna nova e nunca recusam gravação antiga: trg_crm_acessos_ao_aprovar,
--    trg_crm_contato_atendente_guarda, trg_crm_contato_departamento_da_etapa (a seção 3 tira os dois de whatsapp_contacts).
--  - SEGURANÇA, mantidas mesmo no rollback (só saem na seção 2, se forem a causa da queda):
--      trg_profiles_guarda_aprovacao (usuário pendente se auto-aprovava pela API) e
--      o token da Meta fora de profiles (profiles_meta_credenciais; a coluna profiles.meta_access_token continua fora).
--  - identificar_aluna_por_whatsapp e o feedback público (telas /feedback e /troca, fora do CRM): seção 4.
--
-- SEÇÕES OPCIONAIS (comentadas no fim do arquivo; descomentar e rodar só a seção necessária):
--  2) devolve a auto-aprovação pela API e a coluna profiles.meta_access_token (REABRE os dois furos).
--  3) "tudo liberado" para quem é aprovado também na TELA e nas EDGE FUNCTIONS (crm_meu_acesso, crm_acesso_conferir,
--     crm_acao_minha passam a responder acesso total para aprovado) + tira os 2 gatilhos de preenchimento.
--  4) telas públicas /feedback e /troca: identificar_aluna_por_whatsapp volta a devolver id, nome completo e programa.
--
-- DESFAZER O ROLLBACK: rodar de novo, em ordem, 20261123110000, 20261123130000 e 20261123140000 (e 20261123100000 se
-- a seção 3 foi usada). Todas são idempotentes.
-- =============================================================

-- ============================================================= SEÇÃO 1 (padrão)
BEGIN;

-- 1.1) Policies restritivas novas ------------------------------------------------------------------------------
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname FROM pg_policies
     WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE' AND policyname LIKE 'crm\_acesso: %'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;

-- 1.2) "Service can ..." de volta a TO public (só as 4 que eram public em 20260321191255) ---------------------------
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname FROM pg_policies
     WHERE schemaname = 'public' AND roles = '{service_role}'
       AND (tablename, policyname) IN (('whatsapp_contacts', 'Service can insert whatsapp_contacts'),
                                       ('whatsapp_contacts', 'Service can update whatsapp_contacts'),
                                       ('whatsapp_messages', 'Service can insert whatsapp_messages'),
                                       ('whatsapp_messages', 'Service can update whatsapp_messages'))
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO public', p.policyname, p.tablename);
  END LOOP;
END $$;

-- 1.3) Storage whatsapp-media como em 20260817202007 ---------------------------------------------------------------
DROP POLICY IF EXISTS "whatsapp-media: ler" ON storage.objects;
DROP POLICY IF EXISTS "whatsapp-media: subir" ON storage.objects;
DROP POLICY IF EXISTS "whatsapp-media: sobrescrever" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload whatsapp media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read whatsapp media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update whatsapp media" ON storage.objects;

CREATE POLICY "Authenticated can upload whatsapp media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'whatsapp-media');

CREATE POLICY "Authenticated can read whatsapp media"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'whatsapp-media');

CREATE POLICY "Authenticated can update whatsapp media"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'whatsapp-media');

-- 1.4) Gatilhos novos que recusam gravação --------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_crm_contato_zz_acoes_guarda ON public.whatsapp_contacts;
DROP TRIGGER IF EXISTS trg_profiles_guarda_campos ON public.profiles;
-- trg_profiles_guarda_aprovacao FICA (furo de auto-aprovação). Ver seção 2.

-- 1.5) Funções reescritas por troca de texto: troca inversa, exata ---------------------------------------------------
DO $$
DECLARE
  r record;
  def text;
  novo_def text;
  antigo text;
  novo text;
  novo_transf text;
  trocas text[][];
  i integer;
BEGIN
  -- 110000 (D): crm_ai_aplicar_tags_inicio / crm_ai_pausar_por_humano / crm_ai_transferir_para_ia / crm_ai_enfileirar
  antigo := 'IF NOT public.crm_ai_pode() THEN RAISE EXCEPTION ''sem permissão''; END IF;';
  novo := antigo || E'\n  IF coalesce(auth.role(), '''') <> ''service_role'' AND NOT public.crm_conversa_pode(auth.uid(), p_numero_id, p_phone, 2) THEN'
                 || E'\n    RAISE EXCEPTION ''sem permissão nesta conversa'' USING ERRCODE = ''42501'';\n  END IF;';
  novo_transf := replace(novo, 'p_phone, 2) THEN',
    'p_phone, 2) OR (coalesce(auth.role(), '''') <> ''service_role'' AND NOT public.crm_acao(auth.uid(), ''conversas.transferir'')) THEN');
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('crm_ai_aplicar_tags_inicio', 'crm_ai_pausar_por_humano', 'crm_ai_transferir_para_ia', 'crm_ai_enfileirar')
  LOOP
    def := pg_get_functiondef(r.oid);
    novo_def := replace(replace(def, novo_transf, antigo), novo, antigo);
    IF novo_def <> def THEN EXECUTE novo_def; END IF;
  END LOOP;

  -- pares {função, texto novo, texto antigo}
  trocas := ARRAY[
    -- 130000 (7): código opaco só de conversa alcançável
    ARRAY['public.crm_ai_ref_do_contato(text)',
          E'WHERE phone = p_phone\n     AND (coalesce(auth.role(), '''') = ''service_role'' OR public.crm_conversa_pode(auth.uid(), numero_id, phone, 1))\n   ORDER BY',
          'WHERE phone = p_phone ORDER BY'],
    -- 110000 (D): código opaco exigia kanban
    ARRAY['public.crm_ai_ref_do_contato(text)',
          'NOT public.crm_pode(auth.uid(), ARRAY[''conversas'',''kanban'',''agente_ia''], 1)',
          'NOT coalesce(public.is_approved(auth.uid()), false)'],
    ARRAY['public.crm_numero_renomear(uuid,text)',
          'IF auth.uid() IS NULL OR NOT public.crm_acao(auth.uid(), ''conexao.conectar'') THEN',
          'IF auth.uid() IS NULL OR NOT public.is_approved(auth.uid()) THEN'],
    ARRAY['public.crm_tag_criar(text)',
          'IF NOT public.crm_pode(auth.uid(), ARRAY[''conversas'',''kanban'',''automacao''], 2) THEN',
          'IF NOT public.is_approved(auth.uid()) THEN'],
    ARRAY['public.grupos_cancelar_mensagem(uuid)',
          'IF NOT public.crm_acao(auth.uid(), ''disparo.enviar'') THEN',
          'IF NOT public.is_approved(auth.uid()) THEN'],
    -- 130000 (7)
    ARRAY['public.crm_tags_existentes()',
          'WHERE public.crm_pode(auth.uid(), ARRAY[''conversas'',''kanban'',''automacao'',''banco'',''base_leads'',''agente_ia'',''disparo'',''configuracoes''], 1) AND',
          'WHERE public.is_approved(auth.uid()) AND'],
    ARRAY['public.crm_eventos_disponiveis()',
          'WHERE public.crm_pode(auth.uid(), ARRAY[''conversas'',''kanban'',''automacao''], 1)',
          'WHERE public.is_approved(auth.uid())']
  ];
  FOR i IN 1 .. array_length(trocas, 1) LOOP
    IF to_regprocedure(trocas[i][1]) IS NULL THEN CONTINUE; END IF;
    def := pg_get_functiondef(to_regprocedure(trocas[i][1]));
    novo_def := replace(def, trocas[i][2], trocas[i][3]);
    IF novo_def <> def THEN EXECUTE novo_def; END IF;
  END LOOP;
END $$;

-- 1.6) crm_ai_assumir: definição de 20261111100000 (cópia exata) ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_ai_assumir(p_numero_id uuid, p_phone text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_slug text;
BEGIN
  IF NOT public.crm_ai_pode() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  SELECT ai_agent_slug INTO v_slug FROM public.whatsapp_contacts
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id) LIMIT 1;
  UPDATE public.whatsapp_contacts
     SET ai_pausado = true, ai_pausado_motivo = 'humano', ai_precisa_humano = false, updated_at = now()
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id);
  UPDATE public.crm_ai_fila SET status = 'ignorado', motivo = 'humano assumiu', updated_at = now()
   WHERE contact_phone = p_phone AND status = 'pendente'
     AND (p_numero_id IS NULL OR numero_id = p_numero_id);
  INSERT INTO public.crm_ai_eventos (contact_phone, numero_id, agent_slug, tipo, detalhe, usuario_id)
  VALUES (p_phone, p_numero_id, v_slug, 'assumido_humano', 'IA pausada: atendimento humano (botão Assumir)', auth.uid());
  RETURN 'ok';
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_assumir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ai_assumir(uuid, text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferir depois (só leitura):
--   SELECT count(*) FROM pg_policies WHERE policyname LIKE 'crm_acesso:%';                        -- 0
--   SELECT policyname, roles FROM pg_policies WHERE policyname ILIKE 'Service can %whatsapp%';     -- 4, {public}
--   SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND policyname ILIKE '%whatsapp media%';  -- 3
--   SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_crm_contato_zz_acoes_guarda','trg_profiles_guarda_campos'); -- 0
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_profiles_guarda_aprovacao';                  -- 1 (fica)


-- ============================================================= SEÇÃO 2 (OPCIONAL) — REABRE 2 FUROS
-- Só se a causa da queda for o gatilho de aprovação ou a falta da coluna profiles.meta_access_token (ex.: uma tela ou
-- edge que lia a coluna). Para usar: apague a linha "/*" logo abaixo e a linha "*/" do fim da seção, e rode só a seção.
/*
-- @@SECAO2_INICIO
BEGIN;
-- 2.1) usuário pendente volta a conseguir gravar approved = true em si mesmo pela API (furo da auto-aprovação)
DROP TRIGGER IF EXISTS trg_profiles_guarda_aprovacao ON public.profiles;
-- 2.2) a coluna profiles.meta_access_token volta, com o token copiado de profiles_meta_credenciais (que FICA).
--      Todo aprovado volta a ler o token dos colegas (policy "Approved users can read team profiles").
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS meta_access_token text;
UPDATE public.profiles p
   SET meta_access_token = c.meta_access_token
  FROM public.profiles_meta_credenciais c
 WHERE c.user_id = p.id AND p.meta_access_token IS NULL AND c.meta_access_token IS NOT NULL;
COMMIT;
NOTIFY pgrst, 'reload schema';
-- @@SECAO2_FIM
*/


-- ============================================================= SEÇÃO 3 (OPCIONAL) — TELA E EDGES LIBERADAS
-- Só se, mesmo depois da seção 1, o usuário aprovado continuar sem menu/botão na tela ou com edge function recusando
-- ("sem permissão") por causa do acesso configurado em crm_acessos. Faz as funções de checagem responderem
-- "acesso total" para TODO aprovado (como antes das permissões). crm_acessos e os dados ficam intactos.
-- Desfazer: rodar de novo 20261123100000 (e depois 110000, 120000, 130000, 140000 se quiser as permissões de volta).
-- Para usar: apague a linha "/*" logo abaixo e a linha "*/" do fim da seção, e rode só a seção.
/*
-- @@SECAO3_INICIO
BEGIN;
CREATE OR REPLACE FUNCTION public.crm_nivel(_uid uuid, _area text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _uid IS NULL THEN 0
              WHEN public.crm_eh_admin(_uid) OR public.is_approved(_uid) THEN 2
              ELSE 0 END
$$;
CREATE OR REPLACE FUNCTION public.crm_acao(_uid uuid, _acao text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND _acao = ANY (public.crm_acoes())
     AND (public.crm_eh_admin(_uid) OR public.is_approved(_uid))
$$;
CREATE OR REPLACE FUNCTION public.crm_numeros_do_usuario(_uid uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _uid IS NOT NULL AND (public.crm_eh_admin(_uid) OR public.is_approved(_uid))
              THEN ARRAY(SELECT id FROM public.crm_numeros) ELSE '{}'::uuid[] END
$$;
CREATE OR REPLACE FUNCTION public.crm_todos_numeros(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (public.crm_eh_admin(_uid) OR public.is_approved(_uid))
$$;
CREATE OR REPLACE FUNCTION public.crm_so_minhas(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.crm_so_departamentos(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT false $$;
-- gatilhos que só preenchem atendente_id/departamento_id (não perdem dado; param de preencher)
DROP TRIGGER IF EXISTS trg_crm_contato_atendente_guarda ON public.whatsapp_contacts;
DROP TRIGGER IF EXISTS trg_crm_contato_departamento_da_etapa ON public.whatsapp_contacts;
COMMIT;
NOTIFY pgrst, 'reload schema';
-- @@SECAO3_FIM
*/


-- ============================================================= SEÇÃO 4 (OPCIONAL) — TELAS PÚBLICAS /feedback e /troca
-- Fora do CRM. Só se as telas públicas de feedback/troca quebrarem com a 140000. REABRE o furo: anon manda um telefone
-- e recebe id, nome completo e programa da aluna; e o navegador volta a escolher o aluna_id do feedback.
-- Para usar: apague a linha "/*" logo abaixo e a linha "*/" do fim da seção, e rode só a seção.
/*
-- @@SECAO4_INICIO
BEGIN;
-- definição de 20260927010000 (cópia exata)
CREATE OR REPLACE FUNCTION public.identificar_aluna_por_whatsapp(p_telefone text)
RETURNS TABLE(id uuid, nome_completo text, programa text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.nome_completo, a.programa
  FROM public.alunas a
  WHERE public.telefone_nucleo(p_telefone) IS NOT NULL
    AND public.telefone_nucleo(a.telefone) = public.telefone_nucleo(p_telefone)
    AND (
      public.telefone_ddd(a.telefone) IS NULL
      OR public.telefone_ddd(p_telefone) IS NULL
      OR public.telefone_ddd(a.telefone) = public.telefone_ddd(p_telefone)
    )
  -- Cadastro com o DDD batendo ganha de cadastro sem DDD.
  ORDER BY
    (public.telefone_ddd(a.telefone) IS NOT NULL
      AND public.telefone_ddd(a.telefone) = public.telefone_ddd(p_telefone)) DESC,
    a.created_at DESC
  LIMIT 1
$$;
COMMENT ON FUNCTION public.identificar_aluna_por_whatsapp(text) IS NULL;
GRANT EXECUTE ON FUNCTION public.identificar_aluna_por_whatsapp(text) TO PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_feedback_resolver_aluna ON public.feedback_semanal_responses;
COMMIT;
NOTIFY pgrst, 'reload schema';
-- @@SECAO4_FIM
*/
