-- Checagens do ROLLBACK (seção 1). Rodado por rollback.sh depois das matrizes antes / migrado / rollback1 / rollback3.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
TRUNCATE teste.res;
CREATE OR REPLACE FUNCTION teste.ok(p_nome text, p_cond boolean, p_detalhe text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO teste.res (nome, ok, detalhe) VALUES (p_nome, coalesce(p_cond, false), p_detalhe) $$;

-- InitPlan -> forma por linha (a 110000 reescreveu as permissivas antigas nesse formato; é a mesma regra)
CREATE OR REPLACE FUNCTION teste.norm(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(coalesce(t, ''),
    '( SELECT is_approved(( SELECT auth.uid() AS uid)) AS is_approved)', 'is_approved(auth.uid())'),
    '( SELECT pode_lives(( SELECT auth.uid() AS uid)) AS pode_lives)', 'pode_lives(auth.uid())'),
    '( SELECT has_role(( SELECT auth.uid() AS uid), ''admin''::app_role) AS has_role)', 'has_role(auth.uid(), ''admin''::app_role)')
$$;

-- diferenças de matriz entre duas etapas (mesma identidade, ou identidades diferentes)
CREATE OR REPLACE FUNCTION teste.dif(e1 text, q1 text, e2 text, q2 text)
RETURNS TABLE (chave text, v1 text, v2 text) LANGUAGE sql AS $$
  SELECT coalesce(a.chave, b.chave), a.valor, b.valor
    FROM (SELECT * FROM teste.mat WHERE etapa = e1 AND quem = q1) a
    FULL JOIN (SELECT * FROM teste.mat WHERE etapa = e2 AND quem = q2) b ON a.chave = b.chave
   WHERE a.valor IS DISTINCT FROM b.valor
$$;
-- o que pode diferir de "antes" depois do rollback: a trava de auto-aprovação continua (de propósito)
CREATE OR REPLACE FUNCTION teste.dif_fora_excecao(e1 text, q1 text, e2 text, q2 text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(chave || ' [' || coalesce(v1, '-') || ' -> ' || coalesce(v2, '-') || ']', '; ' ORDER BY chave)
    FROM teste.dif(e1, q1, e2, q2)
   WHERE NOT (chave = 'profiles:muda_approved_em_si' OR (q2 = 'PEND' AND chave = 'profiles:aprovar_pendente'))
$$;

-- -------------------------------------------------------------------------------------- 1) o teste não é vazio
SELECT teste.ok('pré: as migrations MUDAM o comportamento do COMUM restringido (>= 40 medições diferentes de antes)',
  (SELECT count(*) FROM teste.dif('antes', 'COMUM', 'migrado', 'COMUM')) >= 40,
  (SELECT count(*) FROM teste.dif('antes', 'COMUM', 'migrado', 'COMUM'))::text || ' diferenças');
SELECT teste.ok('pré: com as migrations o COMUM restringido lê 0 conversas',
  (SELECT valor FROM teste.mat WHERE etapa = 'migrado' AND quem = 'COMUM' AND chave = 'ler:whatsapp_contacts') = '0');
SELECT teste.ok('pré: com as migrations o NOVO (padrão) lê 0 conversas',
  (SELECT valor FROM teste.mat WHERE etapa = 'migrado' AND quem = 'NOVO' AND chave = 'ler:whatsapp_contacts') = '0');
SELECT teste.ok('pré: com as migrations o storage whatsapp-media fica fechado para o COMUM',
  (SELECT valor FROM teste.mat WHERE etapa = 'migrado' AND quem = 'COMUM' AND chave = 'storage:ler') = '0');

-- ------------------------------------------------------------------- 2) usuário aprovado comum volta a ser como antes
SELECT teste.ok('COMUM (restringido nas permissões) volta EXATAMENTE ao de antes em leitura, escrita, storage e RPCs',
  teste.dif_fora_excecao('antes', 'COMUM', 'rollback1', 'COMUM') IS NULL, teste.dif_fora_excecao('antes', 'COMUM', 'rollback1', 'COMUM'));
