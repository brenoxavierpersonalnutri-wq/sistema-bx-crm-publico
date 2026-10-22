\set ON_ERROR_STOP on
SET client_min_messages = warning;
CREATE FUNCTION pg_temp.ok(cond boolean, nome text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', nome; END IF;
  RAISE NOTICE 'ok  %', nome;
END $$;
SET client_min_messages = notice;

-- seeds
SELECT pg_temp.ok((SELECT count(*) FROM crm_wa_templates) = 10, '10 templates no catálogo');
SELECT pg_temp.ok((SELECT count(*) FROM crm_wa_templates WHERE status = 'APPROVED') = 10, 'todos aprovados');
SELECT pg_temp.ok((SELECT botoes->0->>'text' FROM crm_wa_templates WHERE nome = 'qualificadoavaliacao') = 'Iniciar avaliação', 'botão do qualificadoavaliacao');
SELECT pg_temp.ok((SELECT count(*) FROM crm_fluxos) = 5, '5 fluxos espelho');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM crm_fluxos WHERE ativo), 'todos desligados');
SELECT pg_temp.ok((SELECT passos->2->>'template' FROM crm_fluxos WHERE origem_ff_workflow_id = '621465f1-a79b-41a0-9c94-54553b23ae3c') = 'qualificadoavaliacao', 'leads qualificados manda o template');

-- rodar de novo não sobrescreve edição
UPDATE crm_fluxos SET nome = 'editado' WHERE origem_ff_workflow_id = '2cde495b-5650-4d0d-af57-121a605c2cf6';
SET client_min_messages = warning;
\i :mig
SET client_min_messages = notice;
SELECT pg_temp.ok((SELECT nome FROM crm_fluxos WHERE origem_ff_workflow_id = '2cde495b-5650-4d0d-af57-121a605c2cf6') = 'editado', 'rodar 3a vez não sobrescreve edição');
SELECT pg_temp.ok((SELECT count(*) FROM crm_fluxos) = 5, 'continua com 5 fluxos');

-- eventos
SELECT pg_temp.ok(crm_registrar_evento('(31) 99999-8888', 'Lead Qualificado', 'Maria', '{"email":"x@y.z"}') > 0, 'registra evento');
SELECT pg_temp.ok((SELECT valor FROM crm_contato_eventos WHERE tipo = 'evento' ORDER BY id DESC LIMIT 1) = 'lead_qualificado', 'evento normalizado');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM whatsapp_contacts WHERE phone = '5531999998888' AND name = 'Maria' AND source = 'evento'), 'contato criado com 55');
SELECT crm_registrar_evento('5531999998888', 'outro', 'Outro Nome');
SELECT pg_temp.ok((SELECT name FROM whatsapp_contacts WHERE phone = '5531999998888') = 'Maria', 'não troca nome existente');
DO $$ BEGIN
  PERFORM crm_registrar_evento('123', 'x');
  RAISE EXCEPTION 'FALHOU: aceitou telefone curto';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
  RAISE NOTICE 'ok  recusa telefone inválido';
END $$;
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'crm_registrar_evento(text,text,text,jsonb)', 'EXECUTE'), 'authenticated não chama crm_registrar_evento');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'crm_registrar_evento(text,text,text,jsonb)', 'EXECUTE'), 'anon não chama crm_registrar_evento');

-- ligado_em
UPDATE crm_fluxos SET ativo = true WHERE origem_ff_workflow_id = '621465f1-a79b-41a0-9c94-54553b23ae3c';
SELECT pg_temp.ok((SELECT ligado_em IS NOT NULL FROM crm_fluxos WHERE origem_ff_workflow_id = '621465f1-a79b-41a0-9c94-54553b23ae3c'), 'ligar carimba ligado_em');

