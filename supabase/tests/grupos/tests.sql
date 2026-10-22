-- Testes da migration 20261024130000 (grupos). Cada bloco falha com ASSERT/EXCEPTION.
\set ON_ERROR_STOP 1

DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grupos_campanhas_numero_id_fkey'), 'FK numero_id não criada';
  ASSERT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'grupos-disparo-tick'), 'cron não agendado';
  ASSERT (SELECT public FROM storage.buckets WHERE id = 'grupos-midia') = false, 'bucket deveria ser privado';
  RAISE NOTICE 'ok: FK para crm_numeros na 2a passada, cron e bucket privado';
END $$;

-- dados: campanha com 2 grupos, limite 2
INSERT INTO public.grupos_campanhas (id, nome, slug, limite_por_grupo, url_lotado)
VALUES ('00000000-0000-0000-0000-0000000000c1', 'Desafio', 'grupo-desafio', 2, 'https://exemplo.com/lista-espera');
INSERT INTO public.grupos_campanha_grupos (id, campanha_id, ordem, nome, link_convite, chat_id) VALUES
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 2, 'G2', 'https://chat.whatsapp.com/BBBBBBBBBBBBBBBBBB', '120363000000000002@g.us'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 1, 'G1', 'https://chat.whatsapp.com/AAAAAAAAAAAAAAAAAA', '120363000000000001@g.us');

SET ROLE anon;
DO $$
DECLARE r jsonb; urls text[] := '{}';
BEGIN
  FOR i IN 1..5 LOOP
    r := public.grupos_resolver_link('grupo-desafio', NULL, NULL, NULL, '{"utm_source":"ig","lixo":"x"}');
    urls := urls || coalesce(r->>'url', 'ERRO:' || (r->>'erro'));
  END LOOP;
  ASSERT urls[1:4] = ARRAY['https://chat.whatsapp.com/AAAAAAAAAAAAAAAAAA','https://chat.whatsapp.com/AAAAAAAAAAAAAAAAAA',
                           'https://chat.whatsapp.com/BBBBBBBBBBBBBBBBBB','https://chat.whatsapp.com/BBBBBBBBBBBBBBBBBB'], urls::text;
  ASSERT urls[5] = 'https://exemplo.com/lista-espera', 'lotado deveria ir para url_lotado: ' || urls[5];
  ASSERT (public.grupos_resolver_link('grupo-desafio') ->> 'erro') = 'lotado';
  ASSERT (public.grupos_resolver_link('nao-existe') ->> 'erro') = 'nao_encontrada';
  ASSERT (public.grupos_resolver_link('DROP TABLE') ->> 'erro') = 'nao_encontrada';
  RAISE NOTICE 'ok: link enche G1 até o limite, passa pro G2, lotado vai pra lista de espera';
END $$;

-- anon não lê tabela nenhuma direto
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM public.grupos_campanha_grupos;
    RAISE EXCEPTION 'FALHOU: anon leu grupos_campanha_grupos';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.grupos_cliques;
    RAISE EXCEPTION 'FALHOU: anon leu grupos_cliques';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok: anon sem SELECT nas tabelas (só a RPC)';
END $$;
RESET ROLE;

DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.grupos_cliques) = 6, 'cliques gravados: ' || (SELECT count(*) FROM public.grupos_cliques);
  ASSERT (SELECT cliques FROM public.grupos_campanha_grupos WHERE nome = 'G1') = 2;
  ASSERT (SELECT count(*) FROM public.grupos_cliques WHERE resultado = 'lotado') = 2;
  ASSERT (SELECT utm FROM public.grupos_cliques ORDER BY id LIMIT 1) = '{"utm_source":"ig"}'::jsonb, 'utm não filtrou';
  RAISE NOTICE 'ok: cliques por grupo e lotado contados, UTM só com chaves conhecidas';
END $$;

