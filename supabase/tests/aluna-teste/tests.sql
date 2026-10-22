\set ON_ERROR_STOP on
SET client_min_messages = warning;
CREATE FUNCTION pg_temp.ok(cond boolean, nome text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', nome; END IF;
  RAISE NOTICE 'ok  %', nome;
END $$;
-- Roda o SQL e devolve o SQLSTATE do erro (ou 'sem erro').
CREATE FUNCTION pg_temp.erro(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN 'sem erro';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;
-- Troca o "usuário logado" (o sub do JWT que auth.uid() lê).
CREATE FUNCTION pg_temp.logar(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(_uid, ''), false)
$$;
SET client_min_messages = notice;

-- Pessoas ---------------------------------------------------------------------
--   a1 admin aprovado · g1 aprovado com módulo "alunas" · s1 aprovado sem módulo
--   n1 não aprovado com módulo
INSERT INTO public.profiles (id, approved) VALUES
  ('a1000000-0000-0000-0000-000000000001', true),
  ('91000000-0000-0000-0000-000000000001', true),
  ('51000000-0000-0000-0000-000000000001', true),
  ('11000000-0000-0000-0000-000000000001', false);
INSERT INTO public.user_roles (user_id, role) VALUES ('a1000000-0000-0000-0000-000000000001', 'admin');
INSERT INTO public.user_modules (user_id, module) VALUES
  ('91000000-0000-0000-0000-000000000001', 'alunas'),
  ('11000000-0000-0000-0000-000000000001', 'alunas');

-- Uma aluna REAL com coisas geradas (deve sobreviver a tudo).
INSERT INTO public.alunas (id, user_id, nome_completo, programa, data_compra, duracao_plano, data_vencimento, forma_pagamento, pago, telefone)
VALUES ('eeee0000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Maria Real',
        'menos_gordura', current_date, '3', current_date + 90, 'pix', true, '(31) 99000-0107');
INSERT INTO public.anamnese_respostas (aluna_id, status) VALUES ('eeee0000-0000-0000-0000-000000000001', 'respondida');
INSERT INTO public.feedback_semanal_responses (nome, telefone, produto, aluna_id)
VALUES ('Maria Real', '31990000107', 'mgmd', 'eeee0000-0000-0000-0000-000000000001');
INSERT INTO public.collaborator_tasks (user_id, title, due_date, type, metadata)
VALUES ('a1000000-0000-0000-0000-000000000001', 'Reavaliação: Maria Real', now(), 'reavaliacao',
        jsonb_build_object('alunaId', 'eeee0000-0000-0000-0000-000000000001'));

-- 1. A coluna nasce false para quem já existe ---------------------------------
SELECT pg_temp.ok((SELECT is_teste FROM public.alunas WHERE id = 'eeee0000-0000-0000-0000-000000000001') = false,
                  'aluna real: is_teste = false');
SELECT pg_temp.ok((SELECT count(*) FROM public._policies_antes) =
                  (SELECT count(*) FROM pg_policies WHERE schemaname='public')
                  AND NOT EXISTS (
                    SELECT tablename, policyname, cmd, roles::text, qual, with_check FROM pg_policies WHERE schemaname='public'
                    EXCEPT SELECT * FROM public._policies_antes),
                  'nenhuma policy criada ou alterada');

-- 2. Quem pode criar ----------------------------------------------------------
SET ROLE anon;
SELECT pg_temp.ok(pg_temp.erro('SELECT public.criar_aluna_teste()') = '42501', 'anon não executa criar_aluna_teste');
SELECT pg_temp.ok(pg_temp.erro($q$SELECT public.apagar_aluna_teste('eeee0000-0000-0000-0000-000000000001')$q$) = '42501',
                  'anon não executa apagar_aluna_teste');
RESET ROLE;

SET ROLE authenticated;
SELECT pg_temp.logar('51000000-0000-0000-0000-000000000001');
SELECT pg_temp.ok(pg_temp.erro('SELECT public.criar_aluna_teste()') = '42501', 'aprovado sem módulo alunas: recusado');
SELECT pg_temp.logar('11000000-0000-0000-0000-000000000001');
SELECT pg_temp.ok(pg_temp.erro('SELECT public.criar_aluna_teste()') = '42501', 'não aprovado: recusado');
SELECT pg_temp.logar(NULL);
SELECT pg_temp.ok(pg_temp.erro('SELECT public.criar_aluna_teste()') = '42501', 'sem login: recusado');

-- 3. Criar (gestora com módulo) -----------------------------------------------
SELECT pg_temp.logar('91000000-0000-0000-0000-000000000001');
CREATE TEMP TABLE t_criadas (r jsonb);
INSERT INTO t_criadas SELECT public.criar_aluna_teste();
INSERT INTO t_criadas SELECT public.criar_aluna_teste();   -- mesma pessoa, mesmo minuto
SELECT pg_temp.logar('a1000000-0000-0000-0000-000000000001');
INSERT INTO t_criadas SELECT public.criar_aluna_teste();   -- admin também pode
RESET ROLE;

SELECT pg_temp.ok((SELECT count(*) FROM public.alunas WHERE is_teste) = 3, 'três alunas de teste criadas');
SELECT pg_temp.ok(bool_and(a.nome_completo LIKE 'TESTE – Treinamento __/__/____ __:__%'), 'nome "TESTE – Treinamento dd/mm/aaaa hh:mm"')
FROM public.alunas a WHERE a.is_teste;
SELECT pg_temp.ok((SELECT count(DISTINCT nome_completo) FROM public.alunas WHERE is_teste
                   AND user_id = '91000000-0000-0000-0000-000000000001') = 2,
                  'duas no mesmo minuto: nomes diferentes (sufixo (2))');
SELECT pg_temp.ok(bool_and(a.telefone ~ '^\(00\) 90000-\d{4}$'), 'telefone (00) 90000-NNNN')
FROM public.alunas a WHERE a.is_teste;
SELECT pg_temp.ok((SELECT count(DISTINCT telefone) FROM public.alunas WHERE is_teste) = 3, 'telefones de teste distintos');
SELECT pg_temp.ok(bool_and(a.programa = 'menos_gordura' AND a.status = 'ativa' AND a.pago AND a.duracao_plano = '3'
                           AND a.data_vencimento = a.data_compra + interval '3 months'),
                  'plano e status de aluna ativa (MGMD trimestral, paga, ativa)')
FROM public.alunas a WHERE a.is_teste;
SELECT pg_temp.ok((SELECT user_id FROM public.alunas a JOIN t_criadas c ON a.id = (c.r->>'id')::uuid LIMIT 1)
                  = '91000000-0000-0000-0000-000000000001', 'responsável = quem criou');

-- O telefone de teste não casa com aluna real, e casa com a própria.
SELECT pg_temp.ok((SELECT id FROM public.identificar_aluna_por_whatsapp(a.telefone)) = a.id,
                  'identificar_aluna_por_whatsapp(telefone de teste) acha a aluna de teste')
FROM public.alunas a WHERE a.is_teste LIMIT 1;
SELECT pg_temp.ok((SELECT id FROM public.identificar_aluna_por_whatsapp('31990000107')) = 'eeee0000-0000-0000-0000-000000000001',
                  'aluna real continua sendo achada pelo telefone dela');

-- 4. Trava da marca -----------------------------------------------------------
SET ROLE authenticated;
SELECT pg_temp.logar('a1000000-0000-0000-0000-000000000001');
SELECT pg_temp.ok(pg_temp.erro($q$INSERT INTO public.alunas (user_id, nome_completo, programa, data_compra, duracao_plano, data_vencimento, forma_pagamento, is_teste)
  VALUES ('a1000000-0000-0000-0000-000000000001', 'Falsa Teste', 'elite', current_date, '1', current_date, 'pix', true)$q$) = '42501',
  'INSERT direto com is_teste = true: recusado (só pela função)');
SELECT pg_temp.ok(pg_temp.erro($q$UPDATE public.alunas SET is_teste = true WHERE id = 'eeee0000-0000-0000-0000-000000000001'$q$) = '42501',
  'aluna real não vira de teste (UPDATE recusado)');
SELECT pg_temp.ok(pg_temp.erro($q$UPDATE public.alunas SET is_teste = false WHERE is_teste$q$) = '42501',
  'aluna de teste não vira real (UPDATE recusado)');
-- O salvar da tela (upsert sem is_teste) mantém a marca.
SELECT pg_temp.ok(pg_temp.erro(format($q$INSERT INTO public.alunas (id, user_id, nome_completo, programa, data_compra, duracao_plano, data_vencimento, forma_pagamento, pago, anamnese_mfit)
  SELECT id, user_id, nome_completo, programa, data_compra, duracao_plano, data_vencimento, forma_pagamento, pago, true FROM public.alunas WHERE id = %L
  ON CONFLICT (id) DO UPDATE SET anamnese_mfit = EXCLUDED.anamnese_mfit, nome_completo = EXCLUDED.nome_completo$q$,
  (SELECT (r->>'id') FROM t_criadas LIMIT 1))) = 'sem erro', 'upsert da tela numa aluna de teste: passa');
RESET ROLE;
SELECT pg_temp.ok((SELECT is_teste AND anamnese_mfit FROM public.alunas WHERE id = (SELECT (r->>'id')::uuid FROM t_criadas LIMIT 1)),
                  'depois do upsert: continua is_teste e salvou o campo');

-- 5. Gera coisas para a aluna de teste (como o time faria no treino) ----------
CREATE TEMP TABLE t_alvo AS
SELECT (r->>'id')::uuid AS id, r->>'telefone' AS tel FROM t_criadas LIMIT 1;
CREATE TEMP TABLE t_outra AS
SELECT (r->>'id')::uuid AS id FROM t_criadas OFFSET 1 LIMIT 1;
GRANT SELECT ON t_criadas, t_alvo, t_outra TO authenticated;

-- anamnese gerada e respondida pelo link público (funções reais)
INSERT INTO public.anamnese_respostas (aluna_id) SELECT id FROM t_alvo;
INSERT INTO public.anamnese_respostas (aluna_id, status) SELECT id, 'respondida' FROM t_alvo;
-- feedback com aluna_id, e um que chegou só com o telefone (outro formato)
INSERT INTO public.feedback_semanal_responses (nome, telefone, produto, aluna_id)
SELECT 'TESTE', tel, 'mgmd', id FROM t_alvo;
INSERT INTO public.feedback_semanal_responses (nome, telefone, produto)
SELECT 'TESTE sem id', '55' || regexp_replace(tel, '\D', '', 'g'), 'mgmd' FROM t_alvo;
-- agenda: liberação/reavaliação da tela e um aviso solto apontando pro feedback
INSERT INTO public.collaborator_tasks (user_id, title, due_date, type, metadata)
SELECT '91000000-0000-0000-0000-000000000001', 'Reavaliação: TESTE', now(), 'reavaliacao', jsonb_build_object('alunaId', id::text) FROM t_alvo;
INSERT INTO public.collaborator_tasks (user_id, title, due_date, type, metadata)
SELECT '91000000-0000-0000-0000-000000000001', 'Liberação: TESTE', now(), 'liberacao', jsonb_build_object('alunaId', id::text) FROM t_alvo;
INSERT INTO public.collaborator_tasks (user_id, title, due_date, type, metadata)
SELECT '91000000-0000-0000-0000-000000000001', 'Feedback enviado: TESTE', now(), 'manual',
       jsonb_build_object('origemId', f.id::text) FROM public.feedback_semanal_responses f WHERE f.nome = 'TESTE sem id';
-- app da aluna (tabela com ON DELETE CASCADE)
INSERT INTO public.aluna_planos (aluna_id, nome, data_inicio) SELECT id, 'Plano teste', current_date FROM t_alvo;
-- coisa da OUTRA aluna de teste: não pode sumir junto
INSERT INTO public.collaborator_tasks (user_id, title, due_date, type, metadata)
SELECT '91000000-0000-0000-0000-000000000001', 'Reavaliação: outra', now(), 'reavaliacao', jsonb_build_object('alunaId', id::text) FROM t_outra;

-- 6. Apagar ALUNA REAL: recusado, nada some -----------------------------------
SET ROLE authenticated;
SELECT pg_temp.logar('a1000000-0000-0000-0000-000000000001');
SELECT pg_temp.ok(pg_temp.erro($q$SELECT public.apagar_aluna_teste('eeee0000-0000-0000-0000-000000000001')$q$) = '42501',
                  'apagar aluna REAL (admin): recusado 42501');
SELECT pg_temp.ok(pg_temp.erro($q$SELECT public.apagar_aluna_teste('00000000-0000-0000-0000-00000000dead')$q$) = 'P0002',
                  'apagar id inexistente: P0002');
SELECT pg_temp.logar('51000000-0000-0000-0000-000000000001');
SELECT pg_temp.ok(pg_temp.erro(format('SELECT public.apagar_aluna_teste(%L)', (SELECT id FROM t_alvo))) = '42501',
                  'apagar de teste sem módulo alunas: recusado');
RESET ROLE;
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.alunas WHERE id = 'eeee0000-0000-0000-0000-000000000001')
              AND (SELECT count(*) FROM public.anamnese_respostas WHERE aluna_id = 'eeee0000-0000-0000-0000-000000000001') = 1
              AND (SELECT count(*) FROM public.feedback_semanal_responses WHERE aluna_id = 'eeee0000-0000-0000-0000-000000000001') = 1
              AND (SELECT count(*) FROM public.collaborator_tasks WHERE metadata->>'alunaId' = 'eeee0000-0000-0000-0000-000000000001') >= 1,
                  'depois das recusas: aluna real, anamnese, feedback e agenda dela intactos');
