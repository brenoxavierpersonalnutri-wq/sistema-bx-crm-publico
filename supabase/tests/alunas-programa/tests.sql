-- Testes da 20261031100000. Roda DEPOIS de banco-segmentos/tests.sql (mesmo banco, mesmos usuários e alunas).
-- Ativas que já existem: Ana (consultoria_slim, 0001), Carla (elite, 0003), Dani (slim_definida, 0005).
\set ON_ERROR_STOP 1
RESET ROLE;
INSERT INTO public.alunas (nome_completo, programa, data_compra, data_vencimento, telefone, is_teste) VALUES
 ('Mara Duas Vezes', 'menos_gordura',    public.crm_hoje_brt() - 10, public.crm_hoje_brt() + 30, '11999990010',     false),
 ('Mara Duas Vezes', 'menos_gordura',    public.crm_hoje_brt() - 5,  public.crm_hoje_brt() + 60, '(11) 99999-0010', false), -- duplicada: fica esta
 ('Mara D.',         'elite',            public.crm_hoje_brt() - 3,  public.crm_hoje_brt() + 20, '+55 11 99999-0010', false), -- mesma pessoa no ELITE
 ('Pati Sem Fone',   'plataforma_magra', public.crm_hoje_brt() - 9,  public.crm_hoje_brt() + 5,  NULL,              false),
 ('pati  sem fone',  'plataforma_magra', public.crm_hoje_brt() - 2,  public.crm_hoje_brt() + 10, NULL,              false), -- duplicada pelo nome
 ('Vera Vencida',    'menos_gordura',    public.crm_hoje_brt() - 90, public.crm_hoje_brt() - 1,  '11999990012',     false), -- vencida
 ('Teste MGMD',      'menos_gordura',    public.crm_hoje_brt(),      public.crm_hoje_brt() + 30, '00900000003',     true);  -- teste

DO $$
DECLARE n int; r record;
BEGIN
  -- de-para
  IF public.crm_alunas_programa_segmento('menos_gordura') <> 'mgmd' OR public.crm_alunas_programa_segmento(' ELITE ') <> 'elite'
     OR public.crm_alunas_programa_segmento('plataforma_magra') <> 'plataforma'
     OR public.crm_alunas_programa_segmento('consultoria_slim') IS NOT NULL OR public.crm_alunas_programa_segmento('slim_definida') IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU de-para de programa';
  END IF;
  RAISE NOTICE 'ok de-para: menos_gordura=mgmd, elite=elite, plataforma_magra=plataforma, slim fora';

  SELECT count(*) INTO n FROM public.crm_alunas_recorte('ativas');
  IF n <> 5 THEN RAISE EXCEPTION 'FALHOU todas: esperava 5 (Ana, Carla, Dani, Mara, Pati), veio % (%)', n, (SELECT string_agg(nome, ', ') FROM public.crm_alunas_recorte('ativas')); END IF;
  SELECT * INTO r FROM public.crm_alunas_recorte('ativas') WHERE telefone_e164 = '+5511999990010';
  IF r.vencimento <> public.crm_hoje_brt() + 60 THEN RAISE EXCEPTION 'FALHOU dedup deveria manter o vencimento mais distante: %', r; END IF;
  IF (SELECT count(*) FROM public.crm_alunas_recorte('ativas') WHERE nome ILIKE 'pati%') <> 1 THEN RAISE EXCEPTION 'FALHOU dedup sem telefone pelo nome'; END IF;
  RAISE NOTICE 'ok todas = 5, uma linha por pessoa (telefone; sem telefone, nome), fica o vencimento mais distante';

  IF (SELECT count(*) FROM public.crm_alunas_recorte('ativas', 'mgmd')) <> 1 THEN RAISE EXCEPTION 'FALHOU mgmd: %', (SELECT string_agg(nome, ', ') FROM public.crm_alunas_recorte('ativas', 'mgmd')); END IF;
  IF (SELECT array_agg(telefone_e164 ORDER BY telefone_e164) FROM public.crm_alunas_recorte('ativas', 'elite')) <> ARRAY['+5511999990003', '+5511999990010'] THEN RAISE EXCEPTION 'FALHOU elite: esperava Carla e Mara'; END IF;
  SELECT * INTO r FROM public.crm_alunas_recorte('ativas', 'elite') WHERE telefone_e164 = '+5511999990010';
  IF r.programa <> 'elite' THEN RAISE EXCEPTION 'FALHOU no ELITE a linha da Mara deveria ser o cadastro elite: %', r; END IF;
  IF (SELECT count(*) FROM public.crm_alunas_recorte('ativas', 'plataforma')) <> 1 THEN RAISE EXCEPTION 'FALHOU plataforma'; END IF;
  RAISE NOTICE 'ok MGMD 1, ELITE 2 (Mara nos dois programas), PLATAFORMA 1; vencida e teste fora';
END $$;