-- recontagem: G1 tem 1 participante real -> volta a ter vaga
UPDATE public.grupos_campanha_grupos SET participantes = 1, cliques_na_contagem = cliques WHERE nome = 'G1';
-- lead: contato já existe SEM o 9 (como o WhatsApp grava às vezes)
INSERT INTO public.whatsapp_contacts (phone, name, tags) VALUES ('553199998888', 'Ana', ARRAY['vip']);
SET ROLE anon;
DO $$ DECLARE r jsonb; BEGIN
  r := public.grupos_resolver_link('grupo-desafio', '(31) 99999-8888', 'Ana Paula', 'ANA@X.COM', '{}');
  ASSERT r->>'url' = 'https://chat.whatsapp.com/AAAAAAAAAAAAAAAAAA', 'recontagem não liberou vaga: ' || r::text;
  r := public.grupos_resolver_link('grupo-desafio', '31988887777', 'Bia', NULL, '{}');
  ASSERT r->>'erro' = 'lotado', 'G1 deveria lotar de novo: ' || r::text;
  RAISE NOTICE 'ok: participantes + cliques desde a contagem decidem a vaga';
END $$;
RESET ROLE;

DO $$ BEGIN
  ASSERT (SELECT tags FROM public.whatsapp_contacts WHERE phone = '553199998888') @> ARRAY['vip', 'grupo-grupo-desafio'], 'tag não entrou no contato existente';
  ASSERT (SELECT count(*) FROM public.whatsapp_contacts WHERE right(phone, 8) = '99998888') = 1, 'duplicou o contato sem o 9';
  ASSERT (SELECT name FROM public.whatsapp_contacts WHERE phone = '553199998888') = 'Ana', 'sobrescreveu nome existente';
  ASSERT EXISTS (SELECT 1 FROM public.base_leads WHERE origem = 'grupo_whatsapp' AND telefone_e164 = '+5531999998888'
                 AND email = 'ana@x.com' AND tags @> ARRAY['grupo-grupo-desafio']), 'base_leads sem o lead';
  -- clique que deu lotado não vira lead (só quem foi mandado a um grupo)
  ASSERT NOT EXISTS (SELECT 1 FROM public.whatsapp_contacts WHERE phone = '5531988887777'), 'lead de clique lotado não deveria entrar';
  RAISE NOTICE 'ok: lead em base_leads e tag no contato (casando sem o 9, sem duplicar, sem trocar o nome)';
END $$;

-- mesmo telefone de novo: não duplica base_leads; contato novo nasce com a tag
UPDATE public.grupos_campanhas SET limite_por_grupo = 100;
SET ROLE anon;
SELECT public.grupos_resolver_link('grupo-desafio', '5531999998888');
SELECT public.grupos_resolver_link('grupo-desafio', '11 97777-6666', 'Caio');
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.base_leads WHERE telefone_e164 = '+5531999998888') = 1, 'duplicou base_leads';
  ASSERT (SELECT tags FROM public.whatsapp_contacts WHERE phone = '5511977776666') = ARRAY['grupo-grupo-desafio'], 'contato novo sem tag';
  ASSERT (SELECT source FROM public.whatsapp_contacts WHERE phone = '5511977776666') = 'grupo_whatsapp';
  RAISE NOTICE 'ok: lead idempotente e contato novo com a tag da campanha';
END $$;

-- link pausado
UPDATE public.grupos_campanhas SET link_pausado = true;
DO $$ BEGIN
  ASSERT (public.grupos_resolver_link('grupo-desafio') ->> 'erro') = 'pausado';
  UPDATE public.grupos_campanhas SET link_pausado = false, encerrada = true;
  ASSERT (public.grupos_resolver_link('grupo-desafio') ->> 'erro') = 'nao_encontrada', 'encerrada deveria sumir';
  UPDATE public.grupos_campanhas SET encerrada = false;
  RAISE NOTICE 'ok: link pausado e campanha encerrada';
END $$;

-- conteúdo da mensagem
DO $$ BEGIN
  BEGIN
    INSERT INTO public.grupos_mensagens (campanha_id, agendado_para, tipo, texto, midia_path)
    VALUES ('00000000-0000-0000-0000-0000000000c1', now(), 'audio', 'legenda', 'c1/a.ogg');
    RAISE EXCEPTION 'FALHOU: áudio com legenda passou';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.grupos_mensagens (campanha_id, agendado_para, tipo, texto) VALUES ('00000000-0000-0000-0000-0000000000c1', now(), 'texto', '  ');
    RAISE EXCEPTION 'FALHOU: texto vazio passou';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'ok: conteúdo inválido recusado pelo banco';