SELECT pg_temp.ok((SELECT count(*) FROM public.alunas WHERE is_teste) = 3, 'depois das recusas: as 3 de teste continuam');

-- 7. Apagar a aluna de teste (gestora) ----------------------------------------
CREATE TEMP TABLE t_antes AS
SELECT (SELECT count(*) FROM public.collaborator_tasks) AS tarefas,
       (SELECT count(*) FROM public.feedback_semanal_responses) AS feedbacks,
       (SELECT count(*) FROM public.anamnese_respostas) AS anamneses,
       -- as tarefas DELA: as 3 que o teste pôs + os avisos que o gatilho do aviso
       -- (se aplicado) criou para a anamnese respondida e os 2 feedbacks
       (SELECT count(*) FROM public.collaborator_tasks t
         WHERE t.metadata->>'alunaId' = (SELECT id::text FROM t_alvo)
            OR t.metadata->>'origemId' IN (
                 SELECT f.id::text FROM public.feedback_semanal_responses f WHERE f.nome LIKE 'TESTE%'
                 UNION ALL
                 SELECT r.id::text FROM public.anamnese_respostas r WHERE r.aluna_id = (SELECT id FROM t_alvo))) AS tarefas_dela;
GRANT SELECT ON t_antes TO authenticated;
SET ROLE authenticated;
SELECT pg_temp.logar('91000000-0000-0000-0000-000000000001');
CREATE TEMP TABLE t_res AS SELECT public.apagar_aluna_teste((SELECT id FROM t_alvo)) AS r;
RESET ROLE;
SELECT pg_temp.ok((SELECT r FROM t_res) @> '{"aluna":1}', 'apagar: devolveu aluna = 1  ' || (SELECT r::text FROM t_res));
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.alunas WHERE id = (SELECT id FROM t_alvo)), 'aluna de teste apagada');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.anamnese_respostas WHERE aluna_id = (SELECT id FROM t_alvo)), 'anamneses dela apagadas');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.feedback_semanal_responses WHERE aluna_id = (SELECT id FROM t_alvo) OR nome LIKE 'TESTE%'),
                  'feedbacks dela apagados (com aluna_id e só pelo telefone de teste)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.collaborator_tasks WHERE title LIKE '%: TESTE'),
                  'agenda dela apagada (liberação, reavaliação, aviso pelo origemId)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.aluna_planos WHERE aluna_id = (SELECT id FROM t_alvo)), 'app (aluna_planos) apagado em cascata');
