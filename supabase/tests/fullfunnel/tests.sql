\set ON_ERROR_STOP on
SET client_min_messages = warning;
CREATE FUNCTION pg_temp.ok(cond boolean, nome text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', nome; END IF;
  RAISE NOTICE 'ok  %', nome;
END $$;
SET client_min_messages = notice;

-- 1. telefone_e164 ----------------------------------------------------------
SELECT pg_temp.ok(public.telefone_e164(i) IS NOT DISTINCT FROM esperado, format('e164(%L) = %L, veio %L', i, esperado, public.telefone_e164(i)))
FROM (VALUES
  ('+5531999998888',      '+5531999998888'),
  ('(31) 99999-8888',     '+5531999998888'),
  ('31999998888',         '+5531999998888'),
  ('5531999998888',       '+5531999998888'),
  ('55 31 99999-8888',    '+5531999998888'),
  ('+55 (31) 9999-8888',  '+5531999998888'),   -- celular antigo ganha o 9
  ('3199998888',          '+5531999998888'),
  ('3133334444',          '+553133334444'),    -- fixo fica com 8
  ('55999998888',         '+5555999998888'),   -- DDD 55 (RS) sem DDI: não confunde com o DDI
  ('5555999998888',       '+5555999998888'),
  ('031999998888',        NULL),               -- 12 díg. sem 55: ambíguo, não chuta
  ('+351912345678',       '+351912345678'),
  ('00351912345678',      '+351912345678'),
  ('+1 (415) 555-2671',   '+14155552671'),
  ('9999-8888',           NULL),
  ('',                    NULL),
  (NULL,                  NULL),
  ('abc',                 NULL),
  ('+55 00 90000-0000',   NULL)
) t(i, esperado);

-- 2. Desligado: nada sai ------------------------------------------------------
SET ROLE service_role;
INSERT INTO public.lead_form_responses (nome, telefone, nivel, score) VALUES ('Desligado Teste', '31911112222', 'A', 70);
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.fullfunnel_envios) = 0, 'desligado: nenhum envio');

-- 3. Ligado sem URL: envio fica em erro, sem chamada HTTP ---------------------
UPDATE public.integracao_config SET valor = 'true' WHERE chave = 'fullfunnel_ativo';
SET ROLE service_role;
INSERT INTO public.lead_form_responses (nome, telefone, nivel, score) VALUES ('Sem Url', '31911113333', 'B', 55);
RESET ROLE;
SELECT pg_temp.ok((SELECT status FROM public.fullfunnel_envios ORDER BY id DESC LIMIT 1) = 'erro', 'sem URL: status erro');
SELECT pg_temp.ok((SELECT count(*) FROM net.chamadas) = 0, 'sem URL: nenhuma chamada');

INSERT INTO public.integracao_config (chave, valor)
VALUES ('fullfunnel_webhook_url', 'https://services.leadconnectorhq.com/hooks/LOC/webhook-trigger/TESTE')
ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;

-- 4. Caminho feliz (insert como a edge function) ------------------------------
SET ROLE service_role;
INSERT INTO public.lead_form_responses (nome, telefone, instagram, nivel, score, origem, renda_mensal, utm_source, utm_campaign)
VALUES ('Maria da Silva Souza', '(31) 99999-8888', '@maria', 'A', 72, 'individual', '9k_15k', 'ig', 'camp1');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM net.chamadas) = 1, 'feliz: 1 chamada HTTP');
SELECT pg_temp.ok((SELECT url FROM net.chamadas ORDER BY id DESC LIMIT 1) = 'https://services.leadconnectorhq.com/hooks/LOC/webhook-trigger/TESTE', 'feliz: URL da config');
SELECT pg_temp.ok((SELECT body->>'phone' FROM net.chamadas ORDER BY id DESC LIMIT 1) = '+5531999998888', 'feliz: phone E.164');
SELECT pg_temp.ok((SELECT body->>'first_name' = 'Maria' AND body->>'last_name' = 'da Silva Souza' AND body->>'name' = 'Maria da Silva Souza'
                   FROM net.chamadas ORDER BY id DESC LIMIT 1), 'feliz: nome dividido');