-- execução única ativa
INSERT INTO crm_fluxo_execucoes (fluxo_id, contact_phone) SELECT id, '5531999998888' FROM crm_fluxos WHERE origem_ff_workflow_id = '621465f1-a79b-41a0-9c94-54553b23ae3c';
DO $$ BEGIN
  INSERT INTO crm_fluxo_execucoes (fluxo_id, contact_phone) SELECT id, '5531999998888' FROM crm_fluxos WHERE origem_ff_workflow_id = '621465f1-a79b-41a0-9c94-54553b23ae3c';
  RAISE EXCEPTION 'FALHOU: duas execuções ativas';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok  uma execução ativa por contato';
END $$;

-- fila aceita fluxo e barra passo duplicado
INSERT INTO crm_automacao_fila (origem, fluxo_id, fluxo_execucao_id, passo_idx, contact_phone, acoes)
SELECT 'fluxo', fluxo_id, id, 2, contact_phone, '[{"tipo":"template_oficial","template":"qualificadoavaliacao"}]' FROM crm_fluxo_execucoes LIMIT 1;
DO $$ BEGIN
  INSERT INTO crm_automacao_fila (origem, fluxo_id, fluxo_execucao_id, passo_idx, contact_phone, acoes)
  SELECT 'fluxo', fluxo_id, id, 2, contact_phone, '[]' FROM crm_fluxo_execucoes LIMIT 1;
  RAISE EXCEPTION 'FALHOU: passo duplicado na fila';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok  passo de execução entra na fila uma vez';
END $$;

-- tick acorda com fluxo ligado
INSERT INTO integracao_config (chave, valor) VALUES ('crm_automacoes_fn_url', 'https://exemplo.supabase.co/functions/v1/crm-automacoes')
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;
DELETE FROM crm_automacao_fila;
SELECT pg_temp.ok(crm_automacoes_tick() = 'chamado', 'tick chama com fluxo ligado');
UPDATE crm_fluxos SET ativo = false;
UPDATE crm_fluxo_execucoes SET status = 'cancelado';
SELECT pg_temp.ok(crm_automacoes_tick() = 'nada a fazer', 'tick fica quieto sem fluxo/execução');
SELECT pg_temp.ok((SELECT ligado_em IS NULL FROM crm_fluxos WHERE origem_ff_workflow_id = '621465f1-a79b-41a0-9c94-54553b23ae3c'), 'desligar limpa ligado_em');

-- crm_numeros chega depois: rodar de novo liga FK e aponta espelhos/catálogo para o oficial (31) 7000-0102
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM crm_fluxos WHERE numero_id IS NOT NULL), 'sem crm_numeros: numero_id vazio');
CREATE TABLE public.crm_numeros (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), apelido text, telefone text, tipo text);
INSERT INTO crm_numeros (apelido, telefone, tipo) VALUES ('openwa', '5531999990000', 'openwa'), ('Oficial', '553170000102', 'oficial');
SET client_min_messages = warning;
\i :mig2
SET client_min_messages = notice;
SELECT pg_temp.ok((SELECT count(*) FROM crm_fluxos f JOIN crm_numeros n ON n.id = f.numero_id WHERE n.tipo = 'oficial') = 5, 'follow-up 20261024110000 aponta os espelhos para o oficial');
UPDATE crm_fluxos SET numero_id = NULL; UPDATE crm_wa_templates SET numero_id = NULL;
SET client_min_messages = warning;
\i :mig
SET client_min_messages = notice;
SELECT pg_temp.ok((SELECT count(*) FROM crm_fluxos f JOIN crm_numeros n ON n.id = f.numero_id WHERE n.tipo = 'oficial') = 5, '5 espelhos no número oficial');
SELECT pg_temp.ok((SELECT count(*) FROM crm_wa_templates t JOIN crm_numeros n ON n.id = t.numero_id WHERE n.tipo = 'oficial') = 10, 'catálogo no número oficial');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_fluxos_numero_id_fkey'), 'FK de crm_fluxos.numero_id');
SET client_min_messages = warning;
\i :mig
SET client_min_messages = notice;
SELECT pg_temp.ok(true, 'rodar com FK já criada continua idempotente');
