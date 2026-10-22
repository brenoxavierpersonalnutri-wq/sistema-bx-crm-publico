-- =============================================================
-- CRM: permissões — CORREÇÕES da verificação adversarial (21/10/2026). Rodar DEPOIS de 20261123100000/110000/120000.
-- Idempotente. Não apaga dado nenhum. Testado só em Postgres local descartável (supabase/tests/permissoes/rodar.sh).
--
-- Furos fechados (reprodução no relatório da verificação):
--  1) Auto-aprovação: a policy "Users can update own profile" deixava o usuário PENDENTE gravar profiles.approved = true
--     em si mesmo (e virar "aprovado" em todo o sistema, ganhando o acesso padrão do CRM). Agora só admin muda
--     approved pela API; funções SECURITY DEFINER e service_role seguem como antes.
--  2) Storage whatsapp-media: qualquer usuário logado (até pendente) lia, subia e sobrescrevia a mídia de TODAS as
--     conversas de todos os números. Agora: pasta do contato = só quem enxerga a conversa; roteiros/ = Conversas ou
--     Configurações; ia/ = Agente IA ou Configurações; instagram/ = Conversas; o próprio arquivo que subiu, sempre.
--  3) Tabelas que ficaram fora do mapa: ig_contatos (Conversas), base_leads_segmentos (Banco ou Base de leads).
--  4) whatsapp_wa_nomes e whatsapp_backfill_chats só filtravam por área: mostravam nome e telefone de contato de
--     número que a pessoa não vê. Agora seguem a conversa visível / o job visível.
--  5) Ações desligadas (transferir, mover, assumir IA) só valiam nas RPCs: UPDATE direto em whatsapp_contacts
--     contornava. Gatilho confere as mesmas ações quando quem grava é o usuário pela API.
--  6) crm_tags: INSERT direto contornava a checagem de crm_tag_criar.
--  7) crm_tags_existentes / crm_eventos_disponiveis / crm_ai_ref_do_contato: liam (ou marcavam) contato de qualquer
--     número para qualquer aprovado.
-- =============================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.crm_conversa_pode(uuid,uuid,text,integer)') IS NULL
     OR to_regclass('public.crm_departamentos') IS NULL THEN
    RAISE EXCEPTION 'rode antes 20261123100000, 20261123110000 e 20261123120000';
  END IF;
END $$;

-- 1) Só admin aprova/desaprova pela API ----------------------------------------------------------------------
-- INVOKER de propósito: current_user = 'authenticated' só quando o UPDATE veio direto da API (PostgREST). Dentro de
-- função SECURITY DEFINER (aprovação por RPC, handle_new_user) current_user é o dono e passa.
CREATE OR REPLACE FUNCTION public.profiles_guarda_aprovacao()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NEW.approved IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.approved END)
     AND NOT coalesce(public.has_role(auth.uid(), 'admin'), false) THEN
    RAISE EXCEPTION 'só admin aprova ou desaprova usuário' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.profiles_guarda_aprovacao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profiles_guarda_aprovacao() TO authenticated, service_role;
DROP TRIGGER IF EXISTS trg_profiles_guarda_aprovacao ON public.profiles;
CREATE TRIGGER trg_profiles_guarda_aprovacao BEFORE INSERT OR UPDATE OF approved ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_guarda_aprovacao();

-- 2) Storage whatsapp-media ---------------------------------------------------------------------------------------
-- Caminhos que o sistema grava: <pasta do contato>/... (openwa-webhook e envio de mídia; pasta = telefone com o que
-- não é [0-9A-Za-z-] trocado por "_", grupo 1203...@g.us -> 1203..._g_us), roteiros/<id>/..., ia/<agente>/...,
-- instagram/<igsid>/... . O que depende só de quem pede vira (SELECT ...) = InitPlan, uma vez por consulta; por linha
-- sobra a pasta e, para quem não vê tudo, o EXISTS em whatsapp_contacts (com o RLS de quem pede).
DROP POLICY IF EXISTS "Authenticated can read whatsapp media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload whatsapp media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update whatsapp media" ON storage.objects;
DROP POLICY IF EXISTS "whatsapp-media: ler" ON storage.objects;
DROP POLICY IF EXISTS "whatsapp-media: subir" ON storage.objects;
DROP POLICY IF EXISTS "whatsapp-media: sobrescrever" ON storage.objects;
DROP FUNCTION IF EXISTS public.crm_midia_pode(uuid, text, uuid, integer);
DO $$
DECLARE
  uid constant text := '(SELECT auth.uid())';
  regra text;
  ler text;
  gravar text;
  gravar_dono text;
