-- Testes da 20261029110000. Cada bloco: NOTICE 'ok ...' ou EXCEPTION 'FALHOU ...'.
\set ON_ERROR_STOP 1

-- Usuários: admin, com módulo crm-banco, aprovado sem módulo, não aprovado com módulo.
INSERT INTO public.aprovados VALUES ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c');
INSERT INTO public.user_roles VALUES ('00000000-0000-0000-0000-00000000000a', 'admin');
INSERT INTO public.user_modules VALUES ('00000000-0000-0000-0000-00000000000b', 'crm-banco'), ('00000000-0000-0000-0000-00000000000d', 'crm-banco');

-- ---------------- Gestão de Alunas + Monitoramento das Consultas ----------------
INSERT INTO public.alunas (nome_completo, programa, data_compra, data_vencimento, telefone, status, is_teste) VALUES
 ('Ana Ativa',            'consultoria_slim', public.crm_hoje_brt() - 30,  public.crm_hoje_brt(),       '11999990001', 'ativa',   false), -- vence hoje: ativa
 ('Bia Vencida',          'menos_gordura',    public.crm_hoje_brt() - 60,  public.crm_hoje_brt() - 1,   '11999990002', 'ativa',   false), -- venceu ontem: ex
 ('Carla Inativa Futuro', 'elite',            public.crm_hoje_brt() - 20,  public.crm_hoje_brt() + 10,  '11999990003', 'inativa', false), -- status não entra: ativa
 ('TESTE – Treinamento',  'elite',            public.crm_hoje_brt(),       public.crm_hoje_brt() + 30,  '00900000001', 'ativa',   true),  -- teste: fora de tudo
 ('Dani Renovou',         'consultoria_slim', public.crm_hoje_brt() - 200, public.crm_hoje_brt() - 100, '11999990005', 'inativa', false), -- plano antigo
 ('Dani Renovou',         'slim_definida',    public.crm_hoje_brt() - 5,   public.crm_hoje_brt() + 30,  '(11) 99999-0005', 'ativa', false), -- renovou: ativa, não ex
 ('Teste Vencida',        'elite',            public.crm_hoje_brt() - 90,  public.crm_hoje_brt() - 30,  '00900000002', 'ativa',   true);  -- teste vencida: não é ex
INSERT INTO public.consultations (client_name, client_phone, converted, refunded, program_value, date) VALUES
 ('Eva Fechou',      '11999990006',     true,  false, 'slim_3m', public.crm_hoje_brt() - 40), -- só consulta convertida: ex
 ('Fabi Reembolso',  '11999990007',     true,  true,  'slim_3m', public.crm_hoje_brt() - 40), -- reembolso: fora
 ('Gabi Nao',        '11999990008',     false, false, NULL,      public.crm_hoje_brt() - 40), -- não fechou: fora
 ('Ana Ativa',       '(11) 99999-0001', true,  false, 'slim_3m', public.crm_hoje_brt() - 30), -- é ativa: fora do ex
 ('bia   vencida',   NULL,              true,  NULL,  'mgmd',    public.crm_hoje_brt() - 60), -- mesma Bia pelo nome: junta
 ('Dani Renovou',    NULL,              true,  false, 'slim',    public.crm_hoje_brt() - 5),  -- ativa pelo nome: fora
 ('Hel Sem Fone',    NULL,              true,  false, 'slim',    public.crm_hoje_brt() - 9);  -- ex sem telefone (chave pelo nome)