SET ROLE authenticated;
SELECT set_config('teste.uid', '00000000-0000-0000-0000-00000000000b', false);  -- módulo crm-banco
DO $$ BEGIN
  IF public.crm_segmento_contar('alunas-ativas') <> 5 OR public.crm_segmento_contar('alunas-ativas-mgmd') <> 1
     OR public.crm_segmento_contar('alunas-ativas-elite') <> 2 OR public.crm_segmento_contar('alunas-ativas-plataforma') <> 1 THEN
    RAISE EXCEPTION 'FALHOU contagens: todas %, mgmd %, elite %, plataforma %', public.crm_segmento_contar('alunas-ativas'),
      public.crm_segmento_contar('alunas-ativas-mgmd'), public.crm_segmento_contar('alunas-ativas-elite'), public.crm_segmento_contar('alunas-ativas-plataforma');
  END IF;
  IF (SELECT max(total) FROM public.crm_segmento_listar('alunas-ativas-elite', '{"busca":"carla"}', 0, 50)) <> 1 THEN RAISE EXCEPTION 'FALHOU busca no ELITE'; END IF;
  IF (SELECT max(total) FROM public.crm_segmento_listar('alunas-ativas-plataforma', '{"comTelefone":true}', 0, 50)) IS NOT NULL THEN RAISE EXCEPTION 'FALHOU comTelefone na PLATAFORMA (Pati sem fone)'; END IF;
  IF (SELECT nome FROM public.crm_segmento_listar('alunas-ativas', '{}', 0, 50) LIMIT 1) <> 'Ana Ativa' THEN RAISE EXCEPTION 'FALHOU ordem por vencimento'; END IF;
  IF (SELECT string_agg(nome, '|' ORDER BY ordem) FROM public.crm_segmentos WHERE slug LIKE 'alunas-ativas%') <> 'Alunas ativas — Todas|MGMD|ELITE|PLATAFORMA' THEN
    RAISE EXCEPTION 'FALHOU nomes dos 4 segmentos: %', (SELECT string_agg(nome, '|' ORDER BY ordem) FROM public.crm_segmentos WHERE slug LIKE 'alunas-ativas%');
  END IF;
  RAISE NOTICE 'ok RPCs da tela: Todas 5, MGMD 1, ELITE 2, PLATAFORMA 1, busca/telefone/ordem, 4 segmentos na ordem';
END $$;
DO $$ BEGIN
  PERFORM * FROM public.crm_alunas_telefones('ativas', 'elite');
  RAISE EXCEPTION 'FALHOU authenticated chamou crm_alunas_telefones';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok crm_alunas_telefones: authenticated não executa';
END $$;
DO $$ BEGIN
  PERFORM * FROM public.crm_alunas_recorte('ativas', 'elite');
  RAISE EXCEPTION 'FALHOU authenticated chamou crm_alunas_recorte(2)';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok crm_alunas_recorte(situacao, programa) só por dentro';
END $$;
SELECT set_config('teste.uid', '00000000-0000-0000-0000-00000000000c', false);  -- aprovado sem módulo
DO $$ BEGIN
  PERFORM public.crm_segmento_contar('alunas-ativas-mgmd');
  RAISE EXCEPTION 'FALHOU aprovado sem módulo leu MGMD';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok aprovado sem módulo: recusado no MGMD';
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  PERFORM * FROM public.crm_alunas_telefones('ativas', NULL);
  RAISE EXCEPTION 'FALHOU anon chamou crm_alunas_telefones';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok anon não executa crm_alunas_telefones';
END $$;
RESET ROLE;

-- motor (service_role, sem usuário)
SELECT set_config('teste.uid', '', false);
SET ROLE service_role;
DO $$ BEGIN
  IF (SELECT array_agg(telefone ORDER BY telefone) FROM public.crm_alunas_telefones('ativas', 'elite')) <> ARRAY['5511999990003', '5511999990010'] THEN
    RAISE EXCEPTION 'FALHOU telefones ELITE para o motor';
  END IF;
  IF (SELECT count(*) FROM public.crm_alunas_telefones('ativas')) <> 4 THEN RAISE EXCEPTION 'FALHOU telefones Todas: Ana, Carla, Dani, Mara (Pati sem fone fica fora): %', (SELECT count(*) FROM public.crm_alunas_telefones('ativas')); END IF;
  IF (SELECT count(*) FROM public.crm_alunas_telefones('ativas', 'plataforma')) <> 0 THEN RAISE EXCEPTION 'FALHOU telefones PLATAFORMA'; END IF;
  RAISE NOTICE 'ok service_role: telefones (dígitos) por programa para o motor';
  PERFORM * FROM public.crm_alunas_telefones('ativas', 'slim');
  RAISE EXCEPTION 'FALHOU programa inválido passou';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'ok programa inválido: erro claro';
END $$;
RESET ROLE;

-- programa inválido num segmento não vira "todas" em silêncio
INSERT INTO public.crm_segmentos (slug, nome, filtro) VALUES ('alunas-x', 'Programa X', '{"alunas":"ativas","programa":"slim"}');
SET ROLE authenticated;
SELECT set_config('teste.uid', '00000000-0000-0000-0000-00000000000a', false);  -- admin
DO $$ BEGIN
  PERFORM public.crm_segmento_contar('alunas-x');
  RAISE EXCEPTION 'FALHOU segmento com programa inválido contou';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'ok segmento com programa inválido: erro, não "todas"';
END $$;
RESET ROLE;

-- de-para editável sem migration: slim_definida -> mgmd põe a Dani no MGMD
INSERT INTO public.crm_alunas_programa_mapa (programa, segmento) VALUES ('slim_definida', 'mgmd');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.crm_alunas_recorte('ativas', 'mgmd')) <> 2 THEN RAISE EXCEPTION 'FALHOU de-para editável'; END IF;
  RAISE NOTICE 'ok de-para editável: INSERT no mapa muda o segmento sem migration';
END $$;