BEGIN
  -- %1$s = uid, %2$s = nível (1 ver, 2 editar), %3$s = cláusula do dono do arquivo
  regra := $r$bucket_id = 'whatsapp-media' AND (
    (SELECT public.crm_eh_admin(%1$s))
    %3$s
    OR (split_part(objects.name, '/', 1) = 'roteiros'  AND (SELECT public.crm_pode(%1$s, '{conversas,configuracoes}'::text[], %2$s)))
    OR (split_part(objects.name, '/', 1) = 'ia'        AND (SELECT public.crm_pode(%1$s, '{agente_ia,configuracoes}'::text[], %2$s)))
    OR (split_part(objects.name, '/', 1) = 'instagram' AND (SELECT public.crm_pode(%1$s, '{conversas}'::text[], %2$s)))
    OR (split_part(objects.name, '/', 1) NOT IN ('roteiros', 'ia', 'instagram')
        AND (SELECT public.crm_pode(%1$s, '{conversas,kanban}'::text[], %2$s))
        AND ((SELECT public.crm_ve_tudo(%1$s))
             OR EXISTS (SELECT 1 FROM public.whatsapp_contacts c
                         WHERE c.phone = ANY (ARRAY[split_part(objects.name, '/', 1),
                                                   regexp_replace(split_part(objects.name, '/', 1), '_g_us$', '@g.us'),
                                                   regexp_replace(split_part(objects.name, '/', 1), '_lid$', '@lid')]))))
  )$r$;
  gravar_dono := format('OR (objects.owner = %1$s AND (SELECT public.is_approved(%1$s)))', uid);
  ler := format(regra, uid, 1, gravar_dono);
  gravar := format(regra, uid, 2, '');
  EXECUTE format('CREATE POLICY "whatsapp-media: ler" ON storage.objects FOR SELECT TO authenticated USING (%s)', ler);
  EXECUTE format('CREATE POLICY "whatsapp-media: subir" ON storage.objects FOR INSERT TO authenticated WITH CHECK (%s)', gravar);
  EXECUTE format('CREATE POLICY "whatsapp-media: sobrescrever" ON storage.objects FOR UPDATE TO authenticated USING (%1$s) WITH CHECK (%1$s)',
                 format(regra, uid, 2, gravar_dono));
END $$;

-- 3) e 4) Tabelas fora do mapa / filtro de linha que faltava -----------------------------------------------------
-- Mesmo formato e mesmos nomes de policy da 20261123110000 ("crm_acesso: ...", RESTRICTIVE).
DO $$
DECLARE
  m record;
  uid constant text := '(SELECT auth.uid())';
  ler text;
  gravar text;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('ig_contatos',             '{conversas}',          '{conversas}',          'true'),
      ('base_leads_segmentos',    '{banco,base_leads}',   '{banco,base_leads}',   'true'),
      ('whatsapp_wa_nomes',       '{conversas,kanban}',   '{conversas,kanban}',
         format('(SELECT public.crm_ve_tudo(%s)) OR EXISTS (SELECT 1 FROM public.whatsapp_contacts c WHERE c.phone = whatsapp_wa_nomes.telefone)', '(SELECT auth.uid())')),
      ('whatsapp_backfill_chats', '{conversas,conexao}',  '{conversas,conexao}',
         'EXISTS (SELECT 1 FROM public.whatsapp_backfill_jobs j WHERE j.id = whatsapp_backfill_chats.job_id)')
    ) AS t(tabela, ler_areas, gravar_areas, linha)
  LOOP
    IF to_regclass('public.' || m.tabela) IS NULL THEN
      RAISE NOTICE 'crm_permissoes_correcoes: % não existe, pulando', m.tabela;
      CONTINUE;
    END IF;
    ler := format('(SELECT public.crm_pode(%s, %L::text[], 1)) AND (%s)', uid, m.ler_areas, m.linha);
    gravar := format('(SELECT public.crm_pode(%s, %L::text[], 2)) AND (%s)', uid, m.gravar_areas, m.linha);
    EXECUTE format('DROP POLICY IF EXISTS "crm_acesso: ler" ON public.%I', m.tabela);
    EXECUTE format('CREATE POLICY "crm_acesso: ler" ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (%s)', m.tabela, ler);
    EXECUTE format('DROP POLICY IF EXISTS "crm_acesso: criar" ON public.%I', m.tabela);
    EXECUTE format('CREATE POLICY "crm_acesso: criar" ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', m.tabela, gravar);
    EXECUTE format('DROP POLICY IF EXISTS "crm_acesso: alterar" ON public.%I', m.tabela);
    EXECUTE format('CREATE POLICY "crm_acesso: alterar" ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', m.tabela, gravar, gravar);
    EXECUTE format('DROP POLICY IF EXISTS "crm_acesso: apagar" ON public.%I', m.tabela);
    EXECUTE format('CREATE POLICY "crm_acesso: apagar" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', m.tabela, gravar);
  END LOOP;
END $$;

-- 6) crm_tags: criar direto = a mesma regra da RPC crm_tag_criar
DROP POLICY IF EXISTS "crm_acesso: criar" ON public.crm_tags;
CREATE POLICY "crm_acesso: criar" ON public.crm_tags AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.crm_pode((SELECT auth.uid()), '{conversas,kanban,automacao}'::text[], 2)));

