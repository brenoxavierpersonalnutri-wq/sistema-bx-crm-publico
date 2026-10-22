\set ON_ERROR_STOP on
SET client_min_messages = warning;
CREATE FUNCTION pg_temp.ok(cond boolean, nome text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', nome; END IF;
  RAISE NOTICE 'ok  %', nome;
END $$;
SET client_min_messages = notice;
BEGIN; -- tudo dentro de transação desfeita no fim: o script roda 2x no mesmo banco

-- seed
SELECT pg_temp.ok((SELECT count(*) FROM crm_numeros) = 5, '5 números no seed (idempotente)');
SELECT pg_temp.ok((SELECT count(*) FROM crm_numeros WHERE tipo = 'openwa') = 4, '4 sessões do OpenWA');
SELECT pg_temp.ok((SELECT telefone FROM crm_numeros WHERE tipo = 'oficial') = '553170000102', 'oficial (31) 7000-0102');
SELECT pg_temp.ok((SELECT string_agg(sessao_openwa, ',' ORDER BY ordem) FROM crm_numeros WHERE tipo = 'openwa')
  = 'closer,comercial-fit-2,suporte-consultoria-1,comercial-implementacao-1', 'sessões na ordem');
SELECT pg_temp.ok((SELECT numero_id FROM crm_envio_config WHERE numero = 'principal') = (SELECT id FROM crm_numeros WHERE chave = 'closer'),
  'config principal aponta para o closer');

-- colunas e FKs
SELECT pg_temp.ok((SELECT count(*) FROM pg_constraint WHERE conname IN (
  'crm_automacoes_numero_id_fkey', 'crm_campanhas_numero_id_fkey', 'crm_automacao_fila_numero_id_fkey',
  'crm_automacao_log_numero_id_fkey', 'crm_envio_config_numero_id_fkey')) = 5, 'FK numero_id nas 5 tabelas da main');

-- restrições
DO $$ BEGIN
  INSERT INTO crm_numeros (chave, apelido, tipo) VALUES ('sem-sessao', 'x', 'openwa');
  RAISE EXCEPTION 'FALHOU: openwa sem sessão aceito';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  openwa exige sessão';
END $$;
DO $$ BEGIN
  INSERT INTO crm_numeros (chave, apelido, tipo, sessao_openwa) VALUES ('ofi2', 'x', 'oficial', 'abc');
  RAISE EXCEPTION 'FALHOU: oficial com sessão aceito';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  oficial não tem sessão';
END $$;
DO $$ BEGIN
  INSERT INTO crm_numeros (chave, apelido, tipo, sessao_openwa) VALUES ('dup', 'x', 'openwa', 'closer');
  RAISE EXCEPTION 'FALHOU: sessão duplicada aceita';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok  sessão única';
END $$;
DO $$ BEGIN
  UPDATE crm_numeros SET hora_inicio = 20, hora_fim = 8 WHERE chave = 'closer';
  RAISE EXCEPTION 'FALHOU: janela invertida aceita';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  janela invertida recusada';
END $$;

-- herança do número: automação -> fila -> log
INSERT INTO crm_automacoes (id, nome, gatilho_tipo, gatilho_valor, numero_id)
  VALUES ('00000000-0000-0000-0000-0000000000a1', 'a', 'tag', 'x', (SELECT id FROM crm_numeros WHERE chave = 'comercial-fit-2'));
INSERT INTO crm_automacao_fila (origem, automacao_id, contact_phone, acoes)
  VALUES ('automacao', '00000000-0000-0000-0000-0000000000a1', '5531999990001', '[]');
SELECT pg_temp.ok((SELECT numero_id FROM crm_automacao_fila WHERE contact_phone = '5531999990001')
  = (SELECT id FROM crm_numeros WHERE chave = 'comercial-fit-2'), 'fila herda número da automação');
INSERT INTO crm_automacao_log (fila_id, contact_phone, canal, tipo, status)
  SELECT id, contact_phone, 'whatsapp', 'text', 'ok' FROM crm_automacao_fila WHERE contact_phone = '5531999990001';
SELECT pg_temp.ok((SELECT numero_id FROM crm_automacao_log WHERE contact_phone = '5531999990001')
  = (SELECT id FROM crm_numeros WHERE chave = 'comercial-fit-2'), 'log herda número do item');

-- campanha -> fila; número explícito no item vence
INSERT INTO crm_campanhas (id, nome, numero_id) VALUES ('00000000-0000-0000-0000-0000000000c1', 'c', (SELECT id FROM crm_numeros WHERE chave = 'suporte-consultoria-1'));
INSERT INTO crm_automacao_fila (origem, campanha_id, contact_phone, acoes)
  VALUES ('campanha', '00000000-0000-0000-0000-0000000000c1', '5531999990002', '[]');
SELECT pg_temp.ok((SELECT numero_id FROM crm_automacao_fila WHERE contact_phone = '5531999990002')
  = (SELECT id FROM crm_numeros WHERE chave = 'suporte-consultoria-1'), 'fila herda número da campanha');
INSERT INTO crm_automacao_fila (origem, campanha_id, contact_phone, acoes, numero_id)
  VALUES ('campanha', '00000000-0000-0000-0000-0000000000c1', '5531999990003', '[]', (SELECT id FROM crm_numeros WHERE chave = 'closer'));
SELECT pg_temp.ok((SELECT numero_id FROM crm_automacao_fila WHERE contact_phone = '5531999990003')
  = (SELECT id FROM crm_numeros WHERE chave = 'closer'), 'número explícito no item vence a herança');

-- sem número: continua NULL (= número padrão)
INSERT INTO crm_automacoes (id, nome, gatilho_tipo, gatilho_valor) VALUES ('00000000-0000-0000-0000-0000000000a2', 'b', 'tag', 'y');
INSERT INTO crm_automacao_fila (origem, automacao_id, contact_phone, acoes) VALUES ('automacao', '00000000-0000-0000-0000-0000000000a2', '5531999990004', '[]');
SELECT pg_temp.ok((SELECT numero_id FROM crm_automacao_fila WHERE contact_phone = '5531999990004') IS NULL, 'sem número fica NULL');

-- apagar número não apaga automação (SET NULL)
INSERT INTO crm_numeros (id, chave, apelido, tipo, sessao_openwa) VALUES ('00000000-0000-0000-0000-0000000000f1', 'tmp', 'tmp', 'openwa', 'tmp');
UPDATE crm_automacoes SET numero_id = '00000000-0000-0000-0000-0000000000f1' WHERE id = '00000000-0000-0000-0000-0000000000a2';
DELETE FROM crm_numeros WHERE id = '00000000-0000-0000-0000-0000000000f1';
SELECT pg_temp.ok((SELECT numero_id FROM crm_automacoes WHERE id = '00000000-0000-0000-0000-0000000000a2') IS NULL, 'apagar número só solta a automação');

-- permissões das funções de trigger
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'crm_fila_herdar_numero()', 'EXECUTE'), 'authenticated não chama crm_fila_herdar_numero');