SELECT teste.ok('NOVO (aprovado depois, padrão sem acesso) fica igual ao COMUM de antes',
  teste.dif_fora_excecao('antes', 'COMUM', 'rollback1', 'NOVO') IS NULL, teste.dif_fora_excecao('antes', 'COMUM', 'rollback1', 'NOVO'));
SELECT teste.ok('COMUM depois do rollback: lê as 5 conversas e as 10 mensagens',
  (SELECT valor FROM teste.mat WHERE etapa = 'rollback1' AND quem = 'COMUM' AND chave = 'ler:whatsapp_contacts') = '5'
  AND (SELECT valor FROM teste.mat WHERE etapa = 'rollback1' AND quem = 'COMUM' AND chave = 'ler:whatsapp_messages') = '10');
SELECT teste.ok('COMUM depois do rollback: grava conversa, mensagem (inclusive UPDATE de mensagem), etapa, IA e mídia',
  (SELECT bool_and(valor LIKE 'ok:%' AND valor <> 'ok:0') FROM teste.mat WHERE etapa = 'rollback1' AND quem = 'COMUM'
     AND chave IN ('inserir:whatsapp_contacts', 'inserir:whatsapp_messages', 'alterar:whatsapp_messages.body',
                   'alterar:whatsapp_contacts.stage', 'alterar:whatsapp_contacts.ai_pausado', 'alterar:whatsapp_contacts.ai_agent_slug',
                   'storage:subir-contato', 'storage:sobrescrever', 'rpc:crm_ai_assumir')));
SELECT teste.ok('COMUM depois do rollback: lê as 4 mídias do bucket whatsapp-media',
  (SELECT valor FROM teste.mat WHERE etapa = 'rollback1' AND quem = 'COMUM' AND chave = 'storage:ler') = '4');

-- ---------------------------------------------------------------------- 3) admin, service_role, anon e pendente
SELECT teste.ok('ADMIN igual ao de antes (sem exceção nenhuma)',
  NOT EXISTS (SELECT 1 FROM teste.dif('antes', 'ADMIN', 'rollback1', 'ADMIN')),
  (SELECT string_agg(chave || ' [' || coalesce(v1,'-') || ' -> ' || coalesce(v2,'-') || ']', '; ') FROM teste.dif('antes', 'ADMIN', 'rollback1', 'ADMIN')));
SELECT teste.ok('service_role igual ao de antes (sem exceção nenhuma)',
  NOT EXISTS (SELECT 1 FROM teste.dif('antes', 'service_role', 'rollback1', 'service_role')),
  (SELECT string_agg(chave || ' [' || coalesce(v1,'-') || ' -> ' || coalesce(v2,'-') || ']', '; ') FROM teste.dif('antes', 'service_role', 'rollback1', 'service_role')));
SELECT teste.ok('anon igual ao de antes (sem exceção nenhuma)',
  NOT EXISTS (SELECT 1 FROM teste.dif('antes', 'anon', 'rollback1', 'anon')),
  (SELECT string_agg(chave || ' [' || coalesce(v1,'-') || ' -> ' || coalesce(v2,'-') || ']', '; ') FROM teste.dif('antes', 'anon', 'rollback1', 'anon')));
SELECT teste.ok('PEND igual ao de antes, fora a auto-aprovação',
  teste.dif_fora_excecao('antes', 'PEND', 'rollback1', 'PEND') IS NULL, teste.dif_fora_excecao('antes', 'PEND', 'rollback1', 'PEND'));
SELECT teste.ok('ADMIN depois do rollback: lê as 5 conversas, grava conversa e aprova o pendente',
  (SELECT valor FROM teste.mat WHERE etapa = 'rollback1' AND quem = 'ADMIN' AND chave = 'ler:whatsapp_contacts') = '5'
  AND (SELECT valor FROM teste.mat WHERE etapa = 'rollback1' AND quem = 'ADMIN' AND chave = 'alterar:whatsapp_contacts.stage') = 'ok:1'
  AND (SELECT valor FROM teste.mat WHERE etapa = 'rollback1' AND quem = 'ADMIN' AND chave = 'profiles:aprovar_pendente') = 'ok:1');