DO $$
DECLARE n int; r record;
BEGIN
  SELECT count(*) INTO n FROM public.crm_alunas_recorte('ativas');
  IF n <> 3 THEN RAISE EXCEPTION 'FALHOU ativas: esperava 3 (Ana vence hoje, Carla inativa com plano, Dani renovada), veio %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_alunas_recorte('ativas') WHERE nome = 'Ana Ativa') THEN RAISE EXCEPTION 'FALHOU vence hoje deveria ser ativa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_alunas_recorte('ativas') WHERE nome = 'Carla Inativa Futuro') THEN RAISE EXCEPTION 'FALHOU status inativa com vencimento futuro deveria ser ativa (regra do painel)'; END IF;
  IF EXISTS (SELECT 1 FROM public.crm_alunas_recorte('ativas') WHERE nome ILIKE 'teste%') THEN RAISE EXCEPTION 'FALHOU aluna de teste contou como ativa'; END IF;
  RAISE NOTICE 'ok ativas = vencimento >= hoje (BRT), sem teste, status ignorado (3)';

  SELECT count(*) INTO n FROM public.crm_alunas_recorte('ex');
  IF n <> 3 THEN RAISE EXCEPTION 'FALHOU ex: esperava 3 (Bia, Eva, Hel), veio % (%)', n, (SELECT string_agg(nome, ', ') FROM public.crm_alunas_recorte('ex')); END IF;
  SELECT * INTO r FROM public.crm_alunas_recorte('ex') WHERE telefone_e164 = '+5511999990002';
  IF r IS NULL OR r.fontes <> ARRAY['consulta-fechou', 'gestao-alunas'] THEN RAISE EXCEPTION 'FALHOU Bia deveria juntar gestão + consulta pelo nome: %', r; END IF;
  IF r.programa <> 'menos_gordura' OR r.vencimento <> public.crm_hoje_brt() - 1 THEN RAISE EXCEPTION 'FALHOU Bia programa/vencimento da Gestão: %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_alunas_recorte('ex') WHERE telefone_e164 = '+5511999990006' AND fontes = ARRAY['consulta-fechou']) THEN RAISE EXCEPTION 'FALHOU Eva (só consulta convertida) deveria ser ex'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_alunas_recorte('ex') WHERE chave = 'nome:hel sem fone' AND telefone_e164 IS NULL) THEN RAISE EXCEPTION 'FALHOU ex sem telefone deveria ter chave pelo nome'; END IF;
  IF EXISTS (SELECT 1 FROM public.crm_alunas_recorte('ex') WHERE nome ILIKE ANY (ARRAY['fabi%', 'gabi%', 'ana%', 'dani%', 'teste%'])) THEN RAISE EXCEPTION 'FALHOU entrou no ex quem não devia (reembolso/não fechou/ativa/renovada/teste)'; END IF;
  RAISE NOTICE 'ok ex-alunas = gestão ou consulta convertida sem reembolso, menos as ativas (tel ou nome), uma por pessoa (3)';
END $$;

-- ---------------- Base unificada materializada ----------------
INSERT INTO public.base_leads (origem, origem_id, nome, telefone_e164, email, tags, nivel, status, criado_origem) VALUES
 ('avaliacao', 'f1', 'Lia A',   '+5511988880001', 'lia@x.com', '{form-avaliacao,nivel-A}', 'A',  NULL, now() - interval '2 days'),
 ('avaliacao', 'f2', 'Mia DQ',  '+5511988880002', NULL,        '{form-avaliacao}',         'DQ', NULL, now() - interval '3 days'),
 ('avaliacao', 'f3', 'Nina B',  NULL,             'nina@x.com','{form-avaliacao}',         'B',  NULL, now() - interval '40 days'),
 ('individual','i1', 'Lia A',   '+5511988880001', NULL,        '{form-individual}',        NULL, NULL, now() - interval '1 day'),
 ('sellflux',  's1', 'Ola',     '+5511988880004', NULL,        '{abandonou-carrinho}',     NULL, NULL, now() - interval '5 days'),
 ('compra',    'c1', NULL,      '+5511988880005', NULL,        '{comprou}',                NULL, 'compra', now() - interval '6 days');
SELECT public.base_leads_unificada_atualizar();

DO $$
DECLARE a bigint; b bigint;
BEGIN
  SELECT count(*) INTO a FROM public.base_leads_unificada;
  SELECT count(*) INTO b FROM public.base_leads_unificada_mat;
  IF a <> b OR a <> 5 THEN RAISE EXCEPTION 'FALHOU cópia: visão % x cópia % (esperava 5)', a, b; END IF;
  IF EXISTS (SELECT * FROM public.base_leads_unificada EXCEPT SELECT * FROM public.base_leads_unificada_mat) THEN RAISE EXCEPTION 'FALHOU cópia difere da visão'; END IF;
  IF (SELECT linhas FROM public.base_leads_unificada_estado) <> 5 THEN RAISE EXCEPTION 'FALHOU estado não anotou as linhas'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'base-leads-unificada-mat' AND schedule = '*/10 * * * *' AND command LIKE '%base_leads_unificada_atualizar()%') THEN RAISE EXCEPTION 'FALHOU pg_cron não agendado'; END IF;
  RAISE NOTICE 'ok cópia materializada = visão (5 pessoas), estado anotado, pg_cron a cada 10 min';