-- fluxos (só quando a migration deles está no checkout)
\if :tem_fluxos
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_fluxos_numero_id_fkey'), 'FK em crm_fluxos');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_wa_templates_numero_id_fkey'), 'FK em crm_wa_templates');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM crm_fluxos WHERE origem_ff_workflow_id IS NOT NULL
  AND numero_id IS DISTINCT FROM (SELECT id FROM crm_numeros WHERE chave = 'oficial-full-funnel')), 'espelhos do Full Funnel no número oficial');
UPDATE crm_fluxos SET numero_id = (SELECT id FROM crm_numeros WHERE chave = 'comercial-implementacao-1')
 WHERE id = (SELECT id FROM crm_fluxos ORDER BY id LIMIT 1);
INSERT INTO crm_automacao_fila (origem, fluxo_id, contact_phone, acoes)
  SELECT 'fluxo', id, '5531999990005', '[]' FROM crm_fluxos WHERE numero_id = (SELECT id FROM crm_numeros WHERE chave = 'comercial-implementacao-1');
SELECT pg_temp.ok((SELECT numero_id FROM crm_automacao_fila WHERE contact_phone = '5531999990005')
  = (SELECT id FROM crm_numeros WHERE chave = 'comercial-implementacao-1'), 'fila herda número do fluxo');
\endif

ROLLBACK;