SELECT teste.ok('service_role depois do rollback: lê as 5 conversas e insere mensagem',
  (SELECT valor FROM teste.mat WHERE etapa = 'rollback1' AND quem = 'service_role' AND chave = 'ler:whatsapp_contacts') = '5'
  AND (SELECT valor FROM teste.mat WHERE etapa = 'rollback1' AND quem = 'service_role' AND chave = 'inserir:whatsapp_messages') = 'ok:1');

-- ------------------------------------------------------------------------------ 4) segurança que FICA
SELECT teste.ok('auto-aprovação continua fechada: PEND não grava approved em si (antes conseguia)',
  (SELECT valor FROM teste.mat WHERE etapa = 'antes' AND quem = 'PEND' AND chave = 'profiles:muda_approved_em_si') = 'ok:1'
  AND (SELECT valor FROM teste.mat WHERE etapa = 'rollback1' AND quem = 'PEND' AND chave = 'profiles:muda_approved_em_si') = 'erro:42501'
  AND (SELECT valor FROM teste.mat WHERE etapa = 'antes' AND quem = 'PEND' AND chave = 'profiles:aprovar_pendente') = 'ok:1'
  AND (SELECT valor FROM teste.mat WHERE etapa = 'rollback1' AND quem = 'PEND' AND chave = 'profiles:aprovar_pendente') = 'erro:42501');
SELECT teste.ok('token da Meta continua fora de profiles e guardado em profiles_meta_credenciais',
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'meta_access_token')
  AND (SELECT meta_access_token FROM public.profiles_meta_credenciais WHERE user_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'tok-comum');

-- ------------------------------------------------------------------------------------ 5) catálogo de volta
SELECT teste.ok('nenhuma policy "crm_acesso:" sobrou', NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname LIKE 'crm_acesso:%'));
SELECT teste.ok('policies RESTRICTIVE em public: as mesmas de antes (Comercial:, Somente admin...), nenhuma nova',
  (SELECT array_agg(tablename || '/' || policyname ORDER BY 1) FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE')
  IS NOT DISTINCT FROM (SELECT array_agg(tablename || '/' || policyname ORDER BY 1) FROM teste.f_pol WHERE etapa = 'antes' AND schemaname = 'public' AND permissive = 'RESTRICTIVE'));
WITH antigas AS (SELECT DISTINCT tabela FROM teste.f_col WHERE etapa = 'antes'),
     a AS (SELECT schemaname, tablename, policyname, permissive, roles, cmd, teste.norm(qual) q, teste.norm(with_check) c
             FROM teste.f_pol WHERE etapa = 'antes'),
     b AS (SELECT schemaname, tablename, policyname, permissive, roles, cmd, teste.norm(qual) q, teste.norm(with_check) c
             FROM teste.f_pol WHERE etapa = 'rollback' AND schemaname || '.' || tablename IN (SELECT tabela FROM antigas)),
     d AS ((SELECT 'só antes' lado, * FROM a EXCEPT SELECT 'só antes', * FROM b) UNION ALL (SELECT 'só depois', * FROM b EXCEPT SELECT 'só depois', * FROM a))
SELECT teste.ok('policies das tabelas que já existiam: idênticas às de antes (nome, papel, comando, USING, WITH CHECK)',
  NOT EXISTS (SELECT 1 FROM d), (SELECT string_agg(lado || ': ' || tablename || ' / ' || policyname, '; ') FROM d));
SELECT teste.ok('storage: as 3 policies "Authenticated can ... whatsapp media" com o texto de 20260817202007, e só elas no bucket',
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND (qual LIKE '%whatsapp-media%' OR with_check LIKE '%whatsapp-media%')) = 3
  AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'Authenticated can update whatsapp media'
               AND cmd = 'UPDATE' AND roles = '{authenticated}' AND qual = '(bucket_id = ''whatsapp-media''::text)' AND with_check IS NULL));
SELECT teste.ok('"Service can ..." de whatsapp_contacts/messages de volta a {public}',
  (SELECT count(*) FROM pg_policies WHERE policyname ILIKE 'Service can %whatsapp_%' AND roles = '{public}') = 4);