SELECT pg_temp.ok((SELECT body->>'nivel' = 'A' AND (body->>'score')::int = 72 AND body->>'origem' = 'individual'
                   AND body->>'utm_source' = 'ig' AND body->>'teste' = 'false' AND body ? 'lead_id' AND body->>'tags' = 'lead-qualificado-site,nivel-a'
                   FROM net.chamadas ORDER BY id DESC LIMIT 1), 'feliz: campos do payload');
SELECT pg_temp.ok((SELECT status = 'enviado' AND tentativas = 1 AND request_id IS NOT NULL FROM public.fullfunnel_envios ORDER BY id DESC LIMIT 1), 'feliz: fila em enviado');

-- 5. Insert direto com a chave pública (anon) NÃO dispara ---------------------
SET ROLE anon;
INSERT INTO public.lead_form_responses (nome, telefone, nivel, score) VALUES ('Spam Anon', '11988887777', 'A', 99);
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.lead_form_responses WHERE nome = 'Spam Anon') = 1, 'anon: lead gravado');
SELECT pg_temp.ok((SELECT count(*) FROM net.chamadas WHERE body->>'name' = 'Spam Anon') = 0, 'anon: não dispara');

-- 6. DQ não dispara; insert do SQL editor (postgres) não dispara --------------
SET ROLE service_role;
INSERT INTO public.lead_form_responses (nome, telefone, nivel, score) VALUES ('Desqualificada', '11977776666', 'DQ', 10);
RESET ROLE;
INSERT INTO public.lead_form_responses (nome, telefone, nivel, score) VALUES ('Import Manual', '11966665555', 'A', 70);
SELECT pg_temp.ok((SELECT count(*) FROM net.chamadas WHERE body->>'name' IN ('Desqualificada', 'Import Manual')) = 0, 'DQ e postgres: não disparam');

-- 7. Mesmo telefone em 24 h: duplicado, sem nova chamada ----------------------
SET ROLE service_role;
INSERT INTO public.lead_form_responses (nome, telefone, nivel, score) VALUES ('Maria Repetida', '+5531999998888', 'A', 72);
RESET ROLE;
SELECT pg_temp.ok((SELECT status FROM public.fullfunnel_envios ORDER BY id DESC LIMIT 1) = 'duplicado', 'duplicado: status');
SELECT pg_temp.ok((SELECT count(*) FROM net.chamadas) = 1, 'duplicado: nenhuma chamada nova');

-- 8. Telefone inválido: sem_telefone ------------------------------------------
SET ROLE service_role;
INSERT INTO public.lead_form_responses (nome, telefone, nivel, score) VALUES ('Tel Ruim', '9999', 'C', 45);
RESET ROLE;
SELECT pg_temp.ok((SELECT status FROM public.fullfunnel_envios ORDER BY id DESC LIMIT 1) = 'sem_telefone', 'telefone ruim: sem_telefone');

-- 9. pg_net quebrado não impede gravar o lead --------------------------------
INSERT INTO net.falhar VALUES (true);
SET ROLE service_role;
INSERT INTO public.lead_form_responses (nome, telefone, nivel, score) VALUES ('Rede Caiu', '21988880000', 'A', 70);
RESET ROLE;
DELETE FROM net.falhar;
SELECT pg_temp.ok((SELECT count(*) FROM public.lead_form_responses WHERE nome = 'Rede Caiu') = 1, 'pg_net quebrado: lead gravado mesmo assim');
SELECT pg_temp.ok((SELECT status = 'erro' AND tentativas = 0 FROM public.fullfunnel_envios WHERE payload->>'name' = 'Rede Caiu'), 'pg_net quebrado: envio fica em erro na fila');

-- 10. Conferência: 200 -> ok; 500 -> reenvia; 3 tentativas -> falhou ----------
INSERT INTO net._http_response (id, status_code, content)
SELECT request_id, 200, '{"status":"Success"}' FROM public.fullfunnel_envios WHERE payload->>'name' = 'Maria da Silva Souza';
-- o "Sem Url" (status erro, 0 tentativas) é reenviado agora que existe URL
SELECT public.fullfunnel_conferir();
SELECT pg_temp.ok((SELECT status = 'ok' AND http_status = 200 FROM public.fullfunnel_envios WHERE payload->>'name' = 'Maria da Silva Souza'), 'conferir: 200 vira ok');
SELECT pg_temp.ok((SELECT status = 'enviado' AND tentativas = 1 FROM public.fullfunnel_envios WHERE payload->>'name' = 'Sem Url'), 'conferir: erro sem URL é reenviado');
SELECT pg_temp.ok((SELECT status = 'enviado' AND tentativas = 1 FROM public.fullfunnel_envios WHERE payload->>'name' = 'Rede Caiu'), 'conferir: envio que pegou pg_net fora é reenviado');

