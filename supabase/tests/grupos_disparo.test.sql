-- Testes da migration 20261108110000 (rodar com supabase/tests/rodar-sql-grupos.sh). Falha = RAISE EXCEPTION.
\set ON_ERROR_STOP on
DO $$
DECLARE
  c uuid; a uuid; b uuid; x uuid; r jsonb; n_a int := 0; n_b int := 0; i int; av1 uuid; av2 uuid; num uuid;
BEGIN
  -- encher (padrão): sempre o primeiro com vaga
  INSERT INTO grupos_campanhas (nome, slug, limite_por_grupo) VALUES ('T', 'grupo-teste', 10) RETURNING id INTO c;
  INSERT INTO grupos_campanha_grupos (campanha_id, ordem, nome, link_convite, chat_id)
    VALUES (c, 0, 'A', 'https://chat.whatsapp.com/AAAAAAAAAAAAAAAAAAAA', '120363000000000001@g.us') RETURNING id INTO a;
  INSERT INTO grupos_campanha_grupos (campanha_id, ordem, nome, link_convite, chat_id)
    VALUES (c, 1, 'B', 'https://chat.whatsapp.com/BBBBBBBBBBBBBBBBBBBB', '120363000000000002@g.us') RETURNING id INTO b;
  -- importado sem convite: aceito (tem id) e nunca escolhido pelo link
  INSERT INTO grupos_campanha_grupos (campanha_id, ordem, nome, link_convite, chat_id, importado)
    VALUES (c, -1, 'X', NULL, '120363000000000003@g.us', true) RETURNING id INTO x;
  FOR i IN 1..4 LOOP
    r := grupos_resolver_link('grupo-teste');
    IF r->>'grupo' <> 'A' THEN RAISE EXCEPTION 'encher: esperado A, veio %', r; END IF;
  END LOOP;

  -- split 50/50: alterna entre A e B (A já tem 4 cliques -> B recebe até empatar)
  UPDATE grupos_campanhas SET modo_distribuicao = 'split' WHERE id = c;
  UPDATE grupos_campanha_grupos SET cliques = 0 WHERE campanha_id = c;
  FOR i IN 1..10 LOOP
    r := grupos_resolver_link('grupo-teste');
    IF r->>'grupo' = 'A' THEN n_a := n_a + 1; ELSIF r->>'grupo' = 'B' THEN n_b := n_b + 1;
    ELSE RAISE EXCEPTION 'split: grupo inesperado %', r; END IF;
  END LOOP;
  IF n_a <> 5 OR n_b <> 5 THEN RAISE EXCEPTION 'split 50/50: A=% B=%', n_a, n_b; END IF;

  -- todos lotados (10/10): lotado
  r := grupos_resolver_link('grupo-teste');
  IF r->>'erro' <> 'lotado' THEN RAISE EXCEPTION 'split lotado: %', r; END IF;

  -- split 70/30 com limite alto
  UPDATE grupos_campanhas SET limite_por_grupo = 1000 WHERE id = c;
  UPDATE grupos_campanha_grupos SET cliques = 0, peso = CASE WHEN id = a THEN 70 ELSE 30 END WHERE campanha_id = c;
  n_a := 0; n_b := 0;
  FOR i IN 1..100 LOOP
    r := grupos_resolver_link('grupo-teste');
    IF r->>'grupo' = 'A' THEN n_a := n_a + 1; ELSE n_b := n_b + 1; END IF;
  END LOOP;
  IF n_a NOT BETWEEN 69 AND 71 THEN RAISE EXCEPTION 'split 70/30: A=% B=%', n_a, n_b; END IF;

  -- pula cheio e inativo
  UPDATE grupos_campanha_grupos SET cheio = true WHERE id = a;
  r := grupos_resolver_link('grupo-teste');
  IF r->>'grupo' <> 'B' THEN RAISE EXCEPTION 'split pula cheio: %', r; END IF;
  UPDATE grupos_campanha_grupos SET ativo = false WHERE id = b;
  r := grupos_resolver_link('grupo-teste');
  IF r->>'erro' <> 'lotado' THEN RAISE EXCEPTION 'split sem grupo elegível: %', r; END IF;

  -- link pausado
  UPDATE grupos_campanhas SET link_pausado = true WHERE id = c;
  r := grupos_resolver_link('grupo-teste');
  IF r->>'erro' <> 'pausado' THEN RAISE EXCEPTION 'pausado: %', r; END IF;

  -- modo inválido recusado
  BEGIN
    UPDATE grupos_campanhas SET modo_distribuicao = 'aleatorio' WHERE id = c;
    RAISE EXCEPTION 'modo inválido passou';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- peso fora de 1-100 recusado
  BEGIN
    UPDATE grupos_campanha_grupos SET peso = 0 WHERE id = a;
    RAISE EXCEPTION 'peso 0 passou';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- grupo sem link e sem id recusado
  BEGIN
    INSERT INTO grupos_campanha_grupos (campanha_id, nome) VALUES (c, 'vazio');
    RAISE EXCEPTION 'grupo sem link e sem id passou';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- mesmo id duas vezes na campanha recusado
  BEGIN
    INSERT INTO grupos_campanha_grupos (campanha_id, chat_id) VALUES (c, '120363000000000003@g.us');
    RAISE EXCEPTION 'id duplicado passou';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- Avulsos: uma por número, idempotente
  INSERT INTO crm_numeros (chave, apelido, tipo, sessao_openwa) VALUES ('grupos-1', 'Grupos 1', 'openwa', 'grupos-1') RETURNING id INTO num;
  av1 := grupos_campanha_avulsa(num);
  av2 := grupos_campanha_avulsa(num);
  IF av1 IS NULL OR av1 <> av2 THEN RAISE EXCEPTION 'avulsa não idempotente % %', av1, av2; END IF;
  IF NOT (SELECT link_pausado AND avulsa AND NOT auto_criar FROM grupos_campanhas WHERE id = av1) THEN
    RAISE EXCEPTION 'avulsa nasceu com link aberto ou criação ligada';
  END IF;
  IF grupos_campanha_avulsa(NULL) = av1 THEN RAISE EXCEPTION 'avulsa da sessão padrão colidiu com a do número'; END IF;

  -- grupos_alvo: 1 a 200
  BEGIN
    INSERT INTO grupos_mensagens (campanha_id, agendado_para, tipo, texto, grupos_alvo) VALUES (c, now(), 'texto', 'oi', '{}');
    RAISE EXCEPTION 'grupos_alvo vazio passou';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO grupos_mensagens (campanha_id, agendado_para, tipo, texto, grupos_alvo, disparo_id)
    VALUES (c, now() + interval '1 hour', 'texto', 'oi', ARRAY[b], gen_random_uuid());

  -- tick acorda para criação agendada vencida
  DELETE FROM grupos_mensagens;
  UPDATE grupos_campanhas SET link_pausado = true, auto_criar = false;
  UPDATE grupos_campanha_grupos SET participantes_em = now();
  IF grupos_disparo_tick() <> 'nada a fazer' THEN RAISE EXCEPTION 'tick sem nada acordou'; END IF;
  UPDATE grupos_campanhas SET criacao_agendada_para = now() - interval '1 minute' WHERE id = c;
  IF grupos_disparo_tick() = 'nada a fazer' THEN RAISE EXCEPTION 'tick não acordou para a criação agendada'; END IF;

  RAISE NOTICE 'OK: todos os testes da migration 20261108110000 passaram';
END $$;