-- 5) Ações por UPDATE direto na conversa ---------------------------------------------------------------------------
-- INVOKER: só confere quando o UPDATE veio da API (current_user = authenticated). RPCs SECURITY DEFINER
-- (crm_atendente_definir, crm_departamento_definir, crm_ai_assumir, crm_ai_transferir_para_ia...) já conferem a ação
-- e rodam como o dono; webhook, robô e ticks rodam como service_role. Nenhum dos dois passa por aqui.
CREATE OR REPLACE FUNCTION public.crm_contato_acoes_guarda()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  u uuid := auth.uid();
BEGIN
  IF current_user <> 'authenticated' OR u IS NULL OR public.crm_eh_admin(u) THEN RETURN NEW; END IF;
  IF NEW.atendente_id IS DISTINCT FROM OLD.atendente_id AND NEW.atendente_id IS NOT NULL AND NEW.atendente_id <> u
     AND NOT public.crm_acao(u, 'conversas.transferir') THEN
    RAISE EXCEPTION 'sem permissão para transferir conversa' USING ERRCODE = '42501';
  END IF;
  IF (NEW.departamento_id IS DISTINCT FROM OLD.departamento_id OR NEW.stage IS DISTINCT FROM OLD.stage)
     AND NOT (public.crm_acao(u, 'kanban.mover') OR public.crm_acao(u, 'conversas.transferir')) THEN
    RAISE EXCEPTION 'sem permissão para mover a conversa (etapa/departamento)' USING ERRCODE = '42501';
  END IF;
  IF NEW.ai_pausado IS DISTINCT FROM OLD.ai_pausado AND coalesce(NEW.ai_pausado, false)
     AND NOT public.crm_acao(u, 'conversas.assumir_ia') THEN
    RAISE EXCEPTION 'sem permissão para assumir a conversa da IA' USING ERRCODE = '42501';
  END IF;
  IF (NEW.ai_agent_slug IS DISTINCT FROM OLD.ai_agent_slug
      OR (NEW.ai_pausado IS DISTINCT FROM OLD.ai_pausado AND NOT coalesce(NEW.ai_pausado, false)))
     AND NOT public.crm_acao(u, 'conversas.transferir') THEN
    RAISE EXCEPTION 'sem permissão para transferir a conversa para a IA' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_contato_acoes_guarda() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_contato_acoes_guarda() TO authenticated, service_role;
DROP TRIGGER IF EXISTS trg_crm_contato_zz_acoes_guarda ON public.whatsapp_contacts;
-- "zz": roda depois dos BEFORE que derivam departamento da etapa e atendente do nome
CREATE TRIGGER trg_crm_contato_zz_acoes_guarda
BEFORE UPDATE OF atendente_id, departamento_id, stage, ai_pausado, ai_agent_slug ON public.whatsapp_contacts
FOR EACH ROW EXECUTE FUNCTION public.crm_contato_acoes_guarda();

-- 7) RPCs que liam/marcavam contato de qualquer número ------------------------------------------------------------
DO $$
DECLARE
  def text;
  novo text;
BEGIN
  -- tags e eventos: só quem tem alguma área do CRM onde tag/evento aparece
  IF to_regprocedure('public.crm_tags_existentes()') IS NOT NULL THEN
    def := pg_get_functiondef('public.crm_tags_existentes()'::regprocedure);
    novo := replace(def, 'WHERE public.is_approved(auth.uid()) AND',
      'WHERE public.crm_pode(auth.uid(), ARRAY[''conversas'',''kanban'',''automacao'',''banco'',''base_leads'',''agente_ia'',''disparo'',''configuracoes''], 1) AND');
    IF novo <> def THEN EXECUTE novo; END IF;
  END IF;
  IF to_regprocedure('public.crm_eventos_disponiveis()') IS NOT NULL THEN
    def := pg_get_functiondef('public.crm_eventos_disponiveis()'::regprocedure);
    novo := replace(def, 'WHERE public.is_approved(auth.uid())',
      'WHERE public.crm_pode(auth.uid(), ARRAY[''conversas'',''kanban'',''automacao''], 1)');
    IF novo <> def THEN EXECUTE novo; END IF;
  END IF;
  -- código opaco: só de conversa que a pessoa alcança (sem isso servia de oráculo "esse telefone existe?" e
  -- gravava ai_ref em conversa de outro número)
  IF to_regprocedure('public.crm_ai_ref_do_contato(text)') IS NOT NULL THEN
    def := pg_get_functiondef('public.crm_ai_ref_do_contato(text)'::regprocedure);
    novo := replace(def, E'WHERE phone = p_phone ORDER BY',
      E'WHERE phone = p_phone\n     AND (coalesce(auth.role(), '''') = ''service_role'' OR public.crm_conversa_pode(auth.uid(), numero_id, phone, 1))\n   ORDER BY');
    IF novo <> def THEN EXECUTE novo; END IF;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferir:
--   SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'whatsapp-media%';
--   SELECT tablename FROM pg_policies WHERE policyname = 'crm_acesso: ler' AND tablename IN ('ig_contatos','base_leads_segmentos');
--   SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_profiles_guarda_aprovacao', 'trg_crm_contato_zz_acoes_guarda');
