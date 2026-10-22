-- =============================================================
-- CRM: permissões por colaborador — PARTE 2 de 2 (proteção no banco).
-- Rodar inteiro no SQL editor do Lovable Cloud DEPOIS da parte 1 (20261123100000_crm_permissoes_estrutura.sql).
-- Idempotente. Não apaga dado nenhum.
--
-- Como protege:
--  A) Policies RESTRITIVAS (somam "E" com as que já existem, sem precisar saber o nome delas) em cada tabela do
--     CRM: ler exige "ver" numa das áreas da tabela; criar/alterar/apagar exige "editar". Nas tabelas de conversa,
--     mensagem, contato e envio, a linha também precisa ser de um número da pessoa — e, quando ligado, ser
--     conversa dela (atendente) ou sem atendente, e do departamento dela ou sem departamento.
--     Admin passa em tudo; service_role ignora RLS (webhook, robô, automações, disparos e ticks seguem iguais).
--  B) Performance: toda checagem é função SECURITY DEFINER STABLE chamada como (SELECT fn((SELECT auth.uid()))),
--     que vira InitPlan (uma vez por consulta, não por linha). As policies permissivas antigas dessas tabelas que
--     chamavam is_approved(auth.uid()) / has_role / pode_lives por linha são reescritas no mesmo formato.
--  C) Furos fechados: as policies "Service can ..." de whatsapp_contacts / whatsapp_messages / ai_agent_settings
--     eram TO public com true — qualquer um com a chave anon inseria/alterava contato e mensagem, e lia o prompt
--     da IA. Passam a valer só para service_role (que já ignora RLS: nada muda para as edge functions).
--  D) RPCs SECURITY DEFINER que agem numa conversa (assumir, pausar, transferir para IA, tags ao começar,
--     enfileirar) passam a conferir número/atendente/departamento; renomear número exige Conexão "editar";
--     criar tag e cancelar mensagem de grupo exigem "editar" na área.
-- =============================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.crm_conversa_pode(uuid,uuid,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'rode antes a parte 1: 20261123100000_crm_permissoes_estrutura.sql';
  END IF;
END $$;

-- A) Mapa: tabela | áreas que leem | áreas que gravam | filtro de linha --------------------------------------
--   contato .......... a própria conversa (número + atendente + departamento)
--   mensagem ......... número + a conversa visível (só quando "só as dele"/"só dos departamentos" está ligado)
--   telefone ......... existe uma conversa visível com esse telefone (atalho: quem vê tudo não consulta)
--   telefone_numero .. idem, no mesmo número da linha (número nulo = qualquer)
--   numero ........... numero_id entre os da pessoa (nulo = número padrão)
--   proprio_numero ... a linha É o número (crm_numeros)
--   area ............. só a área
CREATE TEMP TABLE _crm_mapa (tabela text, ler text[], gravar text[], filtro text, acao text) ON COMMIT DROP;
INSERT INTO _crm_mapa (tabela, ler, gravar, filtro) VALUES
  ('whatsapp_contacts',        '{conversas,kanban}',                        '{conversas,kanban}',           'contato'),
  ('whatsapp_messages',        '{conversas,kanban}',                        '{conversas}',                    'mensagem'),
  ('crm_contato_eventos',      '{conversas,kanban}',                        '{conversas,kanban}',           'telefone'),
  ('crm_roteiro_envios',       '{conversas}',                                 '{conversas}',                    'telefone'),
  ('crm_ai_eventos',           '{conversas,agente_ia}',                       '{conversas,agente_ia}',          'telefone_numero'),
  ('crm_ai_fila',              '{conversas,agente_ia}',                       '{conversas,agente_ia}',          'telefone_numero'),
  ('crm_automacao_fila',       '{automacao}',                                 '{automacao}',                    'numero'),
  ('crm_automacao_log',        '{automacao}',                                 '{automacao}',                    'numero'),
  ('crm_fluxo_execucoes',      '{automacao}',                                 '{automacao}',                    'numero'),
  ('whatsapp_backfill_jobs',   '{conversas,conexao}',                         '{conversas,conexao}',            'numero'),
  ('whatsapp_backfill_chats',  '{conversas,conexao}',                         '{conversas,conexao}',            'area'),
  ('whatsapp_wa_nomes',        '{conversas,kanban}',                        '{conversas,kanban}',           'area'),
  ('crm_numeros',              '{conversas,kanban,automacao,disparo,agente_ia,banco,base_leads,conexao,configuracoes}',
                                                                              '{conexao}',                      'proprio_numero'),
  ('crm_automacoes',           '{automacao,configuracoes,agente_ia}',         '{automacao,configuracoes}',      'area'),
  ('crm_campanhas',            '{automacao,configuracoes}',                   '{automacao,configuracoes}',      'area'),
  ('crm_envio_config',         '{automacao,configuracoes}',                   '{automacao,configuracoes}',      'area'),
  ('crm_wa_templates',         '{automacao,configuracoes}',                   '{automacao,configuracoes}',      'area'),
  ('crm_fluxos',               '{automacao,agente_ia}',                       '{automacao}',                    'area'),
  ('crm_fluxo_pastas',         '{automacao}',                                 '{automacao}',                    'area'),
  ('crm_fluxo_base_vistos',    '{automacao}',                                 '{automacao}',                    'area'),
  ('crm_fluxo_entradas',       '{automacao}',                                 '{automacao}',                    'area'),
  ('crm_roteiros',             '{conversas,configuracoes}',                   '{configuracoes,conversas}',      'area'),
  ('crm_roteiro_passos',       '{conversas,configuracoes}',                   '{configuracoes,conversas}',      'area'),
  ('crm_ai_agents',            '{agente_ia,conversas,automacao,configuracoes}', '{agente_ia,configuracoes}',    'area'),
  ('crm_ai_conhecimento',      '{agente_ia,configuracoes}',                   '{agente_ia,configuracoes}',      'area'),
  ('crm_ai_exemplos',          '{agente_ia,configuracoes}',                   '{agente_ia,configuracoes}',      'area'),
  ('crm_ai_prompt_versoes',    '{agente_ia,configuracoes}',                   '{agente_ia,configuracoes}',      'area'),
  ('ai_agent_settings',        '{agente_ia,configuracoes}',                   '{agente_ia,configuracoes}',      'area'),
  ('crm_segmentos',            '{banco,automacao}',                           '{banco}',                        'area'),
  ('base_leads',               '{base_leads}',                                '{base_leads}',                   'area'),
  ('crm_grupo_links',          '{disparo,automacao}',                         '{disparo,automacao}',            'area'),
  ('grupos_campanhas',         '{disparo}',                                   '{disparo}',                      'area'),
  ('grupos_campanha_grupos',   '{disparo}',                                   '{disparo}',                      'area'),
  ('grupos_cliques',           '{disparo}',                                   '{disparo}',                      'area'),
  ('grupos_criacoes',          '{disparo}',                                   '{disparo}',                      'area'),
  ('grupos_disparo_estado',    '{disparo}',                                   '{disparo}',                      'area'),
  ('grupos_envios',            '{disparo}',                                   '{disparo}',                      'area'),
  ('grupos_membros_eventos',   '{disparo}',                                   '{disparo}',                      'area'),
  ('grupos_mensagens',         '{disparo}',                                   '{disparo}',                      'area'),
  ('ig_contas',                '{conversas,conexao}',                         '{conexao}',                      'area'),
  ('ig_kanban',              '{conversas}',                                 '{conversas}',                    'area'),
  ('ig_mensagens',             '{conversas}',                                 '{conversas}',                    'area'),
  ('live_rooms',               '{lives}', '{lives}', 'area'),
  ('live_destinations',        '{lives}', '{lives}', 'area'),
  ('live_invites',             '{lives}', '{lives}', 'area'),
  ('live_overlays',            '{lives}', '{lives}', 'area'),
  ('live_reprise_series',      '{lives}', '{lives}', 'area'),
  ('live_semanas',             '{lives}', '{lives}', 'area'),
  ('live_videos',              '{lives}', '{lives}', 'area'),
  ('webinars',                 '{lives}', '{lives}', 'area'),
  ('webinar_sessions',         '{lives}', '{lives}', 'area'),
  ('webinar_registrations',    '{lives}', '{lives}', 'area'),
  ('webinar_attendance',       '{lives}', '{lives}', 'area'),
  ('webinar_chat_messages',    '{lives}', '{lives}', 'area'),
  ('webinar_chat_script',      '{lives}', '{lives}', 'area'),
  ('webinar_offers',           '{lives}', '{lives}', 'area'),
  ('webinar_reminders_queue',  '{lives}', '{lives}', 'area'),
  ('webinar_analytics',        '{lives}', '{lives}', 'area');
