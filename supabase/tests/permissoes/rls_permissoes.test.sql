-- Cenários de RLS das permissões do CRM (migrations 20261123100000/110000/120000).
-- Roda num Postgres DESCARTÁVEL montado por rodar.sh (todas as migrations + stubs do Supabase). Nunca no Supabase.
-- Identidade simulada como o PostgREST faz: SET ROLE authenticated|anon|service_role + request.jwt.claims.
-- Cada checagem grava em teste.res; o fim imprime as falhas e "RESULTADO: N ok, M falha(s)".
\set ON_ERROR_STOP 1
\set QUIET on
SET client_min_messages = warning;

-- ---------------------------------------------------------------------------------------------- arnês
CREATE SCHEMA IF NOT EXISTS teste;
GRANT USAGE ON SCHEMA teste TO PUBLIC;
CREATE TABLE IF NOT EXISTS teste.res (n serial PRIMARY KEY, nome text, ok boolean, detalhe text);
TRUNCATE teste.res;
CREATE OR REPLACE FUNCTION teste.ok(p_nome text, p_cond boolean, p_detalhe text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO teste.res (nome, ok, detalhe) VALUES (p_nome, coalesce(p_cond, false), p_detalhe);
END $$;
-- conta linhas visíveis para quem está chamando (INVOKER: o RLS de quem chama vale)
CREATE OR REPLACE FUNCTION teste.n(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') x' INTO v;
  RETURN v;
END $$;
-- executa; devolve a mensagem de erro ou NULL se passou
CREATE OR REPLACE FUNCTION teste.erro(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
-- executa um DML; devolve quantas linhas mudou (-1 = deu erro)
CREATE OR REPLACE FUNCTION teste.linhas(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN -1;
END $$;
-- recusado PELO RLS (e não por coluna/constraint): sem isso o teste de "não grava" pode passar à toa
CREATE OR REPLACE FUNCTION teste.rls(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE m text;
BEGIN
  m := teste.erro(p_sql);
  RETURN m ILIKE '%row-level security%' OR m ILIKE '%segurança em nível de linha%' OR m ILIKE '%sem permissão%' OR m ILIKE '%só admin%';
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO PUBLIC;
CREATE OR REPLACE FUNCTION teste.como(p_uid uuid, p_papel text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
                    CASE WHEN p_uid IS NULL THEN json_build_object('role', p_papel)::text
                         ELSE json_build_object('sub', p_uid, 'role', p_papel)::text END, false);
$$;

-- --------------------------------------------------------------------------------------------- cenário
-- ids fixos (o rodar.sh cria ANTIGO antes das migrations novas, como usuário que já existia)
\set ADM     '''00000000-0000-0000-0000-0000000000ad'''
\set ANTIGO  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set UX      '''aaaaaaaa-0000-0000-0000-000000000002'''
\set USEM    '''aaaaaaaa-0000-0000-0000-000000000003'''
\set UMINHAS '''aaaaaaaa-0000-0000-0000-000000000004'''
\set UDEP    '''aaaaaaaa-0000-0000-0000-000000000005'''
\set UNOVO   '''aaaaaaaa-0000-0000-0000-000000000006'''
\set UPEND   '''aaaaaaaa-0000-0000-0000-000000000007'''
\set USDR    '''aaaaaaaa-0000-0000-0000-000000000008'''
\set UCS     '''aaaaaaaa-0000-0000-0000-000000000009'''
\set UVER    '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set USEMACAO '''aaaaaaaa-0000-0000-0000-00000000000b'''

RESET ROLE;
SELECT id AS n_fit2 FROM crm_numeros WHERE chave = 'comercial-fit-2' \gset
SELECT id AS n_sup FROM crm_numeros WHERE chave = 'suporte-consultoria-1' \gset
SELECT id AS n_impl FROM crm_numeros WHERE chave = 'comercial-implementacao-1' \gset
SELECT id AS n_closer FROM crm_numeros WHERE chave = 'closer' \gset

INSERT INTO auth.users (id, email) VALUES
  (:UX, 'ux@t'), (:USEM, 'usem@t'), (:UMINHAS, 'uminhas@t'), (:UDEP, 'udep@t'), (:UNOVO, 'unovo@t'),
  (:UPEND, 'upend@t'), (:USDR, 'usdr@t'), (:UCS, 'ucs@t'), (:UVER, 'uver@t'), (:USEMACAO, 'usemacao@t')
ON CONFLICT DO NOTHING;
-- handle_new_user cria o perfil; aprovar dispara o padrão de acesso (crm_acessos_ao_aprovar)
INSERT INTO profiles (id, full_name) VALUES
  (:UX, 'Usuario X'), (:USEM, 'Sem Acesso'), (:UMINHAS, 'So Minhas'), (:UDEP, 'So Dep'), (:UNOVO, 'Novo'),
  (:UPEND, 'Pendente'), (:USDR, 'Sdr'), (:UCS, 'Cs'), (:UVER, 'So Ver'), (:USEMACAO, 'Sem Acao')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
UPDATE profiles SET approved = true WHERE id IN (:UX, :USEM, :UMINHAS, :UDEP, :UNOVO, :USDR, :UCS, :UVER, :USEMACAO);
INSERT INTO profiles (id, full_name, approved) VALUES (:ADM, 'Admin Breno', true)
ON CONFLICT (id) DO UPDATE SET full_name = 'Admin Breno', approved = true;

-- departamentos manuais de teste (as etapas já viraram departamentos na migration 120000)
INSERT INTO crm_departamentos (nome, cor) VALUES ('Comercial T', '#112233'), ('Suporte T', '#445566') ON CONFLICT DO NOTHING;
SELECT id AS d_com FROM crm_departamentos WHERE nome = 'Comercial T' \gset
SELECT id AS d_sup FROM crm_departamentos WHERE nome = 'Suporte T' \gset
SELECT id AS d_leads FROM crm_departamentos WHERE etapa_origem = 'leads' \gset
SELECT id AS d_agend FROM crm_departamentos WHERE etapa_origem = 'agendado' \gset
INSERT INTO crm_departamento_membros VALUES (:'d_com', :UDEP), (:'d_leads', :USDR), (:'d_sup', :UCS) ON CONFLICT DO NOTHING;

-- acessos: o que o admin configuraria na tela (o padrão do novo usuário fica como veio)
UPDATE crm_acessos SET todos_numeros = false, numeros = ARRAY[:'n_fit2']::uuid[],
       areas = '{"conversas":"editar","kanban":"ver","automacao":"nenhum"}' WHERE user_id = :UX;
UPDATE crm_acessos SET areas = crm_areas_todas('nenhum'), todos_numeros = true WHERE user_id = :USEM;
UPDATE crm_acessos SET todos_numeros = false, numeros = ARRAY[:'n_fit2']::uuid[], areas = '{"conversas":"editar"}', so_minhas = true WHERE user_id = :UMINHAS;
UPDATE crm_acessos SET todos_numeros = false, numeros = ARRAY[:'n_fit2']::uuid[], areas = '{"conversas":"editar"}', so_departamentos = true WHERE user_id = :UDEP;
-- perfis prontos, como src/lib/crm/perfisAcesso.ts aplica (SDR: comerciais + leads; CS: suporte + suporte)
UPDATE crm_acessos SET perfil = 'sdr', todos_numeros = false, numeros = ARRAY[:'n_fit2', :'n_impl']::uuid[],
       areas = crm_areas_todas('nenhum') || '{"conversas":"editar","kanban":"editar"}', so_minhas = true, so_departamentos = true WHERE user_id = :USDR;
UPDATE crm_acessos SET perfil = 'cs', todos_numeros = false, numeros = ARRAY[:'n_sup']::uuid[],
       areas = crm_areas_todas('nenhum') || '{"conversas":"editar","kanban":"editar"}', so_departamentos = true WHERE user_id = :UCS;
UPDATE crm_acessos SET todos_numeros = true, areas = '{"conversas":"ver","kanban":"ver"}' WHERE user_id = :UVER;
UPDATE crm_acessos SET todos_numeros = true, areas = '{"conversas":"editar","kanban":"editar","agente_ia":"editar"}',
       acoes = '{"conversas.assumir_ia":false,"conversas.transferir":false,"kanban.mover":false,"agente_ia.editar_prompt":false}' WHERE user_id = :USEMACAO;

-- conversas: 5 no Fit 2, 1 no suporte, 1 no closer, 1 no Fit 2 com IA atendendo
INSERT INTO whatsapp_contacts (numero_id, phone, name, atendente_id, departamento_id, ai_agent_slug) VALUES
  (:'n_fit2', '5511900000001', 'c1 do so-minhas', :UMINHAS, NULL, NULL),
  (:'n_fit2', '5511900000002', 'c2 sem atendente', NULL, NULL, NULL),
  (:'n_fit2', '5511900000003', 'c3 do admin', :ADM, NULL, NULL),
  (:'n_fit2', '5511900000004', 'c4 dep comercial', NULL, :'d_com', NULL),
  (:'n_fit2', '5511900000005', 'c5 dep suporte', NULL, :'d_sup', NULL),
  (:'n_sup',  '5511900000006', 'c6 suporte', NULL, :'d_sup', NULL),
  (:'n_closer', '5511900000007', 'c7 closer', NULL, NULL, NULL),
  (:'n_fit2', '5511900000008', 'c8 com IA', NULL, NULL, 'agente-teste')
ON CONFLICT DO NOTHING;
INSERT INTO whatsapp_messages (numero_id, contact_phone, body, message_id)
SELECT c.numero_id, c.phone, 'oi ' || g, 'msg-' || c.phone || '-' || g FROM whatsapp_contacts c, generate_series(1, 2) g
 WHERE c.phone LIKE '55119000000%' ON CONFLICT DO NOTHING;
INSERT INTO crm_contato_eventos (contact_phone, tipo, valor)
SELECT phone, 'tag', 'x' FROM whatsapp_contacts WHERE phone LIKE '55119000000%';
INSERT INTO crm_automacoes (nome, gatilho_tipo) SELECT 'auto teste', 'tag' WHERE NOT EXISTS (SELECT 1 FROM crm_automacoes WHERE nome = 'auto teste');
INSERT INTO crm_ai_agents (slug, nome, numero_id) VALUES ('agente-teste', 'Agente Teste', :'n_fit2') ON CONFLICT (slug) DO NOTHING;
-- uma linha em cada tabela de área: "não lê" precisa ter o que não ler
INSERT INTO crm_ai_conhecimento (agent_id, tipo) SELECT id, 'texto' FROM crm_ai_agents WHERE slug = 'agente-teste';
INSERT INTO grupos_campanhas (slug, nome) VALUES ('camp-teste', 'Campanha teste') ON CONFLICT DO NOTHING;
INSERT INTO base_leads (origem, origem_id, nome) VALUES ('teste', 'bl-1', 'Lead base') ON CONFLICT DO NOTHING;
SELECT id AS camp FROM grupos_campanhas WHERE slug = 'camp-teste' \gset

-- --------------------------------------------------------------------------------- 0) estrutura e seed
SELECT teste.ok('seed: usuário aprovado ANTES da migration ganhou acesso total',
  (SELECT todos_numeros AND areas->>'conversas' = 'editar' AND areas->>'automacao' = 'editar' AND NOT so_minhas
     FROM crm_acessos WHERE user_id = :ANTIGO));
SELECT teste.ok('seed: Lives/Banco do usuário antigo seguem o user_modules (sem módulo = nenhum)',
  (SELECT areas->>'lives' = 'nenhum' AND areas->>'banco' = 'nenhum' FROM crm_acessos WHERE user_id = :ANTIGO));
SELECT teste.ok('padrão: usuário NOVO nasce sem números e só ver Conversas',
  (SELECT NOT todos_numeros AND numeros = '{}' AND areas = '{"conversas":"ver"}'::jsonb FROM crm_acessos WHERE user_id = :UNOVO));
SELECT teste.ok('pendente (não aprovado) não ganha linha de acesso', NOT EXISTS (SELECT 1 FROM crm_acessos WHERE user_id = :UPEND));
SELECT teste.ok('etapas viraram departamentos (Leads, Agendado...) com etapa_origem',
  (SELECT count(*) FROM crm_departamentos WHERE etapa_origem IS NOT NULL) = (SELECT count(*) FROM crm_etapas));
SELECT teste.ok('conversa nova em etapa leads entrou no departamento Leads',
  (SELECT departamento_id FROM whatsapp_contacts WHERE phone = '5511900000002') = :'d_leads');
SELECT teste.ok('aba fixa "Em atendimento com IA" existe e é fixa', EXISTS (SELECT 1 FROM crm_departamentos WHERE regra = 'ia' AND fixo));

-- ------------------------------------------------------------------------------------ 1) admin vê tudo
SELECT teste.como(:ADM, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('admin vê as 8 conversas de teste', teste.n($$SELECT 1 FROM whatsapp_contacts WHERE phone LIKE '55119000000%'$$) = 8);
SELECT teste.ok('admin vê as 16 mensagens', teste.n($$SELECT 1 FROM whatsapp_messages WHERE contact_phone LIKE '55119000000%'$$) = 16);
SELECT teste.ok('admin vê todos os números', teste.n('SELECT 1 FROM crm_numeros') = (SELECT count(*) FROM crm_numeros));
SELECT teste.ok('admin edita acesso de outro usuário', teste.linhas(format($$UPDATE crm_acessos SET so_minhas = so_minhas WHERE user_id = %L$$, :UX)) = 1);
SELECT teste.ok('admin NÃO exclui o departamento fixo da IA', teste.erro($$DELETE FROM crm_departamentos WHERE regra = 'ia'$$) IS NOT NULL);
SELECT teste.ok('admin NÃO renomeia a regra do fixo para manual', teste.erro($$UPDATE crm_departamentos SET regra = 'manual' WHERE regra = 'ia'$$) IS NOT NULL);
SELECT teste.ok('admin renomeia o fixo (nome/cor mudam)', teste.erro($$UPDATE crm_departamentos SET nome = nome, cor = '#7c3aed' WHERE regra = 'ia'$$) IS NULL);
RESET ROLE;

-- ------------------------------------------------------------------- 2) número X não vê número Y
SELECT teste.como(:UX, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('UX (só Fit 2) vê só as 6 do Fit 2', teste.n($$SELECT 1 FROM whatsapp_contacts WHERE phone LIKE '55119000000%'$$) = 6);
SELECT teste.ok('UX não vê conversa do suporte', teste.n($$SELECT 1 FROM whatsapp_contacts WHERE phone = '5511900000006'$$) = 0);
SELECT teste.ok('UX não vê mensagem do suporte nem do closer',
  teste.n($$SELECT 1 FROM whatsapp_messages WHERE contact_phone IN ('5511900000006', '5511900000007')$$) = 0);
SELECT teste.ok('UX vê 12 mensagens (6 conversas x 2)', teste.n($$SELECT 1 FROM whatsapp_messages WHERE contact_phone LIKE '55119000000%'$$) = 12);
SELECT teste.ok('UX só enxerga o número Fit 2 em crm_numeros', teste.n('SELECT 1 FROM crm_numeros') = 1);
SELECT teste.ok('UX não vê evento de contato do suporte', teste.n($$SELECT 1 FROM crm_contato_eventos WHERE contact_phone = '5511900000006'$$) = 0);
SELECT teste.ok('UX não cria conversa no suporte',
  teste.rls(format($$INSERT INTO whatsapp_contacts (numero_id, phone, name) VALUES (%L, '5511999999991', 'x')$$, :'n_sup')));
SELECT teste.ok('UX não grava mensagem no suporte',
  teste.rls(format($$INSERT INTO whatsapp_messages (numero_id, contact_phone, body) VALUES (%L, '5511900000006', 'x')$$, :'n_sup')));
SELECT teste.ok('UX não altera conversa do suporte (0 linhas)', teste.linhas($$UPDATE whatsapp_contacts SET name = 'hack' WHERE phone = '5511900000006'$$) = 0);
SELECT teste.ok('UX não move conversa dele para o suporte',
  teste.linhas(format($$UPDATE whatsapp_contacts SET numero_id = %L WHERE phone = '5511900000002'$$, :'n_sup')) = -1);
SELECT teste.ok('UX não apaga conversa do suporte', teste.linhas($$DELETE FROM whatsapp_contacts WHERE phone = '5511900000006'$$) = 0);
SELECT teste.ok('UX altera conversa do Fit 2', teste.linhas($$UPDATE whatsapp_contacts SET name = 'c2 editado' WHERE phone = '5511900000002'$$) = 1);
SELECT teste.ok('conferir (edge): UX responde no Fit 2', (SELECT crm_acesso_conferir('conversa', 2, :'n_fit2', '5511900000002')));
SELECT teste.ok('conferir (edge): UX NÃO responde no suporte', NOT (SELECT crm_acesso_conferir('conversa', 2, :'n_sup', '5511900000006')));
SELECT teste.ok('conferir (edge): UX NÃO responde sem número (= padrão closer)', NOT (SELECT crm_acesso_conferir('conversa', 2, NULL, '5511900000007')));
SELECT teste.ok('RPC assumir no suporte é recusada', teste.erro(format($$SELECT crm_ai_assumir(%L, '5511900000006')$$, :'n_sup')) IS NOT NULL);
SELECT teste.ok('RPC transferir p/ IA no suporte é recusada', teste.erro(format($$SELECT crm_ai_transferir_para_ia(%L, '5511900000006', 'agente-teste')$$, :'n_sup')) IS NOT NULL);
SELECT teste.ok('RPC pausar por humano sem número (todas do telefone) recusada quando uma não é dele',
  teste.erro($$SELECT crm_ai_pausar_por_humano(NULL, '5511900000006', 'teste')$$) IS NOT NULL);
-- 3) sem acesso à área bloqueia
SELECT teste.ok('UX sem Automação: não lê crm_automacoes', teste.n('SELECT 1 FROM crm_automacoes') = 0);
SELECT teste.ok('UX sem Automação: não cria automação', teste.rls($$INSERT INTO crm_automacoes (nome, gatilho_tipo) VALUES ('x', 'tag')$$));
SELECT teste.ok('UX sem Base de leads: não lê base_leads (tem 1 linha)', teste.n('SELECT 1 FROM base_leads') = 0);
SELECT teste.ok('UX não escreve na própria permissão', teste.linhas(format($$UPDATE crm_acessos SET todos_numeros = true WHERE user_id = %L$$, :UX)) = 0);
SELECT teste.ok('UX não cria permissão para outro', teste.rls(format($$INSERT INTO crm_acessos (user_id) VALUES (%L)$$, :UPEND)));
SELECT teste.ok('UX não cria departamento', teste.rls($$INSERT INTO crm_departamentos (nome) VALUES ('hack')$$));
SELECT teste.ok('UX não importa departamentos', teste.rls($$SELECT crm_departamentos_importar('[{"nome":"x"}]')$$));
SELECT teste.ok('UX lê a própria linha de acesso', teste.n('SELECT 1 FROM crm_acessos') = 1);
RESET ROLE;

SELECT teste.como(:USEM, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('sem nenhuma área: 0 conversas', teste.n('SELECT 1 FROM whatsapp_contacts') = 0);
SELECT teste.ok('sem nenhuma área: 0 mensagens', teste.n('SELECT 1 FROM whatsapp_messages') = 0);
SELECT teste.ok('sem nenhuma área: 0 números', teste.n('SELECT 1 FROM crm_numeros') = 0);
SELECT teste.ok('sem nenhuma área: não lê agentes de IA', teste.n('SELECT 1 FROM crm_ai_agents') = 0);
RESET ROLE;

SELECT teste.como(:UVER, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('só "ver": lê as conversas', teste.n($$SELECT 1 FROM whatsapp_contacts WHERE phone LIKE '55119000000%'$$) = 8);
SELECT teste.ok('só "ver": não altera conversa', teste.linhas($$UPDATE whatsapp_contacts SET name = 'x' WHERE phone = '5511900000002'$$) = 0);
SELECT teste.ok('só "ver": edge recusa envio', NOT (SELECT crm_acesso_conferir('conversa', 2, :'n_fit2', '5511900000002')));
SELECT teste.ok('só "ver": não assume da IA', teste.erro(format($$SELECT crm_ai_assumir(%L, '5511900000008')$$, :'n_fit2')) IS NOT NULL);
RESET ROLE;

-- ------------------------------------------------------------------------------------ 4) só as dele
SELECT teste.como(:UMINHAS, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('só as dele: vê a dele + sem atendente (c1,c2,c4,c5,c8), não a do admin',
  teste.n($$SELECT 1 FROM whatsapp_contacts WHERE phone LIKE '55119000000%'$$) = 5
  AND teste.n($$SELECT 1 FROM whatsapp_contacts WHERE phone = '5511900000003'$$) = 0);
SELECT teste.ok('só as dele: não vê mensagens da conversa do admin', teste.n($$SELECT 1 FROM whatsapp_messages WHERE contact_phone = '5511900000003'$$) = 0);
SELECT teste.ok('só as dele: não passa conversa para o admin (update direto)',
  teste.linhas(format($$UPDATE whatsapp_contacts SET atendente_id = %L WHERE phone = '5511900000002'$$, :ADM)) = -1);
SELECT teste.ok('só as dele: não passa conversa para o admin (RPC)',
  teste.erro(format($$SELECT crm_atendente_definir((SELECT id FROM whatsapp_contacts WHERE phone = '5511900000002'), %L)$$, :ADM)) IS NOT NULL);
SELECT teste.ok('só as dele: pega para si a sem atendente (RPC)',
  teste.erro(format($$SELECT crm_atendente_definir((SELECT id FROM whatsapp_contacts WHERE phone = '5511900000002'), %L)$$, :UMINHAS)) IS NULL);
SELECT teste.ok('só as dele: edge recusa responder conversa do admin', NOT (SELECT crm_acesso_conferir('conversa', 2, :'n_fit2', '5511900000003')));
SELECT teste.ok('só as dele: edge deixa abrir conversa nova', (SELECT crm_acesso_conferir('conversa', 2, :'n_fit2', '5511988887777')));
RESET ROLE;
UPDATE whatsapp_contacts SET atendente_id = NULL WHERE phone = '5511900000002';

-- ------------------------------------------------------------------------- 5) só dos departamentos
SELECT teste.como(:UDEP, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('só departamentos: vê c4 (Comercial T, dele), não c5 (Suporte T) nem as de Leads',
  teste.n($$SELECT 1 FROM whatsapp_contacts WHERE phone = '5511900000004'$$) = 1
  AND teste.n($$SELECT 1 FROM whatsapp_contacts WHERE phone IN ('5511900000005', '5511900000002')$$) = 0);
SELECT teste.ok('só departamentos: não move c4 para Suporte T (RPC)',
  teste.erro(format($$SELECT crm_departamento_definir((SELECT id FROM whatsapp_contacts WHERE phone = '5511900000004'), %L)$$, :'d_sup')) IS NOT NULL);
RESET ROLE;

-- ------------------------------------------------------------------------ 6) perfis prontos (parte D)
SELECT teste.como(:USDR, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('SDR não lê o número do suporte', teste.n($$SELECT 1 FROM whatsapp_contacts WHERE numero_id = (SELECT id FROM crm_numeros WHERE chave = 'suporte-consultoria-1')$$) = 0
  AND teste.n($$SELECT 1 FROM whatsapp_messages WHERE contact_phone = '5511900000006'$$) = 0);
SELECT teste.ok('SDR vê as de Leads sem atendente no Fit 2 (c2, c8)', teste.n($$SELECT 1 FROM whatsapp_contacts WHERE phone LIKE '55119000000%'$$) = 2);
SELECT teste.ok('SDR não lê agentes de IA (sem Agente IA) — mas transfere pela conversa', teste.n('SELECT 1 FROM crm_ai_conhecimento') = 0);
SELECT teste.ok('SDR não lê grupos de disparo', teste.n('SELECT 1 FROM grupos_campanhas') = 0);
SELECT teste.ok('SDR não grava número (sem Conexão)', teste.linhas($$UPDATE crm_numeros SET apelido = apelido$$) = 0);
SELECT teste.ok('SDR não agenda mensagem de grupo (sem Disparo) — recusa do RLS',
  teste.rls(format($$INSERT INTO grupos_mensagens (campanha_id, tipo, texto, agendado_para) VALUES (%L, 'texto', 'x', now() + interval '1 day')$$, :'camp')));
SELECT teste.ok('SDR assume da IA na conversa dele (c8)', teste.erro(format($$SELECT crm_ai_assumir(%L, '5511900000008')$$, :'n_fit2')) IS NULL);
SELECT teste.ok('assumir: SDR virou o atendente de c8 e a IA pausou com motivo humano',
  teste.n(format($$SELECT 1 FROM whatsapp_contacts WHERE phone = '5511900000008' AND atendente_id = %L AND ai_pausado AND ai_pausado_motivo = 'humano'$$, :USDR)) = 1);
SELECT teste.ok('assumir: evento "Sdr assumiu" no histórico',
  teste.n($$SELECT 1 FROM crm_ai_eventos WHERE contact_phone = '5511900000008' AND tipo = 'assumido_humano' AND detalhe LIKE 'Sdr assumiu%'$$) = 1);
RESET ROLE;

SELECT teste.como(:UCS, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('CS não lê o comercial (Fit 2)', teste.n($$SELECT 1 FROM whatsapp_contacts WHERE numero_id = (SELECT id FROM crm_numeros WHERE chave = 'comercial-fit-2')$$) = 0
  AND teste.n($$SELECT 1 FROM whatsapp_messages WHERE contact_phone LIKE '55119000000%' AND contact_phone <> '5511900000006'$$) = 0);
SELECT teste.ok('CS vê a do suporte (c6, Suporte T)', teste.n($$SELECT 1 FROM whatsapp_contacts WHERE phone = '5511900000006'$$) = 1);
SELECT teste.ok('CS edge: não responde no Fit 2', NOT (SELECT crm_acesso_conferir('conversa', 2, :'n_fit2', '5511900000002')));
RESET ROLE;

-- ações desligadas (parte D)
SELECT teste.como(:USEMACAO, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('ação "assumir da IA" desligada: assumir recusado', teste.erro(format($$SELECT crm_ai_assumir(%L, '5511900000002')$$, :'n_fit2')) IS NOT NULL);
SELECT teste.ok('ação "transferir" desligada: passar para outro recusado',
  teste.erro(format($$SELECT crm_atendente_definir((SELECT id FROM whatsapp_contacts WHERE phone = '5511900000002'), %L)$$, :ADM)) IS NOT NULL);
SELECT teste.ok('ação "transferir" desligada: transferir para IA recusado',
  teste.erro(format($$SELECT crm_ai_transferir_para_ia(%L, '5511900000002', 'agente-teste')$$, :'n_fit2')) IS NOT NULL);
SELECT teste.ok('ação "mover card" + "transferir" desligadas: mudar departamento recusado',
  teste.erro(format($$SELECT crm_departamento_definir((SELECT id FROM whatsapp_contacts WHERE phone = '5511900000002'), %L)$$, :'d_agend')) IS NOT NULL);
SELECT teste.ok('ações desligadas: enviar continua liberado', (SELECT crm_acesso_conferir('conversa', 2, :'n_fit2', '5511900000002')));
SELECT teste.ok('ação "editar prompt" desligada: lê agentes, mas não altera (RLS)',
  teste.n('SELECT 1 FROM crm_ai_agents') >= 1 AND teste.linhas($$UPDATE crm_ai_agents SET nome = nome$$) = 0);
SELECT teste.ok('edge: crm_acao_minha reflete a ação desligada', NOT (SELECT crm_acao_minha('agente_ia.editar_prompt')) AND (SELECT crm_acao_minha('conversas.enviar')));
RESET ROLE;

-- ------------------------------------------------------------------------- 7) sem login / pendente
SELECT teste.como(NULL, 'anon');
SET ROLE anon;
SELECT teste.ok('anon: 0 conversas', teste.n('SELECT 1 FROM whatsapp_contacts') = 0);
SELECT teste.ok('anon: 0 mensagens', teste.n('SELECT 1 FROM whatsapp_messages') = 0);
SELECT teste.ok('anon: NÃO insere conversa (furo "Service can insert" TO public fechado)',
  teste.rls(format($$INSERT INTO whatsapp_contacts (numero_id, phone, name) VALUES (%L, '5511999999992', 'anon')$$, :'n_fit2')));
SELECT teste.ok('anon: NÃO insere mensagem', teste.rls(format($$INSERT INTO whatsapp_messages (numero_id, contact_phone, body) VALUES (%L, '5511900000002', 'anon')$$, :'n_fit2')));
SELECT teste.ok('anon: NÃO altera conversa', teste.linhas($$UPDATE whatsapp_contacts SET name = 'anon' WHERE phone = '5511900000002'$$) <= 0);
SELECT teste.ok('anon: não chama crm_meu_acesso', teste.erro('SELECT crm_meu_acesso()') IS NOT NULL);
RESET ROLE;

SELECT teste.como(NULL, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('JWT sem sub: 0 conversas', teste.n('SELECT 1 FROM whatsapp_contacts') = 0);
RESET ROLE;

SELECT teste.como(:UPEND, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('pendente: 0 conversas', teste.n('SELECT 1 FROM whatsapp_contacts') = 0);
SELECT teste.ok('pendente: conferir nega', NOT (SELECT crm_acesso_conferir('conversa', 2, :'n_fit2', '5511900000002')));
RESET ROLE;

SELECT teste.como(:UNOVO, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('novo (padrão): 0 conversas até o admin liberar número', teste.n('SELECT 1 FROM whatsapp_contacts') = 0);
RESET ROLE;

SELECT teste.como(:ANTIGO, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('antigo (acesso total): vê as 8', teste.n($$SELECT 1 FROM whatsapp_contacts WHERE phone LIKE '55119000000%'$$) = 8);
SELECT teste.ok('antigo: lê automações', teste.n('SELECT 1 FROM crm_automacoes') >= 1);
SELECT teste.ok('antigo: lê base de leads, conhecimento da IA e campanhas de grupo',
  teste.n('SELECT 1 FROM base_leads') >= 1 AND teste.n('SELECT 1 FROM crm_ai_conhecimento') >= 1 AND teste.n('SELECT 1 FROM grupos_campanhas') >= 1);
RESET ROLE;

-- ------------------------------------------------------------------------------ 8) service role passa
SELECT teste.como(NULL, 'service_role');
SET ROLE service_role;
SELECT teste.ok('service_role vê tudo', teste.n($$SELECT 1 FROM whatsapp_contacts WHERE phone LIKE '55119000000%'$$) = 8);
SELECT teste.ok('service_role insere mensagem (webhook)',
  teste.erro(format($$INSERT INTO whatsapp_messages (numero_id, contact_phone, body, message_id) VALUES (%L, '5511900000006', 'svc', 'svc-1')$$, :'n_sup')) IS NULL);
SELECT teste.ok('service_role: conferir passa', (SELECT crm_acesso_conferir('conversa', 2, :'n_sup', '5511900000006')));
SELECT teste.ok('service_role: assumir (robô) passa', teste.erro(format($$SELECT crm_ai_pausar_por_humano(%L, '5511900000006', 'teste')$$, :'n_sup')) IS NULL);
RESET ROLE;

-- ------------------------------------------------------------------------- 9) etapa x departamento
UPDATE whatsapp_contacts SET stage = 'agendado' WHERE phone = '5511900000002';
SELECT teste.ok('mudar etapa (automação) leva para o departamento da etapa',
  (SELECT departamento_id FROM whatsapp_contacts WHERE phone = '5511900000002') = :'d_agend');
UPDATE whatsapp_contacts SET stage = 'contato' WHERE phone = '5511900000004';
SELECT teste.ok('mudar etapa NÃO tira de departamento manual (Comercial T)',
  (SELECT departamento_id FROM whatsapp_contacts WHERE phone = '5511900000004') = :'d_com');
SELECT teste.como(:ADM, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('admin move para Leads (RPC)', crm_departamento_definir((SELECT id FROM whatsapp_contacts WHERE phone = '5511900000002'), :'d_leads') = :'d_leads');
RESET ROLE;
SELECT teste.ok('mover para departamento de etapa (Kanban) muda a etapa',
  (SELECT stage FROM whatsapp_contacts WHERE phone = '5511900000002') = 'leads');
DELETE FROM crm_departamentos WHERE id = :'d_sup';
SELECT teste.ok('excluir departamento: conversas ficam sem departamento (não somem)',
  (SELECT count(*) FROM whatsapp_contacts WHERE phone IN ('5511900000005', '5511900000006') AND departamento_id IS NULL) = 2);
SELECT teste.ok('atendente_id só aceita usuário aprovado',
  teste.erro(format($$UPDATE whatsapp_contacts SET atendente_id = %L WHERE phone = '5511900000002'$$, :UPEND)) IS NOT NULL);
UPDATE whatsapp_contacts SET atendente = 'Usuario X' WHERE phone = '5511900000007';
SELECT teste.ok('nome do fluxo ("Atribuir") vira atendente_id quando bate com um aprovado',
  (SELECT atendente_id FROM whatsapp_contacts WHERE phone = '5511900000007') = :UX);
UPDATE whatsapp_contacts SET atendente = 'Sem Acesso' WHERE phone = '5511900000007';
SELECT teste.ok('nome do fluxo NÃO troca atendente que já existe',
  (SELECT atendente_id FROM whatsapp_contacts WHERE phone = '5511900000007') = :UX);

-- -------------------------------------------- 10) correções da verificação adversarial (20261123130000)
-- no Supabase anon/authenticated/service_role têm GRANT em storage.objects (quem barra é o RLS); o stub não tem
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
-- semente: mídia no bucket, Instagram, segmento da base, nome do WhatsApp e backfill do número do suporte
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('whatsapp-media', '5511900000006/openwa-sup.jpg', NULL),
  ('whatsapp-media', '5511900000008/openwa-c8.jpg', NULL),
  ('whatsapp-media', 'roteiros/r1/a.jpg', NULL),
  ('whatsapp-media', 'ia/agente-teste/a.pdf', NULL);
INSERT INTO ig_contas (id, ig_user_id) VALUES ('11111111-1111-1111-1111-111111111111', 'ig-teste') ON CONFLICT DO NOTHING;
INSERT INTO ig_contatos (conta_id, igsid, phone, name) VALUES ('11111111-1111-1111-1111-111111111111', '999', 'ig:999', 'Lead IG') ON CONFLICT DO NOTHING;
INSERT INTO base_leads_segmentos (nome, telefones) VALUES ('seg teste', ARRAY['5511900000006']);
INSERT INTO whatsapp_wa_nomes (wid, nome, telefone) VALUES ('5511900000006@c.us', 'Cliente Suporte', '5511900000006') ON CONFLICT DO NOTHING;
INSERT INTO whatsapp_backfill_jobs (id, numero_id) VALUES ('22222222-2222-2222-2222-222222222222', :'n_sup') ON CONFLICT DO NOTHING;
INSERT INTO whatsapp_backfill_chats (job_id, chat_id, kind, phone, nome)
VALUES ('22222222-2222-2222-2222-222222222222', '5511900000006@c.us', 'individual', '5511900000006', 'Cliente Suporte') ON CONFLICT DO NOTHING;

SELECT teste.como(:UPEND, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('pendente NÃO se auto-aprova (profiles.approved)', teste.erro($$UPDATE profiles SET approved = true WHERE id = auth.uid()$$) IS NOT NULL);
SELECT teste.ok('pendente: troca o próprio nome (perfil continua editável)', teste.erro($$UPDATE profiles SET full_name = 'Pendente' WHERE id = auth.uid()$$) IS NULL);
SELECT teste.ok('pendente: 0 mídias do WhatsApp', teste.n($$SELECT 1 FROM storage.objects WHERE bucket_id = 'whatsapp-media'$$) = 0);
SELECT teste.ok('pendente: não sobe mídia', teste.rls($$INSERT INTO storage.objects (bucket_id, name) VALUES ('whatsapp-media', '5511900000006/x.jpg')$$));
SELECT teste.ok('pendente: 0 contatos do Instagram e 0 nomes do WhatsApp',
  teste.n('SELECT 1 FROM ig_contatos') = 0 AND teste.n('SELECT 1 FROM whatsapp_wa_nomes') = 0);
RESET ROLE;
SELECT teste.ok('pendente continua pendente', NOT (SELECT approved FROM profiles WHERE id = :UPEND));
SELECT teste.como(:ADM, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('admin aprova e desaprova pela API', teste.erro(format($$UPDATE profiles SET approved = true WHERE id = %L$$, :UPEND)) IS NULL
  AND teste.erro(format($$UPDATE profiles SET approved = false WHERE id = %L$$, :UPEND)) IS NULL);
SELECT teste.ok('admin lê toda a mídia', teste.n($$SELECT 1 FROM storage.objects WHERE bucket_id = 'whatsapp-media'$$) = 4);
RESET ROLE;
DELETE FROM crm_acessos WHERE user_id = :UPEND;

SELECT teste.como(:USDR, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('SDR: não lê mídia da conversa do suporte', teste.n($$SELECT 1 FROM storage.objects WHERE name LIKE '5511900000006/%'$$) = 0);
SELECT teste.ok('SDR: lê mídia da conversa dele (c8)', teste.n($$SELECT 1 FROM storage.objects WHERE name LIKE '5511900000008/%'$$) = 1);
SELECT teste.ok('SDR: não lê arquivos da IA (sem Agente IA)', teste.n($$SELECT 1 FROM storage.objects WHERE name LIKE 'ia/%'$$) = 0);
SELECT teste.ok('SDR: não sobe mídia na pasta do suporte', teste.rls($$INSERT INTO storage.objects (bucket_id, name) VALUES ('whatsapp-media', '5511900000006/hack.jpg')$$));
SELECT teste.ok('SDR: sobe mídia na conversa dele e lê o que subiu',
  teste.erro($$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('whatsapp-media', '5511900000008/envio.jpg', auth.uid())$$) IS NULL
  AND teste.n($$SELECT 1 FROM storage.objects WHERE name = '5511900000008/envio.jpg'$$) = 1);
SELECT teste.ok('SDR: não sobrescreve mídia do suporte', teste.linhas($$UPDATE storage.objects SET metadata = '{}' WHERE name LIKE '5511900000006/%'$$) = 0);
SELECT teste.ok('SDR: não lê nome do WhatsApp nem backfill do suporte',
  teste.n($$SELECT 1 FROM whatsapp_wa_nomes WHERE telefone = '5511900000006'$$) = 0
  AND teste.n($$SELECT 1 FROM whatsapp_backfill_chats WHERE phone = '5511900000006'$$) = 0);
SELECT teste.ok('SDR: não lê segmento da base (sem Banco/Base)', teste.n('SELECT 1 FROM base_leads_segmentos') = 0);
SELECT teste.ok('SDR: não grava segmento da base', teste.rls($$INSERT INTO base_leads_segmentos (nome) VALUES ('x')$$));
SELECT teste.ok('SDR: código opaco de conversa do suporte = nulo', (SELECT crm_ai_ref_do_contato('5511900000006')) IS NULL);
SELECT teste.ok('SDR: código opaco da conversa dele sai', (SELECT crm_ai_ref_do_contato('5511900000008')) IS NOT NULL);
RESET ROLE;

SELECT teste.como(:USEM, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('sem área: 0 contatos do Instagram e não altera', teste.n('SELECT 1 FROM ig_contatos') = 0
  AND teste.linhas($$UPDATE ig_contatos SET notes = 'x'$$) = 0);
SELECT teste.ok('sem área: lista de tags vazia', teste.n('SELECT * FROM crm_tags_existentes()') = 0);
SELECT teste.ok('sem área: 0 mídias (mesmo com todos os números)', teste.n($$SELECT 1 FROM storage.objects WHERE bucket_id = 'whatsapp-media'$$) = 0);
RESET ROLE;

SELECT teste.como(:UVER, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('só "ver": lê mídia, não sobe nem sobrescreve',
  teste.n($$SELECT 1 FROM storage.objects WHERE name LIKE '5511900000006/%'$$) = 1
  AND teste.rls($$INSERT INTO storage.objects (bucket_id, name) VALUES ('whatsapp-media', '5511900000006/v.jpg')$$)
  AND teste.linhas($$UPDATE storage.objects SET metadata = '{}' WHERE bucket_id = 'whatsapp-media'$$) = 0);
SELECT teste.ok('só "ver": não cria tag direto na tabela', teste.rls($$INSERT INTO crm_tags (nome) VALUES ('tag-uver')$$));
SELECT teste.ok('só "ver": não altera contato do Instagram', teste.linhas($$UPDATE ig_contatos SET notes = 'x'$$) = 0);
RESET ROLE;

SELECT teste.como(:USEMACAO, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('"transferir" desligada: UPDATE direto do atendente para outro recusado',
  teste.erro(format($$UPDATE whatsapp_contacts SET atendente_id = %L WHERE phone = '5511900000002'$$, :UMINHAS)) IS NOT NULL);
SELECT teste.ok('"mover"+"transferir" desligadas: UPDATE direto de etapa/departamento recusado',
  teste.erro($$UPDATE whatsapp_contacts SET stage = 'agendado' WHERE phone = '5511900000002'$$) IS NOT NULL
  AND teste.erro(format($$UPDATE whatsapp_contacts SET departamento_id = %L WHERE phone = '5511900000002'$$, :'d_com')) IS NOT NULL);
SELECT teste.ok('"assumir IA" desligada: UPDATE direto ai_pausado recusado',
  teste.erro($$UPDATE whatsapp_contacts SET ai_pausado = true WHERE phone = '5511900000002'$$) IS NOT NULL);
SELECT teste.ok('ações desligadas: pegar para si e editar nome/notas continuam',
  teste.erro($$UPDATE whatsapp_contacts SET atendente_id = auth.uid(), name = 'c2 ok', notes = 'n' WHERE phone = '5511900000002'$$) IS NULL);
RESET ROLE;
UPDATE whatsapp_contacts SET atendente_id = NULL WHERE phone = '5511900000002';

SELECT teste.como(:ANTIGO, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('antigo: lê toda a mídia de conversa, roteiros e IA', teste.n($$SELECT 1 FROM storage.objects WHERE bucket_id = 'whatsapp-media'$$) >= 4);
SELECT teste.ok('antigo: sobe mídia de roteiro e de conversa',
  teste.erro($$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('whatsapp-media', 'roteiros/r1/b.jpg', auth.uid()), ('whatsapp-media', '5511900000006/b.jpg', auth.uid())$$) IS NULL);
SELECT teste.ok('antigo: Instagram, segmento, nomes e backfill continuam visíveis',
  teste.n('SELECT 1 FROM ig_contatos') = 1 AND teste.n('SELECT 1 FROM base_leads_segmentos') >= 1
  AND teste.n('SELECT 1 FROM whatsapp_wa_nomes') >= 1 AND teste.n('SELECT 1 FROM whatsapp_backfill_chats') >= 1);
SELECT teste.ok('antigo: move etapa, transfere, pausa IA e cria tag direto (como hoje)',
  teste.erro($$UPDATE whatsapp_contacts SET stage = 'contato' WHERE phone = '5511900000002'$$) IS NULL
  AND teste.erro(format($$UPDATE whatsapp_contacts SET atendente_id = %L WHERE phone = '5511900000002'$$, :UMINHAS)) IS NULL
  AND teste.erro($$UPDATE whatsapp_contacts SET ai_pausado = true WHERE phone = '5511900000002'$$) IS NULL
  AND teste.erro($$INSERT INTO crm_tags (nome) VALUES ('tag-antigo')$$) IS NULL);
SELECT teste.ok('antigo: lista de tags e código opaco funcionam', teste.n('SELECT * FROM crm_tags_existentes()') > 0
  AND (SELECT crm_ai_ref_do_contato('5511900000006')) IS NOT NULL);
RESET ROLE;
UPDATE whatsapp_contacts SET atendente_id = NULL, ai_pausado = false WHERE phone = '5511900000002';

SELECT teste.como(NULL, 'service_role');
SET ROLE service_role;
SELECT teste.ok('service_role: robô/automação mexe em atendente, etapa e IA (sem gatilho de ação)',
  teste.erro(format($$UPDATE whatsapp_contacts SET atendente_id = %L, stage = 'agendado', ai_pausado = true WHERE phone = '5511900000002'$$, :UX)) IS NULL);
SELECT teste.ok('service_role: grava mídia (openwa-webhook)', teste.erro($$INSERT INTO storage.objects (bucket_id, name) VALUES ('whatsapp-media', '5511900000006/svc.jpg')$$) IS NULL);
RESET ROLE;
UPDATE whatsapp_contacts SET atendente_id = NULL, ai_pausado = false WHERE phone = '5511900000002';

-- ------------------------------------------------------------- 9) furos restantes (migration 20261123140000)
RESET ROLE;
INSERT INTO alunas (id, user_id, nome_completo, programa, data_compra, duracao_plano, data_vencimento, forma_pagamento, telefone) VALUES
  ('fafa0000-0000-0000-0000-000000000001', :ADM, 'Maria Clara Souza', 'Consultoria Elite', current_date, '3', current_date + 90, 'pix', '(31) 98888-7766'),
  ('fafa0000-0000-0000-0000-000000000002', :ADM, 'Joana Lima', 'menos_gordura', current_date, '3', current_date + 90, 'pix', '(11) 97777-6655')
ON CONFLICT (id) DO NOTHING;
INSERT INTO profiles_meta_credenciais (user_id, meta_access_token) VALUES (:UX, 'tok-ux'), (:ADM, 'tok-adm')
ON CONFLICT (user_id) DO UPDATE SET meta_access_token = EXCLUDED.meta_access_token;

-- 1) aluna pelo telefone
SELECT teste.como(NULL, 'anon');
SET ROLE anon;
SELECT teste.ok('furo1 anon: portão ainda acha a aluna (tela /feedback e /troca seguem)',
  (SELECT count(*) FROM identificar_aluna_por_whatsapp('5531988887766')) = 1);
SELECT teste.ok('furo1 anon: devolve só id NULL, primeiro nome e produto',
  (SELECT row(id, nome_completo, programa)::text FROM identificar_aluna_por_whatsapp('5531988887766')) = '(,Maria,elite)',
  (SELECT row(id, nome_completo, programa)::text FROM identificar_aluna_por_whatsapp('5531988887766')));
SELECT teste.ok('furo1 anon: programa vira produto (menos_gordura -> mgmd), sem sobrenome',
  (SELECT row(id, nome_completo, programa)::text FROM identificar_aluna_por_whatsapp('11977776655')) = '(,Joana,mgmd)');
SELECT teste.ok('furo1 anon: NÃO chama a versão completa', teste.erro($$SELECT * FROM aluna_por_telefone_interno('5531988887766')$$) ILIKE '%permission denied%');
-- feedback público: aluna_id mandado pelo navegador é ignorado; vale o telefone
SELECT teste.ok('furo1 anon: INSERT de feedback continua aceito',
  teste.erro($$INSERT INTO feedback_semanal_responses (nome, telefone, produto, aluna_id)
               VALUES ('Maria', '5531988887766', 'elite', 'fafa0000-0000-0000-0000-000000000002')$$) IS NULL
  AND teste.erro($$INSERT INTO feedback_semanal_responses (nome, telefone, produto, aluna_id)
               VALUES ('Intrusa', '5521900001111', 'mgmd', 'fafa0000-0000-0000-0000-000000000002')$$) IS NULL);
RESET ROLE;
SELECT teste.ok('furo1: feedback anon cai na aluna do TELEFONE, com o nome completo do cadastro',
  (SELECT count(*) FROM feedback_semanal_responses WHERE telefone = '5531988887766'
     AND aluna_id = 'fafa0000-0000-0000-0000-000000000001' AND nome = 'Maria Clara Souza') = 1);
SELECT teste.ok('furo1: aluna_id forjado com telefone que não é de aluna vira NULL',
  (SELECT count(*) FROM feedback_semanal_responses WHERE telefone = '5521900001111' AND aluna_id IS NULL AND nome = 'Intrusa') = 1);

SELECT teste.como(:UX, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('furo1 aprovado: também só o mínimo, e NÃO chama a versão completa',
  (SELECT id IS NULL AND nome_completo = 'Maria' FROM identificar_aluna_por_whatsapp('31988887766'))
  AND teste.erro($$SELECT * FROM aluna_por_telefone_interno('31988887766')$$) IS NOT NULL);
RESET ROLE;

SELECT teste.como(NULL, 'service_role');
SET ROLE service_role;
SELECT teste.ok('furo1 service_role: versão completa devolve id, nome completo e programa',
  (SELECT row(id, nome_completo, programa)::text FROM aluna_por_telefone_interno('31988887766'))
    = '(fafa0000-0000-0000-0000-000000000001,"Maria Clara Souza","Consultoria Elite")');
SELECT coalesce(teste.erro($$INSERT INTO feedback_semanal_responses (nome, telefone, produto, aluna_id)
                    VALUES ('svc', '5531988887766', 'elite', 'fafa0000-0000-0000-0000-000000000002')$$), '') AS erro_svc \gset
RESET ROLE;
-- conferido fora do papel: no stub o service_role não tem BYPASSRLS e a policy de leitura é só de authenticated
SELECT teste.ok('furo1 service_role: INSERT de feedback mantém o aluna_id que mandou',
  :'erro_svc' = '' AND (SELECT aluna_id FROM feedback_semanal_responses WHERE nome = 'svc') = 'fafa0000-0000-0000-0000-000000000002', :'erro_svc');

-- 2) token da Meta
SELECT teste.ok('furo2: meta_access_token saiu de profiles',
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'meta_access_token'));
\if :{?SEM_COLUNA_META}
-- cenário produção: a coluna nunca existiu, não há o que copiar. A tabela nasce vazia; o antigo grava o token nela
-- (como service_role) para os testes de visibilidade abaixo terem as mesmas 4 linhas do cenário completo.
SELECT teste.ok('furo2 (produção, sem coluna): profiles_meta_credenciais criada e vazia', teste.n(format($$SELECT 1 FROM profiles_meta_credenciais WHERE user_id = %L$$, :ANTIGO)) = 0);
INSERT INTO profiles_meta_credenciais (user_id, meta_access_token) VALUES (:ANTIGO, 'tok-antigo');
\else
SELECT teste.ok('furo2: token que já existia foi copiado (antigo)',
  (SELECT meta_access_token FROM profiles_meta_credenciais WHERE user_id = :ANTIGO) = 'tok-antigo');
\endif
SELECT teste.como(:UX, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('furo2 aprovado: lê só o PRÓPRIO token', teste.n('SELECT 1 FROM profiles_meta_credenciais') = 1
  AND (SELECT meta_access_token FROM profiles_meta_credenciais) = 'tok-ux');
SELECT teste.ok('furo2 aprovado: NÃO lê o token do admin nem do antigo',
  teste.n(format($$SELECT 1 FROM profiles_meta_credenciais WHERE user_id IN (%L, %L)$$, :ADM, :ANTIGO)) = 0);
SELECT teste.ok('furo2 aprovado: troca o próprio token', teste.linhas($$UPDATE profiles_meta_credenciais SET meta_access_token = 'tok-ux2' WHERE user_id = auth.uid()$$) = 1);
SELECT teste.ok('furo2 aprovado: NÃO grava token em nome de outro', teste.rls(format($$INSERT INTO profiles_meta_credenciais (user_id, meta_access_token) VALUES (%L, 'x')$$, :UMINHAS))
  AND teste.linhas(format($$UPDATE profiles_meta_credenciais SET meta_access_token = 'x' WHERE user_id = %L$$, :ADM)) = 0);
SELECT teste.ok('furo2 aprovado: continua lendo o perfil dos colegas (nome, avatar)', teste.n('SELECT id, full_name, avatar_url FROM profiles') > 1);
RESET ROLE;
SELECT teste.como(:ADM, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('furo2 admin: lê o token de todos', teste.n('SELECT 1 FROM profiles_meta_credenciais') = 3);
SELECT teste.ok('furo2 admin: grava token de outro', teste.erro(format($$INSERT INTO profiles_meta_credenciais (user_id, meta_access_token) VALUES (%L, 'tok-m') ON CONFLICT (user_id) DO UPDATE SET meta_access_token = 'tok-m'$$, :UMINHAS)) IS NULL);
RESET ROLE;
SELECT teste.como(NULL, 'anon');
SET ROLE anon;
SELECT teste.ok('furo2 anon: sem acesso à tabela de token', teste.erro('SELECT 1 FROM profiles_meta_credenciais') ILIKE '%permission denied%');
RESET ROLE;
SELECT teste.como(NULL, 'service_role');
SET ROLE service_role;
SELECT teste.ok('furo2 service_role: lê todos', teste.n('SELECT 1 FROM profiles_meta_credenciais') = 4);
RESET ROLE;

-- 3) is_closer e full_name
SELECT teste.como(:UX, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('furo3 aprovado: NÃO se marca closer', teste.rls(format($$UPDATE profiles SET is_closer = true WHERE id = %L$$, :UX)));
SELECT teste.ok('furo3 aprovado: NÃO se renomeia com o nome do admin (nem com caixa/espaço diferentes)',
  teste.erro(format($$UPDATE profiles SET full_name = 'Admin Breno' WHERE id = %L$$, :UX)) ILIKE '%já existe%'
  AND teste.erro(format($$UPDATE profiles SET full_name = '  admin BRENO ' WHERE id = %L$$, :UX)) ILIKE '%já existe%');
SELECT teste.ok('furo3 aprovado: renomeia para nome livre e edita o resto do perfil',
  teste.linhas(format($$UPDATE profiles SET full_name = 'Usuario X Novo', avatar_url = 'a.png' WHERE id = %L$$, :UX)) = 1
  AND teste.linhas(format($$UPDATE profiles SET full_name = 'Usuario X' WHERE id = %L$$, :UX)) = 1);
SELECT teste.ok('furo3 aprovado: salvar o perfil inteiro sem mudar is_closer passa',
  teste.linhas(format($$UPDATE profiles SET is_closer = is_closer, full_name = full_name WHERE id = %L$$, :UX)) = 1);
RESET ROLE;
SELECT teste.como(:UPEND, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('furo3 pendente: NÃO se marca closer', teste.rls(format($$UPDATE profiles SET is_closer = true WHERE id = %L$$, :UPEND)));
SELECT teste.ok('furo3 pendente: NÃO pega o nome de um aprovado', teste.erro(format($$UPDATE profiles SET full_name = 'Usuario X' WHERE id = %L$$, :UPEND)) IS NOT NULL);
RESET ROLE;
SELECT teste.como(:ADM, 'authenticated');
SET ROLE authenticated;
SELECT teste.ok('furo3 admin: marca e desmarca closer de outro (tela Disponibilidade)',
  teste.linhas(format($$UPDATE profiles SET is_closer = true WHERE id = %L$$, :UX)) = 1
  AND teste.linhas(format($$UPDATE profiles SET is_closer = false WHERE id = %L$$, :UX)) = 1);
SELECT teste.ok('furo3 admin: renomeia outro usuário', teste.linhas(format($$UPDATE profiles SET full_name = 'Usuario X' WHERE id = %L$$, :UX)) = 1);
RESET ROLE;
SELECT teste.como(NULL, 'service_role');
SET ROLE service_role;
SELECT teste.ok('furo3 service_role: muda is_closer', teste.linhas(format($$UPDATE profiles SET is_closer = true WHERE id = %L$$, :UCS)) = 1
  AND teste.linhas(format($$UPDATE profiles SET is_closer = false WHERE id = %L$$, :UCS)) = 1);
-- passo Atribuir novo (edge crm-automacoes): grava atendente_id + nome; o id manda, mesmo com nome diferente
SELECT coalesce(teste.erro(format($$UPDATE whatsapp_contacts SET atendente_id = %L, atendente = 'Admin Breno' WHERE phone = '5511900000002'$$, :UX)), '') AS erro_atr \gset
SELECT teste.ok('furo3 Atribuir por id: usuário não aprovado é recusado', teste.erro(format($$UPDATE whatsapp_contacts SET atendente_id = %L WHERE phone = '5511900000002'$$, :UPEND)) IS NOT NULL);
RESET ROLE;
SELECT teste.ok('furo3 Atribuir por id: atendente_id fica o do id, não o do nome',
  :'erro_atr' = '' AND (SELECT atendente_id FROM whatsapp_contacts WHERE phone = '5511900000002') = :UX::uuid, :'erro_atr');
UPDATE whatsapp_contacts SET atendente_id = NULL, atendente = NULL WHERE phone = '5511900000002';
SELECT teste.como(NULL, 'service_role');
SET ROLE service_role;
SELECT coalesce(teste.erro($$UPDATE whatsapp_contacts SET atendente = 'Usuario X' WHERE phone = '5511900000002'$$), '') AS erro_nome \gset
RESET ROLE;
SELECT teste.ok('furo3 Atribuir antigo (só nome) continua casando com o aprovado de nome único',
  :'erro_nome' = '' AND (SELECT atendente_id FROM whatsapp_contacts WHERE phone = '5511900000002') = :UX::uuid, :'erro_nome');
UPDATE whatsapp_contacts SET atendente_id = NULL, atendente = NULL WHERE phone = '5511900000002';

-- ------------------------------------------------------------------------------------------- resultado
SELECT format('FALHA  %s %s', nome, coalesce(detalhe, '')) FROM teste.res WHERE NOT ok ORDER BY n;
SELECT format('RESULTADO: %s ok, %s falha(s)', count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok)) FROM teste.res;
