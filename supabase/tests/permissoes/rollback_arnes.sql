-- Arnês do teste do ROLLBACK (supabase/rollback/20261123_permissoes_ROLLBACK.sql). Só Postgres DESCARTÁVEL (rollback.sh).
-- Monta o cenário ANTES das migrations de permissão e define a "matriz de comportamento": para cada identidade, o que ela
-- lê, altera, apaga, insere e chama. A matriz é tirada antes das migrations, depois delas e depois do rollback, e comparada.
-- Toda escrita roda dentro de teste.tenta(): executa, conta as linhas e DESFAZ (exceção capturada) — a matriz não suja o banco.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE SCHEMA IF NOT EXISTS teste;
GRANT USAGE ON SCHEMA teste TO PUBLIC;
CREATE TABLE IF NOT EXISTS teste.mat (etapa text, quem text, chave text, valor text, PRIMARY KEY (etapa, quem, chave));
CREATE TABLE IF NOT EXISTS teste.res (n serial PRIMARY KEY, nome text, ok boolean, detalhe text);

CREATE OR REPLACE FUNCTION teste.grava(p_etapa text, p_quem text, p_chave text, p_valor text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO teste.mat VALUES (p_etapa, p_quem, p_chave, p_valor)
  ON CONFLICT (etapa, quem, chave) DO UPDATE SET valor = EXCLUDED.valor
$$;

-- executa e DESFAZ: 'ok:<linhas>' ou 'erro:<SQLSTATE>'
CREATE OR REPLACE FUNCTION teste.tenta(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'TT001', MESSAGE = n::text;
  EXCEPTION WHEN SQLSTATE 'TT001' THEN
    RETURN 'ok:' || SQLERRM;
  END;
EXCEPTION WHEN OTHERS THEN
  RETURN 'erro:' || SQLSTATE;
END $$;

CREATE OR REPLACE FUNCTION teste.conta(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') x' INTO v;
  RETURN v::text;
EXCEPTION WHEN OTHERS THEN
  RETURN 'erro:' || SQLSTATE;
END $$;

CREATE OR REPLACE FUNCTION teste.como(p_uid uuid, p_papel text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
                    CASE WHEN p_uid IS NULL THEN json_build_object('role', p_papel)::text
                         ELSE json_build_object('sub', p_uid, 'role', p_papel)::text END, false);
$$;

-- tabelas da matriz: todas as que as migrations protegem e que existiam ANTES delas (fixado na primeira chamada)
CREATE TABLE IF NOT EXISTS teste.tabelas (tabela text PRIMARY KEY, coluna text);
GRANT SELECT ON teste.tabelas TO PUBLIC;

CREATE OR REPLACE FUNCTION teste.matriz(p_etapa text, p_quem text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  t record;
  n_fit2 uuid;
  n_sup uuid;
  rpc text;
BEGIN
  SELECT id INTO n_fit2 FROM public.crm_numeros WHERE chave = 'comercial-fit-2';
  SELECT id INTO n_sup FROM public.crm_numeros WHERE chave = 'suporte-consultoria-1';

  -- genérico: ler / alterar (SET col = col) / apagar, em cada tabela
  FOR t IN SELECT * FROM teste.tabelas ORDER BY 1 LOOP
    PERFORM teste.grava(p_etapa, p_quem, 'ler:' || t.tabela, teste.conta(format('SELECT 1 FROM public.%I', t.tabela)));
    PERFORM teste.grava(p_etapa, p_quem, 'alterar:' || t.tabela, teste.tenta(format('UPDATE public.%I SET %I = %I', t.tabela, t.coluna, t.coluna)));
    PERFORM teste.grava(p_etapa, p_quem, 'apagar:' || t.tabela, teste.tenta(format('DELETE FROM public.%I', t.tabela)));
  END LOOP;

  -- conversa / mensagem
  PERFORM teste.grava(p_etapa, p_quem, 'inserir:whatsapp_contacts', teste.tenta(format(
    $s$INSERT INTO public.whatsapp_contacts (numero_id, phone, name) VALUES (%L, '5511977770001', 'novo')$s$, n_sup)));
  PERFORM teste.grava(p_etapa, p_quem, 'inserir:whatsapp_messages', teste.tenta(format(
    $s$INSERT INTO public.whatsapp_messages (numero_id, contact_phone, body, message_id) VALUES (%L, '5511900000006', 'x', 'mat-1')$s$, n_sup)));
  PERFORM teste.grava(p_etapa, p_quem, 'alterar:whatsapp_messages.body', teste.tenta(
    $s$UPDATE public.whatsapp_messages SET body = body || '' WHERE contact_phone LIKE '55119000000%'$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'alterar:whatsapp_contacts.stage', teste.tenta(
    $s$UPDATE public.whatsapp_contacts SET stage = 'agendado' WHERE phone = '5511900000002'$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'alterar:whatsapp_contacts.atendente', teste.tenta(
    $s$UPDATE public.whatsapp_contacts SET atendente = 'Fulano' WHERE phone = '5511900000002'$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'alterar:whatsapp_contacts.ai_pausado', teste.tenta(
    $s$UPDATE public.whatsapp_contacts SET ai_pausado = true WHERE phone = '5511900000008'$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'alterar:whatsapp_contacts.ai_agent_slug', teste.tenta(
    $s$UPDATE public.whatsapp_contacts SET ai_agent_slug = 'agente-teste' WHERE phone = '5511900000002'$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'inserir:crm_contato_eventos', teste.tenta(
    $s$INSERT INTO public.crm_contato_eventos (contact_phone, tipo, valor) VALUES ('5511900000006', 'tag', 'y')$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'inserir:crm_tags', teste.tenta(
    $s$INSERT INTO public.crm_tags (nome) VALUES ('tag-matriz')$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'inserir:crm_automacoes', teste.tenta(
    $s$INSERT INTO public.crm_automacoes (nome, gatilho_tipo) VALUES ('m', 'tag')$s$));

  -- storage whatsapp-media
  PERFORM teste.grava(p_etapa, p_quem, 'storage:ler', teste.conta($s$SELECT 1 FROM storage.objects WHERE bucket_id = 'whatsapp-media'$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'storage:subir-contato', teste.tenta(
    $s$INSERT INTO storage.objects (bucket_id, name) VALUES ('whatsapp-media', '5511900000006/novo.jpg')$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'storage:subir-roteiro', teste.tenta(
    $s$INSERT INTO storage.objects (bucket_id, name) VALUES ('whatsapp-media', 'roteiros/r1/novo.jpg')$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'storage:sobrescrever', teste.tenta(
    $s$UPDATE storage.objects SET metadata = '{}' WHERE bucket_id = 'whatsapp-media'$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'storage:apagar', teste.tenta(
    $s$DELETE FROM storage.objects WHERE bucket_id = 'whatsapp-media'$s$));

  -- profiles (o próprio)
  PERFORM teste.grava(p_etapa, p_quem, 'profiles:closer_em_si', teste.tenta(
    $s$UPDATE public.profiles SET is_closer = NOT coalesce(is_closer, false) WHERE id = auth.uid()$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'profiles:nome_de_outro', teste.tenta(
    $s$UPDATE public.profiles SET full_name = 'Admin Breno' WHERE id = auth.uid()$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'profiles:nome_proprio', teste.tenta(
    $s$UPDATE public.profiles SET full_name = full_name || ' 2' WHERE id = auth.uid()$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'profiles:muda_approved_em_si', teste.tenta(
    $s$UPDATE public.profiles SET approved = NOT approved WHERE id = auth.uid()$s$));
  PERFORM teste.grava(p_etapa, p_quem, 'profiles:aprovar_pendente', teste.tenta(
    $s$UPDATE public.profiles SET approved = true WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002'$s$));

  -- RPCs que as migrations reescreveram (resultado = linhas devolvidas ou o erro)
  FOREACH rpc IN ARRAY ARRAY[
    format($s$SELECT public.crm_ai_assumir(%L, '5511900000008')$s$, n_fit2),
    format($s$SELECT public.crm_ai_pausar_por_humano(%L, '5511900000002', 'teste')$s$, n_fit2),
    $s$SELECT public.crm_ai_pausar_por_humano(NULL, '5511900000006', 'teste')$s$,
    format($s$SELECT public.crm_ai_transferir_para_ia(%L, '5511900000006', 'agente-teste')$s$, n_sup),
    format($s$SELECT public.crm_ai_aplicar_tags_inicio(%L, '5511900000002', 'agente-teste')$s$, n_fit2),
    format($s$SELECT public.crm_ai_enfileirar(%L, '5511900000006', 'agente-teste')$s$, n_sup),
    $s$SELECT public.crm_ai_ref_do_contato('5511900000006')$s$,
    format($s$SELECT public.crm_numero_renomear(%L, 'Suporte renomeado')$s$, n_sup),
    $s$SELECT public.crm_tag_criar('tag-rpc')$s$,
    $s$SELECT public.grupos_cancelar_mensagem((SELECT id FROM public.grupos_mensagens LIMIT 1))$s$,
    $s$SELECT * FROM public.crm_tags_existentes()$s$,
    $s$SELECT * FROM public.crm_eventos_disponiveis()$s$
  ] LOOP
    PERFORM teste.grava(p_etapa, p_quem, 'rpc:' || split_part(split_part(rpc, 'public.', 2), '(', 1)
                        || CASE WHEN rpc LIKE '%(NULL,%' THEN '(sem numero)' ELSE '' END, teste.tenta(rpc));
  END LOOP;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO PUBLIC;

-- foto do catálogo (policies, gatilhos, funções, colunas)
CREATE OR REPLACE FUNCTION teste.foto(p_etapa text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  CREATE TABLE IF NOT EXISTS teste.f_pol (etapa text, schemaname name, tablename name, policyname name, permissive text, roles name[], cmd text, qual text, with_check text);
  CREATE TABLE IF NOT EXISTS teste.f_trg (etapa text, tabela text, tgname name, tgenabled "char");
  CREATE TABLE IF NOT EXISTS teste.f_fun (etapa text, f text, def text);
  CREATE TABLE IF NOT EXISTS teste.f_col (etapa text, tabela text, coluna text);
  DELETE FROM teste.f_pol WHERE etapa = p_etapa; DELETE FROM teste.f_trg WHERE etapa = p_etapa;
  DELETE FROM teste.f_fun WHERE etapa = p_etapa; DELETE FROM teste.f_col WHERE etapa = p_etapa;
  INSERT INTO teste.f_pol SELECT p_etapa, schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies;
  INSERT INTO teste.f_trg SELECT p_etapa, tgrelid::regclass::text, tgname, tgenabled FROM pg_trigger WHERE NOT tgisinternal;
  INSERT INTO teste.f_fun SELECT p_etapa, p.oid::regprocedure::text, pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind = 'f';
  INSERT INTO teste.f_col SELECT p_etapa, table_schema || '.' || table_name, column_name
    FROM information_schema.columns WHERE table_schema IN ('public', 'storage');
END $$;