SELECT pg_temp.ok((SELECT tarefas_dela FROM t_antes) >= 3
              AND (SELECT tarefas FROM t_antes) - (SELECT count(*) FROM public.collaborator_tasks) = (SELECT tarefas_dela FROM t_antes)
              AND (SELECT feedbacks FROM t_antes) - (SELECT count(*) FROM public.feedback_semanal_responses) = 2
              AND (SELECT anamneses FROM t_antes) - (SELECT count(*) FROM public.anamnese_respostas) = 2,
                  'apagou exatamente as tarefas dela (' || (SELECT tarefas_dela FROM t_antes) || '), 2 feedbacks, 2 anamneses (nada além)');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.collaborator_tasks WHERE title = 'Reavaliação: outra')
              AND EXISTS (SELECT 1 FROM public.alunas WHERE id = (SELECT id FROM t_outra)),
                  'a outra aluna de teste e a agenda dela continuam');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.alunas WHERE id = 'eeee0000-0000-0000-0000-000000000001')
              AND (SELECT count(*) FROM public.feedback_semanal_responses WHERE aluna_id = 'eeee0000-0000-0000-0000-000000000001') = 1
              AND (SELECT count(*) FROM public.anamnese_respostas WHERE aluna_id = 'eeee0000-0000-0000-0000-000000000001') = 1,
                  'aluna real intacta depois do apagar');

