-- Testes da 20261030100000 (eventos do banco, entrada por webhook, tags). Cada bloco levanta exceção se falhar.
\set ON_ERROR_STOP 1
DO $$
DECLARE n int; v text; ok boolean; f uuid; e uuid;
BEGIN
  -- sem fluxo ligado ouvindo: nenhum evento (base antiga / tráfego normal não gera nada)
  INSERT INTO lead_form_responses (nome, telefone, nivel, origem) VALUES ('Ana', '(31) 99999-0001', 'A', 'avaliacao');
  INSERT INTO base_leads (origem, origem_id, telefone_e164, nivel) VALUES ('sellflux', '1', '+5531999990002', 'B');
  INSERT INTO whatsapp_contacts (phone) VALUES ('5531999990003');
  SELECT count(*) INTO n FROM crm_contato_eventos WHERE tipo = 'evento';
  IF n <> 0 THEN RAISE EXCEPTION 'FALHOU: sem ouvinte gerou % eventos', n; END IF;
  RAISE NOTICE 'ok: sem fluxo ligado nenhum evento';

  -- fluxo em RASCUNHO com gatilho banco: ainda nada
  INSERT INTO crm_fluxos (nome, ativo, gatilhos) VALUES ('F', false, '[{"tipo":"banco","fonte":"formulario","niveis":["A"]}]') RETURNING id INTO f;
  INSERT INTO lead_form_responses (nome, telefone, nivel) VALUES ('Bia', '31999990004', 'A');
  SELECT count(*) INTO n FROM crm_contato_eventos WHERE tipo = 'evento';
  IF n <> 0 THEN RAISE EXCEPTION 'FALHOU: rascunho gerou evento'; END IF;

  -- publicado: só registros NOVOS geram evento, com nível/origem nos dados
  UPDATE crm_fluxos SET ativo = true WHERE id = f;
  INSERT INTO lead_form_responses (nome, telefone, nivel, origem, email) VALUES ('Cris', '31 99999-0005', 'C', 'individual', 'CRIS@X.COM');
  SELECT count(*) INTO n FROM crm_contato_eventos WHERE valor = 'banco_formulario';
  IF n <> 1 THEN RAISE EXCEPTION 'FALHOU: esperado 1 evento banco_formulario, veio %', n; END IF;
  SELECT dados->>'nivel' || '|' || (dados->>'origem') || '|' || contact_phone || '|' || (dados->>'email') INTO v FROM crm_contato_eventos WHERE valor = 'banco_formulario';
  IF v <> 'C|individual|5531999990005|cris@x.com' THEN RAISE EXCEPTION 'FALHOU: dados do evento %', v; END IF;
  -- formulário de cliente (UTM de conta de cliente) não gera evento
  INSERT INTO lead_form_responses (nome, telefone, nivel, utm_campaign) VALUES ('Cli', '31999990006', 'A', '120123456789010608');
  SELECT count(*) INTO n FROM crm_contato_eventos WHERE valor = 'banco_formulario';
  IF n <> 1 THEN RAISE EXCEPTION 'FALHOU: form de cliente gerou evento'; END IF;
  -- telefone inválido não gera evento nem derruba o insert
  INSERT INTO lead_form_responses (nome, telefone, nivel) VALUES ('Sem', '123', 'A');
  -- os registros antigos continuam sem evento
  SELECT count(*) INTO n FROM crm_contato_eventos WHERE contact_phone IN ('5531999990001', '5531999990004');
  IF n <> 0 THEN RAISE EXCEPTION 'FALHOU: base antiga gerou evento'; END IF;
  RAISE NOTICE 'ok: formulário só novos, dados, isolamento de cliente';

  -- lead_qualificado só com ouvinte e nível <> DQ
  INSERT INTO crm_fluxos (nome, ativo, gatilho_tipo, gatilho_valor) VALUES ('FF', true, 'evento', 'lead_qualificado');
  INSERT INTO lead_form_responses (telefone, nivel) VALUES ('31999990007', 'B'), ('31999990008', 'DQ');
  SELECT count(*) INTO n FROM crm_contato_eventos WHERE valor = 'lead_qualificado';
  IF n <> 1 THEN RAISE EXCEPTION 'FALHOU: lead_qualificado %', n; END IF;
  RAISE NOTICE 'ok: lead_qualificado (nível <> DQ)';

  -- demais fontes
  INSERT INTO crm_fluxos (nome, ativo, gatilhos) VALUES ('G', true,
    '[{"tipo":"banco","fonte":"agendamento"},{"tipo":"banco","fonte":"compra"},{"tipo":"banco","fonte":"base_leads"},{"tipo":"banco","fonte":"contato_whatsapp"}]');
  INSERT INTO consultations (client_name, client_phone, via) VALUES ('Dani', '+55 31 99999-0009', 'Calendly');
  INSERT INTO sales_events (source, value, customer_phone) VALUES ('PAGTRUST', 297, '5531999990010'), ('PAGTRUST', -297, '5531999990011'), ('HOTMART', 10, '5531999990012');
  INSERT INTO base_leads (origem, origem_id, telefone_e164, nivel) VALUES ('sellflux', '2', '+5531999990013', 'A');
  INSERT INTO whatsapp_contacts (phone, source) VALUES ('5531999990014', 'whatsapp');
  INSERT INTO whatsapp_contacts (phone, is_group) VALUES ('120363000000@g.us', true);
  SELECT string_agg(valor || ':' || contact_phone, ',' ORDER BY id) INTO v FROM crm_contato_eventos WHERE valor LIKE 'banco_%' AND valor <> 'banco_formulario';
  IF v <> 'banco_agendamento:5531999990009,banco_compra:5531999990010,banco_base_leads:5531999990013,banco_contato_whatsapp:5531999990014' THEN
    RAISE EXCEPTION 'FALHOU: fontes %', v; END IF;
  RAISE NOTICE 'ok: agendamento, compra aprovada (estorno/outra fonte fora), base, WhatsApp (sem grupo)';

  -- fluxo excluído deixa de ouvir
  UPDATE crm_fluxos SET excluido_em = now() WHERE nome = 'G';
  INSERT INTO base_leads (origem, origem_id, telefone_e164) VALUES ('sellflux', '3', '+5531999990015');
  SELECT count(*) INTO n FROM crm_contato_eventos WHERE contact_phone = '5531999990015';
  IF n <> 0 THEN RAISE EXCEPTION 'FALHOU: fluxo excluído ainda ouve'; END IF;
  RAISE NOTICE 'ok: fluxo excluído não gera evento';

  -- entrada: tokens gerados no banco, rate limit
  INSERT INTO crm_fluxo_entradas (fluxo_id, limite_minuto) VALUES (f, 2);
  SELECT id_publico, token INTO v, v FROM crm_fluxo_entradas WHERE fluxo_id = f;
  IF length(v) <> 48 THEN RAISE EXCEPTION 'FALHOU: token %', v; END IF;
  SELECT id_publico INTO v FROM crm_fluxo_entradas WHERE fluxo_id = f;
  IF NOT crm_fluxo_entrada_bater(v) OR NOT crm_fluxo_entrada_bater(v) THEN RAISE EXCEPTION 'FALHOU: limite cedo demais'; END IF;
  IF crm_fluxo_entrada_bater(v) THEN RAISE EXCEPTION 'FALHOU: passou do limite'; END IF;
  UPDATE crm_fluxo_entradas SET janela_inicio = now() - interval '2 minutes' WHERE fluxo_id = f;
  IF NOT crm_fluxo_entrada_bater(v) THEN RAISE EXCEPTION 'FALHOU: janela não reabriu'; END IF;
  IF crm_fluxo_entrada_bater('nao-existe') THEN RAISE EXCEPTION 'FALHOU: id inexistente passou'; END IF;
  RAISE NOTICE 'ok: entrada com token gerado e rate limit por minuto';

  -- tags
  IF crm_tag_normalizar('  Lead Qualificado Ávaliação! ') <> 'lead-qualificado-avaliacao' THEN RAISE EXCEPTION 'FALHOU: normalizar %', crm_tag_normalizar('  Lead Qualificado Ávaliação! '); END IF;
  UPDATE whatsapp_contacts SET tags = '{comprou,vip}' WHERE phone = '5531999990003';
  UPDATE whatsapp_contacts SET tags = '{comprou}' WHERE phone = '5531999990014';
  UPDATE base_leads SET tags = '{Comprou}' WHERE origem_id = '1';
  UPDATE crm_fluxos SET passos = '[{"tipo":"tag","acao":"por","tag":"no-fluxo"},{"tipo":"condicao","condicao":{"tipo":"tem_tag","valor":"cond-tag"}}]' WHERE id = f;
  PERFORM crm_tag_criar('Nova Tag');
  SELECT string_agg(tag || '=' || uso, ',' ORDER BY tag) INTO v FROM crm_tags_existentes();
  IF v <> 'comprou=3,cond-tag=0,no-fluxo=0,nova-tag=0,vip=1' THEN RAISE EXCEPTION 'FALHOU: tags existentes %', v; END IF;
  SELECT array_to_string(variantes, '|') INTO v FROM crm_tags_existentes() WHERE tag = 'comprou';
  IF v <> 'Comprou|comprou' THEN RAISE EXCEPTION 'FALHOU: variantes %', v; END IF;
  RAISE NOTICE 'ok: crm_tags_existentes (união + contagem + variantes) e crm_tag_criar normaliza';

  -- eventos disponíveis (sem o interno webhook_<uuid>)
  INSERT INTO crm_contato_eventos (contact_phone, tipo, valor) VALUES ('5531999990016', 'evento', 'webhook_' || replace(f::text, '-', '')), ('5531999990016', 'evento', 'wh_carrinho');
  SELECT string_agg(valor, ',' ORDER BY valor) INTO v FROM crm_eventos_disponiveis();
  IF v LIKE '%webhook_%' OR v NOT LIKE '%wh_carrinho%' OR v NOT LIKE '%banco_formulario%' THEN RAISE EXCEPTION 'FALHOU: eventos disponíveis %', v; END IF;
  RAISE NOTICE 'ok: crm_eventos_disponiveis';
