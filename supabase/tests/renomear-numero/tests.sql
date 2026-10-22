\set ON_ERROR_STOP on
SET client_min_messages = warning;
CREATE FUNCTION pg_temp.ok(cond boolean, nome text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', nome; END IF;
  RAISE NOTICE 'ok  %', nome;
END $$;
SET client_min_messages = notice;
BEGIN; -- desfeito no fim: roda 2x no mesmo banco

-- auth.uid() e is_approved controláveis pelo teste
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('teste.uid', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('teste.aprovado', true) = 'sim' $$;
GRANT SELECT, UPDATE ON public.crm_numeros TO authenticated;

-- 1) RPC como usuário aprovado
SET LOCAL teste.uid = '00000000-0000-0000-0000-000000000001';
SET LOCAL teste.aprovado = 'sim';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT apelido FROM crm_numero_renomear((SELECT id FROM crm_numeros WHERE chave = 'comercial-fit-2'), '  Vendas   Fit  ')) = 'Vendas Fit',
  'renomeia com trim e espaços colapsados');
SELECT pg_temp.ok((SELECT sessao_openwa FROM crm_numeros WHERE chave = 'comercial-fit-2') = 'comercial-fit-2', 'sessão do OpenWA intacta');

DO $$ BEGIN
  PERFORM crm_numero_renomear((SELECT id FROM crm_numeros WHERE chave = 'closer'), 'x');
  RAISE EXCEPTION 'FALHOU: aceitou nome de 1 caractere';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'ok  recusa nome curto';
END $$;
DO $$ BEGIN
  PERFORM crm_numero_renomear((SELECT id FROM crm_numeros WHERE chave = 'closer'), repeat('a', 41));
  RAISE EXCEPTION 'FALHOU: aceitou 41 caracteres';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'ok  recusa nome com 41 caracteres';
END $$;
SELECT pg_temp.ok((SELECT apelido FROM crm_numero_renomear((SELECT id FROM crm_numeros WHERE chave = 'closer'), repeat('a', 40))) = repeat('a', 40), 'aceita 40 caracteres');
DO $$ BEGIN
  PERFORM crm_numero_renomear((SELECT id FROM crm_numeros WHERE chave = 'closer'), 'vendas fit');
  RAISE EXCEPTION 'FALHOU: aceitou nome repetido';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok  recusa nome repetido (sem diferenciar maiúscula)';
END $$;
SELECT pg_temp.ok((SELECT apelido FROM crm_numero_renomear((SELECT id FROM crm_numeros WHERE chave = 'comercial-fit-2'), 'VENDAS FIT')) = 'VENDAS FIT',
  'o próprio número pode trocar só a caixa do nome');
DO $$ BEGIN
  PERFORM crm_numero_renomear('00000000-0000-0000-0000-0000000000ff', 'Qualquer');
  RAISE EXCEPTION 'FALHOU: número inexistente aceito';
EXCEPTION WHEN no_data_found THEN RAISE NOTICE 'ok  número inexistente recusado';
END $$;

-- 2) UPDATE direto pela API (RLS de aprovado): nome passa pela mesma regra, sessão travada
UPDATE crm_numeros SET apelido = ' Suporte  VIP ' WHERE chave = 'suporte-consultoria-1';
SELECT pg_temp.ok((SELECT apelido FROM crm_numeros WHERE chave = 'suporte-consultoria-1') = 'Suporte VIP', 'UPDATE direto normaliza o nome');
DO $$ BEGIN
  UPDATE crm_numeros SET sessao_openwa = 'outra' WHERE chave = 'suporte-consultoria-1';
  RAISE EXCEPTION 'FALHOU: renomeou a sessão pelo UPDATE direto';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  sessao_openwa travada para authenticated';
END $$;
DO $$ BEGIN
  UPDATE crm_numeros SET chave = 'outra' WHERE chave = 'suporte-consultoria-1';
  RAISE EXCEPTION 'FALHOU: trocou a chave';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  chave travada para authenticated';
END $$;
DO $$ BEGIN
  UPDATE crm_numeros SET openwa_session_id = 'x' WHERE chave = 'suporte-consultoria-1';
  RAISE EXCEPTION 'FALHOU: trocou openwa_session_id';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  openwa_session_id travado para authenticated';
END $$;
UPDATE crm_numeros SET max_hora = 25 WHERE chave = 'suporte-consultoria-1';
SELECT pg_temp.ok((SELECT max_hora FROM crm_numeros WHERE chave = 'suporte-consultoria-1') = 25, 'Central segue salvando limites');

-- 3) não aprovado / sem login
SET LOCAL teste.aprovado = 'nao';
DO $$ BEGIN
  PERFORM crm_numero_renomear((SELECT id FROM crm_numeros WHERE chave = 'closer'), 'Hacker');
  RAISE EXCEPTION 'FALHOU: não aprovado renomeou';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  não aprovado recusado';
END $$;
SET LOCAL teste.uid = '';
SET LOCAL teste.aprovado = 'sim';
DO $$ BEGIN
  PERFORM crm_numero_renomear((SELECT id FROM crm_numeros WHERE chave = 'closer'), 'Hacker');
  RAISE EXCEPTION 'FALHOU: sem login renomeou';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  sem login recusado';
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM crm_numero_renomear((SELECT id FROM crm_numeros WHERE chave = 'closer'), 'Hacker');
  RAISE EXCEPTION 'FALHOU: anon executou a RPC';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  anon sem EXECUTE na RPC';
END $$;
RESET ROLE;

-- 4) service_role (edge functions) e SQL editor seguem gravando sessão/telefone
SET LOCAL ROLE service_role;
UPDATE crm_numeros SET openwa_session_id = 'sid-1' WHERE chave = 'closer';
RESET ROLE;
SELECT pg_temp.ok((SELECT openwa_session_id FROM crm_numeros WHERE chave = 'closer') = 'sid-1', 'service_role grava openwa_session_id');
UPDATE crm_numeros SET sessao_openwa = 'closer-2' WHERE chave = 'closer';
SELECT pg_temp.ok((SELECT sessao_openwa FROM crm_numeros WHERE chave = 'closer') = 'closer-2', 'SQL editor (postgres) muda a sessão');

ROLLBACK;