-- ações que também precisam estar ligadas para gravar
UPDATE _crm_mapa SET acao = 'agente_ia.editar_prompt'
 WHERE tabela IN ('crm_ai_agents', 'crm_ai_conhecimento', 'crm_ai_exemplos', 'crm_ai_prompt_versoes', 'ai_agent_settings');
UPDATE _crm_mapa SET acao = 'disparo.enviar' WHERE tabela IN ('grupos_mensagens', 'grupos_campanhas', 'grupos_campanha_grupos');
UPDATE _crm_mapa SET acao = 'conexao.conectar' WHERE tabela IN ('crm_numeros', 'ig_contas');

DO $$
DECLARE
  m record;
  uid constant text := '(SELECT auth.uid())';
  perm text;
  linha text;
  ler text;
  gravar text;
  cmd text;
  p record;
  novo_q text;
  novo_c text;
BEGIN
  perm := format('(SELECT public.crm_numeros_do_usuario(%s))::uuid[]', uid);
  FOR m IN SELECT * FROM _crm_mapa LOOP
    IF to_regclass('public.' || m.tabela) IS NULL THEN
      RAISE NOTICE 'crm_permissoes: % não existe, pulando', m.tabela;
      CONTINUE;
    END IF;

    linha := CASE m.filtro
      WHEN 'contato' THEN format(
        'numero_id = ANY (%1$s) AND ((SELECT NOT public.crm_so_minhas(%2$s)) OR atendente_id IS NULL OR atendente_id = %2$s)'
        ' AND ((SELECT NOT public.crm_so_departamentos(%2$s)) OR departamento_id IS NULL'
        ' OR departamento_id = ANY ((SELECT public.crm_meus_departamentos(%2$s))::uuid[]))', perm, uid)
      WHEN 'mensagem' THEN format(
        'numero_id = ANY (%1$s) AND ((SELECT public.crm_ve_todas_conversas(%2$s)) OR EXISTS (SELECT 1 FROM public.whatsapp_contacts c'
        ' WHERE c.numero_id = whatsapp_messages.numero_id AND c.phone = whatsapp_messages.contact_phone))', perm, uid)
      WHEN 'telefone' THEN format(
        '(SELECT public.crm_ve_tudo(%1$s)) OR EXISTS (SELECT 1 FROM public.whatsapp_contacts c WHERE c.phone = %2$I.contact_phone)',
        uid, m.tabela)
      WHEN 'telefone_numero' THEN format(
        '(SELECT public.crm_ve_tudo(%1$s)) OR EXISTS (SELECT 1 FROM public.whatsapp_contacts c WHERE c.phone = %2$I.contact_phone'
        ' AND (%2$I.numero_id IS NULL OR c.numero_id = %2$I.numero_id))', uid, m.tabela)
      WHEN 'numero' THEN format(
        'numero_id = ANY (%1$s) OR (numero_id IS NULL AND (SELECT public.crm_padrao_permitido(%2$s)))', perm, uid)
      WHEN 'proprio_numero' THEN format('id = ANY (%s)', perm)
      ELSE 'true'
    END;
    ler := format('(SELECT public.crm_pode(%s, %L::text[], 1)) AND (%s)', uid, m.ler, linha);
    gravar := format('(SELECT public.crm_pode(%s, %L::text[], 2)) AND (%s)', uid, m.gravar, linha);
    IF m.acao IS NOT NULL THEN
      gravar := format('(SELECT public.crm_acao(%s, %L)) AND %s', uid, m.acao, gravar);
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS "crm_acesso: ler" ON public.%I', m.tabela);
    EXECUTE format('CREATE POLICY "crm_acesso: ler" ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (%s)', m.tabela, ler);
    EXECUTE format('DROP POLICY IF EXISTS "crm_acesso: criar" ON public.%I', m.tabela);
    EXECUTE format('CREATE POLICY "crm_acesso: criar" ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', m.tabela, gravar);
    EXECUTE format('DROP POLICY IF EXISTS "crm_acesso: alterar" ON public.%I', m.tabela);
    EXECUTE format('CREATE POLICY "crm_acesso: alterar" ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', m.tabela, gravar, gravar);
    EXECUTE format('DROP POLICY IF EXISTS "crm_acesso: apagar" ON public.%I', m.tabela);
    EXECUTE format('CREATE POLICY "crm_acesso: apagar" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', m.tabela, gravar);

    -- B) permissivas antigas desta tabela: a mesma regra, sem rodar por linha
    FOR p IN
      SELECT policyname, qual, with_check FROM pg_policies
       WHERE schemaname = 'public' AND tablename = m.tabela AND permissive = 'PERMISSIVE'
    LOOP
      novo_q := p.qual;
      novo_c := p.with_check;
      FOREACH cmd IN ARRAY ARRAY['is_approved', 'pode_lives'] LOOP
        novo_q := replace(novo_q, cmd || '(auth.uid())', format('( SELECT %s(( SELECT auth.uid() AS uid)) AS %s)', cmd, cmd));
        novo_c := replace(novo_c, cmd || '(auth.uid())', format('( SELECT %s(( SELECT auth.uid() AS uid)) AS %s)', cmd, cmd));
      END LOOP;
      novo_q := replace(novo_q, 'has_role(auth.uid(), ''admin''::app_role)', '( SELECT has_role(( SELECT auth.uid() AS uid), ''admin''::app_role) AS has_role)');
      novo_c := replace(novo_c, 'has_role(auth.uid(), ''admin''::app_role)', '( SELECT has_role(( SELECT auth.uid() AS uid), ''admin''::app_role) AS has_role)');
      IF novo_q IS DISTINCT FROM p.qual THEN
        EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', p.policyname, m.tabela, novo_q);
      END IF;
      IF novo_c IS DISTINCT FROM p.with_check THEN
        EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', p.policyname, m.tabela, novo_c);
      END IF;
    END LOOP;

    -- C) "Service can ..." TO public com true: só service_role
    FOR p IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = m.tabela AND policyname ILIKE 'Service can %'
         AND roles = '{public}'
    LOOP
      EXECUTE format('ALTER POLICY %I ON public.%I TO service_role', p.policyname, m.tabela);
    END LOOP;
  END LOOP;