-- 8. Com o gatilho do aviso na agenda (se aplicado): o aviso também some -------
\if :tem_aviso
INSERT INTO public.anamnese_respostas (aluna_id, status) SELECT id, 'respondida' FROM t_outra;
INSERT INTO public.feedback_semanal_responses (nome, telefone, produto)
SELECT 'TESTE via whatsapp', telefone, 'mgmd' FROM public.alunas WHERE id = (SELECT id FROM t_outra);
SELECT pg_temp.ok((SELECT count(*) FROM public.collaborator_tasks WHERE type = 'aviso' AND metadata->>'alunaId' = (SELECT id::text FROM t_outra)) = 2,
                  'aviso: anamnese e feedback da aluna de teste geraram 2 avisos na agenda');
SET ROLE authenticated;
SELECT pg_temp.logar('a1000000-0000-0000-0000-000000000001');
SELECT public.apagar_aluna_teste((SELECT id FROM t_outra));
RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.collaborator_tasks WHERE metadata->>'alunaId' = (SELECT id::text FROM t_outra)),
                  'aviso: apagar a aluna de teste levou os avisos dela');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.feedback_semanal_responses WHERE nome = 'TESTE via whatsapp'),
                  'aviso: feedback que veio pelo WhatsApp (sem aluna_id) apagado');
\endif