WITH x AS (SELECT a.f FROM teste.f_fun a JOIN teste.f_fun b ON b.f = a.f AND b.etapa = 'rollback' WHERE a.etapa = 'antes' AND a.def <> b.def)
SELECT teste.ok('funções que já existiam: idênticas às de antes, fora as 2 da 140000 que ficam (identificar_aluna_por_whatsapp, trg_aviso_feedback)',
  (SELECT coalesce(array_agg(f ORDER BY f), '{}') FROM x) = ARRAY['identificar_aluna_por_whatsapp(text)', 'trg_aviso_feedback()'],
  (SELECT string_agg(f, ', ' ORDER BY f) FROM x));
WITH antigas AS (SELECT DISTINCT tabela FROM teste.f_trg WHERE etapa = 'antes'),
     novos AS (SELECT tgname FROM teste.f_trg b WHERE etapa = 'rollback' AND tabela IN (SELECT tabela FROM antigas)
               EXCEPT SELECT tgname FROM teste.f_trg WHERE etapa = 'antes'),
     sumidos AS (SELECT tgname FROM teste.f_trg WHERE etapa = 'antes' EXCEPT SELECT tgname FROM teste.f_trg WHERE etapa = 'rollback')
SELECT teste.ok('gatilhos: ações e nome/closer desligados; ficam só os que preenchem coluna nova + o de aprovação + o do feedback',
  (SELECT array_agg(tgname::text ORDER BY tgname) FROM novos) = ARRAY['trg_crm_acessos_ao_aprovar', 'trg_crm_contato_atendente_guarda',
     'trg_crm_contato_departamento_da_etapa', 'trg_feedback_resolver_aluna', 'trg_profiles_guarda_aprovacao']
  AND NOT EXISTS (SELECT 1 FROM sumidos),
  (SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM novos));
SELECT teste.ok('colunas: só profiles.meta_access_token saiu (segurança); nenhuma outra',
  (SELECT array_agg(tabela || '.' || coluna) FROM (SELECT tabela, coluna FROM teste.f_col WHERE etapa = 'antes'
     EXCEPT SELECT tabela, coluna FROM teste.f_col WHERE etapa = 'rollback') z) = ARRAY['public.profiles.meta_access_token']);

-- ------------------------------------------------------------------------- 6) dado novo intacto, idempotência
SELECT teste.ok('dado novo intacto (acessos, departamentos, atendente_id, departamento_id, credenciais, contatos, mensagens)',
  (SELECT row((SELECT count(*) FROM public.crm_acessos), (SELECT count(*) FROM public.crm_departamentos),
              (SELECT count(*) FROM public.whatsapp_contacts WHERE atendente_id IS NOT NULL),
              (SELECT count(*) FROM public.whatsapp_contacts WHERE departamento_id IS NOT NULL),
              (SELECT count(*) FROM public.profiles_meta_credenciais),
              (SELECT count(*) FROM public.whatsapp_contacts), (SELECT count(*) FROM public.whatsapp_messages))::text)
  = (SELECT row(acessos, deps, com_atendente, com_dep, meta_cred, contatos, msgs)::text FROM teste.dado_novo),
  (SELECT row(acessos, deps, com_atendente, com_dep, meta_cred, contatos, msgs)::text FROM teste.dado_novo));
SELECT teste.ok('rollback rodado 3x: matriz da 3ª vez idêntica à da 1ª, para todas as identidades',
  NOT EXISTS (SELECT 1 FROM (VALUES ('ADMIN'), ('COMUM'), ('PEND'), ('NOVO'), ('anon'), ('service_role')) q(quem),
              LATERAL teste.dif('rollback1', q.quem, 'rollback3', q.quem)));

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || nome || CASE WHEN NOT ok AND detalhe IS NOT NULL THEN '  -> ' || detalhe ELSE '' END
  FROM teste.res ORDER BY n;
SELECT 'RESULTADO: ' || count(*) FILTER (WHERE ok) || ' ok, ' || count(*) FILTER (WHERE NOT ok) || ' falha(s)' FROM teste.res;