INSERT INTO net._http_response (id, status_code, content)
SELECT request_id, 500, 'erro do servidor' FROM public.fullfunnel_envios WHERE payload->>'name' = 'Sem Url';
SELECT public.fullfunnel_conferir();
SELECT pg_temp.ok((SELECT status = 'enviado' AND tentativas = 2 FROM public.fullfunnel_envios WHERE payload->>'name' = 'Sem Url'), 'conferir: 500 reenvia (tentativa 2)');
INSERT INTO net._http_response (id, status_code, content)
SELECT request_id, 500, 'erro do servidor' FROM public.fullfunnel_envios WHERE payload->>'name' = 'Sem Url';
SELECT public.fullfunnel_conferir();
INSERT INTO net._http_response (id, status_code, content)
SELECT request_id, 500, 'erro do servidor' FROM public.fullfunnel_envios WHERE payload->>'name' = 'Sem Url';
SELECT public.fullfunnel_conferir();
SELECT pg_temp.ok((SELECT status = 'falhou' AND tentativas = 3 FROM public.fullfunnel_envios WHERE payload->>'name' = 'Sem Url'), 'conferir: 3 tentativas viram falhou');

-- sem resposta há mais de 30 min conta como erro e reenvia
UPDATE public.fullfunnel_envios SET status = 'enviado', request_id = 999999, tentativas = 1, atualizado_em = now() - interval '40 minutes'
 WHERE payload->>'name' = 'Maria Repetida';
SELECT public.fullfunnel_conferir();
SELECT pg_temp.ok((SELECT status = 'enviado' AND tentativas = 2 FROM public.fullfunnel_envios WHERE payload->>'name' = 'Maria Repetida'), 'conferir: sem resposta 30 min reenvia');

-- 11. Amostra ---------------------------------------------------------------
SELECT public.fullfunnel_enviar_amostra();
SELECT pg_temp.ok((SELECT status FROM public.fullfunnel_envios ORDER BY id DESC LIMIT 1) = 'amostra_enviada', 'amostra: status');
SELECT pg_temp.ok((SELECT body->>'teste' = 'true' AND body->>'phone' = '+5500900000000' AND body->>'name' = 'Amostra Teste Fullfunnel'
                   FROM net.chamadas ORDER BY id DESC LIMIT 1), 'amostra: dados falsos e teste=true');
SELECT pg_temp.ok((SELECT array_agg(k ORDER BY k) FROM net.chamadas c, jsonb_object_keys(c.body) k WHERE c.id = (SELECT max(id) FROM net.chamadas))
                = (SELECT array_agg(k ORDER BY k) FROM net.chamadas c, jsonb_object_keys(c.body) k WHERE c.body->>'name' = 'Maria da Silva Souza'),
                'amostra: mesmas chaves do envio real');
\t on
\a
\o amostra-payload.json
SELECT jsonb_pretty(body - 'criado_em' || jsonb_build_object('criado_em', '2026-10-13T12:00:00Z')) FROM net.chamadas ORDER BY id DESC LIMIT 1;
\o
\a
\t off

-- 12. API pública não enxerga nem chama nada ----------------------------------
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.fullfunnel_enviar_amostra(); RAISE EXCEPTION 'anon chamou amostra';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.integracao_config; RAISE EXCEPTION 'anon leu integracao_config';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.fullfunnel_envios; RAISE EXCEPTION 'anon leu fullfunnel_envios';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.fullfunnel_enfileirar(gen_random_uuid()); RAISE EXCEPTION 'anon chamou enfileirar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.integracao_config; RAISE EXCEPTION 'authenticated leu integracao_config';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.fullfunnel_conferir(); RAISE EXCEPTION 'authenticated chamou conferir';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.ok(true, 'anon/authenticated barrados (config, fila, funções)');

-- 13. Cron agendado ---------------------------------------------------------
SELECT pg_temp.ok((SELECT schedule = '*/5 * * * *' FROM cron.job WHERE jobname = 'fullfunnel-conferir'), 'cron agendado a cada 5 min');