END $$;

-- RLS: não-admin não vê o token; admin vê
INSERT INTO teste_sessao SELECT NULL, false, true WHERE false;
GRANT SELECT ON crm_contato_eventos TO authenticated;
SET ROLE authenticated;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM crm_fluxo_entradas;
  IF n <> 0 THEN RAISE EXCEPTION 'FALHOU: não-admin viu % entradas', n; END IF;
  BEGIN PERFORM crm_fluxo_entrada_novo_token((SELECT gen_random_uuid())); RAISE EXCEPTION 'FALHOU: não-admin trocou token';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF; END;
  BEGIN PERFORM crm_fluxo_entrada_bater('x'); RAISE EXCEPTION 'FALHOU: authenticated chamou bater';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'ok: não-admin não lê entrada, não troca token, não chama o rate limit';
END $$;
RESET ROLE;
UPDATE teste_sessao SET admin = true;
SET ROLE authenticated;
DO $$ DECLARE n int; t1 text; t2 text; s text; BEGIN
  SELECT count(*) INTO n FROM crm_fluxo_entradas;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHOU: admin não viu a entrada'; END IF;
  SELECT token INTO t1 FROM crm_fluxo_entradas;
  t2 := crm_fluxo_entrada_novo_token((SELECT fluxo_id FROM crm_fluxo_entradas));
  IF t1 = t2 OR length(t2) <> 48 THEN RAISE EXCEPTION 'FALHOU: novo token'; END IF;
  s := crm_fluxo_entrada_assinatura((SELECT fluxo_id FROM crm_fluxo_entradas), true);
  IF length(s) <> 48 THEN RAISE EXCEPTION 'FALHOU: segredo'; END IF;
  RAISE NOTICE 'ok: admin lê, troca token e liga assinatura';
END $$;
RESET ROLE;

DO $$ DECLARE v text; BEGIN
  SELECT string_agg(chave, ',') INTO v FROM crm_segmento_listar('x', '{"tag":"nivel-a"}');
  IF v <> 'b' THEN RAISE EXCEPTION 'FALHOU: filtro antigo mudou %', v; END IF;
  SELECT string_agg(chave, ',') INTO v FROM crm_segmento_listar('x', '{"tag":"nivel-a","tagVariantes":["nivel-A","nivel-a"]}');
  IF v <> 'a,b' THEN RAISE EXCEPTION 'FALHOU: variantes no Banco %', v; END IF;
  SELECT string_agg(chave, ',') INTO v FROM crm_segmento_listar('x', '{}');
  IF v <> 'a,b,c' THEN RAISE EXCEPTION 'FALHOU: sem tag %', v; END IF;
  RAISE NOTICE 'ok: filtro de tag do Banco aceita as grafias (tagVariantes) sem mudar o resto';
END $$;