END $$;

-- RLS da mensagem: usuário aprovado agenda/edita só "agendada"
SET teste.uid = '00000000-0000-0000-0000-00000000aaaa';
SET ROLE authenticated;
INSERT INTO public.grupos_mensagens (id, campanha_id, agendado_para, tipo, texto)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', now() + interval '1 hour', 'texto', 'Live hoje às 20h https://x.com');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.grupos_mensagens (campanha_id, agendado_para, tipo, texto, status)
    VALUES ('00000000-0000-0000-0000-0000000000c1', now(), 'texto', 'x', 'concluida');
    RAISE EXCEPTION 'FALHOU: criou mensagem já concluída';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.grupos_envios (mensagem_id, grupo_id, chat_id, proximo_em)
    VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'x', now());
    RAISE EXCEPTION 'FALHOU: usuário escreveu em grupos_envios';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok: RLS — usuário agenda, não forja status nem fila';
END $$;
RESET ROLE;

-- tick: com mensagem futura (> 1 min) e grupos recontados há pouco, nada a fazer
UPDATE public.grupos_campanha_grupos SET participantes_em = now();
DO $$ BEGIN
  ASSERT public.grupos_disparo_tick() = 'nada a fazer', 'tick chamou sem trabalho';
  UPDATE public.grupos_mensagens SET agendado_para = now() - interval '1 second' WHERE id = '00000000-0000-0000-0000-0000000000e1';
  ASSERT public.grupos_disparo_tick() = 'chamado';
  ASSERT (SELECT headers ? 'x-grupos-segredo' FROM net.chamadas ORDER BY id DESC LIMIT 1), 'sem segredo no header';
  UPDATE public.grupos_campanhas SET disparos_pausados = true;
  ASSERT public.grupos_disparo_tick() = 'nada a fazer', 'tick chamou com disparos pausados';
  UPDATE public.grupos_campanhas SET disparos_pausados = false;
  RAISE NOTICE 'ok: pg_cron só chama a função com mensagem vencida (e não com disparo pausado)';
END $$;

-- editar depois que começou: RLS barra (0 linhas); cancelar no meio cancela o pendente
UPDATE public.grupos_mensagens SET status = 'enviando', iniciado_em = now(), total_grupos = 2 WHERE id = '00000000-0000-0000-0000-0000000000e1';
INSERT INTO public.grupos_envios (mensagem_id, grupo_id, chat_id, ordem, proximo_em, status) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '120363000000000001@g.us', 0, now(), 'enviado'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', '120363000000000002@g.us', 1, now() + interval '40 seconds', 'pendente');
SET ROLE authenticated;
UPDATE public.grupos_mensagens SET texto = 'trocado' WHERE id = '00000000-0000-0000-0000-0000000000e1';
SELECT public.grupos_cancelar_mensagem('00000000-0000-0000-0000-0000000000e1');
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT texto FROM public.grupos_mensagens WHERE id = '00000000-0000-0000-0000-0000000000e1') <> 'trocado', 'editou mensagem em envio';
  ASSERT (SELECT status FROM public.grupos_mensagens WHERE id = '00000000-0000-0000-0000-0000000000e1') = 'cancelada';
  ASSERT (SELECT array_agg(status ORDER BY ordem) FROM public.grupos_envios WHERE mensagem_id = '00000000-0000-0000-0000-0000000000e1')
         = ARRAY['enviado', 'cancelado'], 'cancelar mexeu no que já saiu ou não cancelou o pendente';
  RAISE NOTICE 'ok: não edita depois de começar; cancelar no meio para o que falta e preserva o que saiu';
END $$;

-- cancelar sem login é recusado
SET teste.uid = '';
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.grupos_cancelar_mensagem('00000000-0000-0000-0000-0000000000e1');
    RAISE EXCEPTION 'FALHOU: cancelou sem usuário aprovado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok: cancelar exige usuário aprovado';
END $$;
RESET ROLE;
