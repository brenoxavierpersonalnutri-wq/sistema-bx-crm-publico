-- Checagens das seções OPCIONAIS 2, 3 e 4 do rollback (rodadas 2x cada por rollback.sh, depois da seção 1).
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
TRUNCATE teste.res;

-- seção 2: auto-aprovação e meta_access_token de volta (furos reabertos, como documentado)
SELECT teste.ok('seção 2: gatilho de aprovação saiu', NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_profiles_guarda_aprovacao'));
SELECT teste.ok('seção 2: profiles.meta_access_token voltou com o token copiado de profiles_meta_credenciais',
  (SELECT meta_access_token FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'tok-comum');
SELECT teste.ok('seção 2: profiles_meta_credenciais continua (nada apagado)',
  (SELECT count(*) FROM public.profiles_meta_credenciais) = (SELECT meta_cred FROM teste.dado_novo));
SELECT teste.ok('seções 1+2+3+4: COMUM idêntico ao de antes em TUDO, inclusive approved',
  NOT EXISTS (SELECT 1 FROM teste.dif('antes', 'COMUM', 'secoes', 'COMUM')),
  (SELECT string_agg(chave || ' [' || coalesce(v1,'-') || ' -> ' || coalesce(v2,'-') || ']', '; ') FROM teste.dif('antes', 'COMUM', 'secoes', 'COMUM')));
SELECT teste.ok('seções 1+2+3+4: PEND idêntico ao de antes em TUDO',
  NOT EXISTS (SELECT 1 FROM teste.dif('antes', 'PEND', 'secoes', 'PEND')),
  (SELECT string_agg(chave || ' [' || coalesce(v1,'-') || ' -> ' || coalesce(v2,'-') || ']', '; ') FROM teste.dif('antes', 'PEND', 'secoes', 'PEND')));

-- seção 3: tela e edges com acesso total para aprovado
SELECT teste.como('bbbbbbbb-0000-0000-0000-000000000001', 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('seção 3: crm_meu_acesso do COMUM (restringido em crm_acessos) = todas as áreas em editar, todos os números',
  (SELECT (a->>'todos_numeros')::boolean AND NOT (a->>'so_minhas')::boolean AND NOT (a->>'so_departamentos')::boolean
          AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(a->'areas') e WHERE e.value <> 'editar')
          AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(a->'acoes') e WHERE e.value <> 'true')
     FROM (SELECT public.crm_meu_acesso() a) x));
SELECT teste.ok('seção 3: edge (crm_acesso_conferir) deixa o COMUM responder no suporte; crm_acao_minha liberada',
  public.crm_acesso_conferir('conversa', 2, (SELECT id FROM public.crm_numeros WHERE chave = 'suporte-consultoria-1'), '5511900000006')
  AND public.crm_acao_minha('conversas.transferir'));
RESET ROLE;
SELECT teste.como('bbbbbbbb-0000-0000-0000-000000000002', 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('seção 3: pendente continua sem acesso na edge',
  NOT public.crm_acesso_conferir('conversa', 2, (SELECT id FROM public.crm_numeros WHERE chave = 'suporte-consultoria-1'), '5511900000006'));
RESET ROLE;
SELECT teste.ok('seção 3: crm_acessos do COMUM intacto (a restrição continua gravada, só não vale)',
  (SELECT so_minhas AND NOT todos_numeros FROM public.crm_acessos WHERE user_id = 'bbbbbbbb-0000-0000-0000-000000000001'));
SELECT teste.ok('seção 3: gatilhos de preenchimento de atendente/departamento saíram',
  NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_crm_contato_atendente_guarda', 'trg_crm_contato_departamento_da_etapa')));

-- seção 4: telas públicas
SELECT teste.ok('seção 4: identificar_aluna_por_whatsapp idêntica à de antes',
  pg_get_functiondef('public.identificar_aluna_por_whatsapp(text)'::regprocedure)
  = (SELECT def FROM teste.f_fun WHERE etapa = 'antes' AND f = 'identificar_aluna_por_whatsapp(text)'));
SELECT teste.ok('seção 4: gatilho do feedback público saiu', NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_feedback_resolver_aluna'));

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || nome || CASE WHEN NOT ok AND detalhe IS NOT NULL THEN '  -> ' || detalhe ELSE '' END
  FROM teste.res ORDER BY n;
SELECT 'RESULTADO (seções opcionais): ' || count(*) FILTER (WHERE ok) || ' ok, ' || count(*) FILTER (WHERE NOT ok) || ' falha(s)' FROM teste.res;