END $$;

-- O comando agendado roda como está (SET + REFRESH CONCURRENTLY) com a tela lendo.
INSERT INTO public.base_leads (origem, origem_id, nome, telefone_e164, tags, nivel, criado_origem) VALUES ('avaliacao', 'f9', 'Pia C', '+5511988880009', '{}', 'C', now());
SET statement_timeout = '10min'; SELECT public.base_leads_unificada_atualizar();
RESET statement_timeout;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.base_leads_unificada_mat) <> 6 THEN RAISE EXCEPTION 'FALHOU refresh concorrente não pegou a linha nova'; END IF;
  RAISE NOTICE 'ok REFRESH CONCURRENTLY pega linha nova';
END $$;

-- ---------------- RPCs (como a tela chama: papel authenticated) ----------------
GRANT USAGE ON SCHEMA cron TO authenticated;
SET ROLE authenticated;
SELECT set_config('teste.uid', '00000000-0000-0000-0000-00000000000b', false);  -- módulo crm-banco
DO $$
DECLARE n bigint; t bigint; k text;
BEGIN
  n := public.crm_segmento_contar('avaliacao-qualificados');
  IF n <> 3 THEN RAISE EXCEPTION 'FALHOU contar avaliacao-qualificados: esperava 3 (Lia A, Nina B, Pia C), veio %', n; END IF;
  IF public.crm_segmento_contar('avaliacao-desqualificados') <> 1 THEN RAISE EXCEPTION 'FALHOU desqualificados'; END IF;
  IF public.crm_segmento_contar('todos') <> 6 THEN RAISE EXCEPTION 'FALHOU todos'; END IF;
  IF public.crm_segmento_contar('alunas-ativas') <> 3 THEN RAISE EXCEPTION 'FALHOU contar alunas-ativas'; END IF;
  IF public.crm_segmento_contar('ex-alunas') <> 3 THEN RAISE EXCEPTION 'FALHOU contar ex-alunas (filtro novo {"alunas":"ex"})'; END IF;
  IF public.crm_segmento_contar('abandono-pix') <> 1 THEN RAISE EXCEPTION 'FALHOU abandono-pix'; END IF;
  RAISE NOTICE 'ok contagens: qualificados 3, DQ 1, todos 6, ativas 3, ex 3, abandono 1';

  -- página + total
  SELECT count(*), max(total) INTO n, t FROM public.crm_segmento_listar('avaliacao-qualificados', '{}', 0, 2);
  IF n <> 2 OR t <> 3 THEN RAISE EXCEPTION 'FALHOU página 0: % linhas, total %', n, t; END IF;
  SELECT count(*), max(total) INTO n, t FROM public.crm_segmento_listar('avaliacao-qualificados', '{}', 1, 2);
  IF n <> 1 OR t <> 3 THEN RAISE EXCEPTION 'FALHOU página 1: % linhas, total %', n, t; END IF;
  SELECT chave INTO k FROM public.crm_segmento_listar('avaliacao-qualificados', '{}', 0, 50) LIMIT 1;
  IF k <> '+5511988880009' THEN RAISE EXCEPTION 'FALHOU ordem por última entrada desc: %', k; END IF;
  -- filtros da tela
  IF (SELECT max(total) FROM public.crm_segmento_listar('avaliacao-qualificados', '{"comTelefone":true}', 0, 50)) <> 2 THEN RAISE EXCEPTION 'FALHOU comTelefone'; END IF;
  IF (SELECT max(total) FROM public.crm_segmento_listar('todos', '{"busca":"nina"}', 0, 50)) <> 1 THEN RAISE EXCEPTION 'FALHOU busca nome'; END IF;
  IF (SELECT max(total) FROM public.crm_segmento_listar('todos', '{"busca":"8880004"}', 0, 50)) <> 1 THEN RAISE EXCEPTION 'FALHOU busca telefone'; END IF;
  IF (SELECT max(total) FROM public.crm_segmento_listar('todos', '{"busca":"%"}', 0, 50)) <> 6 THEN RAISE EXCEPTION 'FALHOU busca com curinga deveria ser ignorada'; END IF;
  IF (SELECT max(total) FROM public.crm_segmento_listar('todos', '{"tag":"comprou"}', 0, 50)) <> 1 THEN RAISE EXCEPTION 'FALHOU tag'; END IF;
  IF (SELECT max(total) FROM public.crm_segmento_listar('avaliacao-qualificados', jsonb_build_object('de', to_char(public.crm_hoje_brt() - 10, 'YYYY-MM-DD')), 0, 50)) <> 2 THEN RAISE EXCEPTION 'FALHOU de'; END IF;
  IF (SELECT max(total) FROM public.crm_segmento_listar('avaliacao-qualificados', jsonb_build_object('ate', to_char(public.crm_hoje_brt() - 10, 'YYYY-MM-DD')), 0, 50)) <> 1 THEN RAISE EXCEPTION 'FALHOU ate'; END IF;
  IF (SELECT max(total) FROM public.crm_segmento_listar('ex-alunas', '{"busca":"eva"}', 0, 50)) <> 1 THEN RAISE EXCEPTION 'FALHOU busca no ex'; END IF;
  IF (SELECT max(total) FROM public.crm_segmento_listar('ex-alunas', '{"comTelefone":true}', 0, 50)) <> 2 THEN RAISE EXCEPTION 'FALHOU comTelefone no ex'; END IF;
  SELECT nome INTO k FROM public.crm_segmento_listar('alunas-ativas', '{}', 0, 50) LIMIT 1;
  IF k <> 'Ana Ativa' THEN RAISE EXCEPTION 'FALHOU ativas por vencimento (quem vence primeiro no topo): %', k; END IF;
  SELECT nome INTO k FROM public.crm_segmento_listar('ex-alunas', '{}', 0, 50) LIMIT 1;
  IF k <> 'Bia Vencida' THEN RAISE EXCEPTION 'FALHOU ex por vencimento mais recente no topo: %', k; END IF;
  RAISE NOTICE 'ok listar: páginas com total, ordem, busca, telefone, tag, período, curinga ignorado';