END $$;

-- índices que as policies por telefone/número usam
CREATE INDEX IF NOT EXISTS crm_ai_eventos_phone_idx ON public.crm_ai_eventos (contact_phone);
CREATE INDEX IF NOT EXISTS crm_contato_eventos_phone_idx ON public.crm_contato_eventos (contact_phone);
DO $$
BEGIN
  IF to_regclass('public.crm_roteiro_envios') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS crm_roteiro_envios_phone_idx ON public.crm_roteiro_envios (contact_phone);
  END IF;
END $$;

-- D) RPCs SECURITY DEFINER: a mesma regra das policies ------------------------------------------------------
-- Troca só a linha de checagem; o resto da função fica igual (mesma técnica da migration 20261028100000).
DO $$
DECLARE
  r record;
  def text;
  antigo text;
  novo text;
BEGIN
  -- conversas: (p_numero_id, p_phone)
  antigo := 'IF NOT public.crm_ai_pode() THEN RAISE EXCEPTION ''sem permissão''; END IF;';
  novo := antigo || E'\n  IF coalesce(auth.role(), '''') <> ''service_role'' AND NOT public.crm_conversa_pode(auth.uid(), p_numero_id, p_phone, 2) THEN'
                 || E'\n    RAISE EXCEPTION ''sem permissão nesta conversa'' USING ERRCODE = ''42501'';\n  END IF;';
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('crm_ai_aplicar_tags_inicio', 'crm_ai_pausar_por_humano', 'crm_ai_transferir_para_ia', 'crm_ai_enfileirar')
  LOOP
    def := pg_get_functiondef(r.oid);
    IF position('crm_conversa_pode' IN def) = 0 AND position(antigo IN def) > 0 THEN
      IF r.proname = 'crm_ai_transferir_para_ia' THEN
        -- transferir para a IA é "transferir"
        EXECUTE replace(def, antigo, replace(novo, 'p_phone, 2) THEN',
          'p_phone, 2) OR (coalesce(auth.role(), '''') <> ''service_role'' AND NOT public.crm_acao(auth.uid(), ''conversas.transferir'')) THEN'));
      ELSE
        EXECUTE replace(def, antigo, novo);
      END IF;
    END IF;
  END LOOP;

  -- código opaco do contato: precisa enxergar kanban
  FOR r IN SELECT oid FROM pg_proc WHERE oid = to_regprocedure('public.crm_ai_ref_do_contato(text)') LOOP
    def := pg_get_functiondef(r.oid);
    def := replace(def, 'NOT coalesce(public.is_approved(auth.uid()), false)',
                   'NOT public.crm_pode(auth.uid(), ARRAY[''conversas'',''kanban'',''agente_ia''], 1)');
    EXECUTE def;
  END LOOP;

  -- renomear número: Conexão WhatsApp "editar"
  FOR r IN SELECT oid FROM pg_proc WHERE oid = to_regprocedure('public.crm_numero_renomear(uuid,text)') LOOP
    def := pg_get_functiondef(r.oid);
    def := replace(def, 'IF auth.uid() IS NULL OR NOT public.is_approved(auth.uid()) THEN',
                   'IF auth.uid() IS NULL OR NOT public.crm_acao(auth.uid(), ''conexao.conectar'') THEN');
    EXECUTE def;
  END LOOP;

  -- criar tag: editar em Conversas, Contatos ou Automação
  FOR r IN SELECT oid FROM pg_proc WHERE oid = to_regprocedure('public.crm_tag_criar(text)') LOOP
    def := pg_get_functiondef(r.oid);
    def := replace(def, 'IF NOT public.is_approved(auth.uid()) THEN',
                   'IF NOT public.crm_pode(auth.uid(), ARRAY[''conversas'',''kanban'',''automacao''], 2) THEN');
    EXECUTE def;
  END LOOP;

  -- cancelar mensagem de grupo: Disparo em grupo "editar"
  FOR r IN SELECT oid FROM pg_proc WHERE oid = to_regprocedure('public.grupos_cancelar_mensagem(uuid)') LOOP
    def := pg_get_functiondef(r.oid);
    def := replace(def, 'IF NOT public.is_approved(auth.uid()) THEN',
                   'IF NOT public.crm_acao(auth.uid(), ''disparo.enviar'') THEN');
    EXECUTE def;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferir (como admin, deve listar as 4 restritivas por tabela):
--   SELECT tablename, policyname, permissive, cmd FROM pg_policies WHERE policyname LIKE 'crm_acesso:%' ORDER BY 1, 2;
--   SELECT tablename, policyname, roles FROM pg_policies WHERE policyname ILIKE 'Service can %';