END $$;

-- sem permissão: aprovado sem módulo, não aprovado, anônimo
SELECT set_config('teste.uid', '00000000-0000-0000-0000-00000000000c', false);
DO $$ BEGIN
  PERFORM public.crm_segmento_contar('todos');
  RAISE EXCEPTION 'FALHOU aprovado sem módulo leu';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok aprovado sem módulo crm-banco: recusado';
END $$;
SELECT set_config('teste.uid', '00000000-0000-0000-0000-00000000000d', false);
DO $$ BEGIN
  PERFORM * FROM public.crm_segmento_listar('todos', '{}', 0, 5);
  RAISE EXCEPTION 'FALHOU não aprovado leu';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok não aprovado: recusado';
END $$;
DO $$ BEGIN
  PERFORM count(*) FROM public.base_leads_unificada_mat;
  RAISE EXCEPTION 'FALHOU authenticated lê a cópia direto';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok cópia não é legível direto pelo authenticated';
END $$;
DO $$ BEGIN
  PERFORM * FROM public.crm_alunas_recorte('ativas');
  RAISE EXCEPTION 'FALHOU authenticated chama crm_alunas_recorte direto';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok crm_alunas_recorte só por dentro da RPC';
END $$;
SELECT set_config('teste.uid', '00000000-0000-0000-0000-00000000000a', false);  -- admin
DO $$ BEGIN
  IF public.crm_segmento_contar('todos') <> 6 OR public.crm_banco_atualizado_em() IS NULL THEN RAISE EXCEPTION 'FALHOU admin'; END IF;
  RAISE NOTICE 'ok admin lê e vê a hora da atualização';
  PERFORM public.crm_segmento_contar('nao-existe');
  RAISE EXCEPTION 'FALHOU slug inexistente';
EXCEPTION WHEN no_data_found THEN RAISE NOTICE 'ok slug inexistente: erro claro';
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  PERFORM public.crm_segmento_contar('todos');
  RAISE EXCEPTION 'FALHOU anon executou';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok anon não executa';
END $$;
RESET ROLE;
