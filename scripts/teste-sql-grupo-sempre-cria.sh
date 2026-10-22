#!/usr/bin/env bash
# Teste da migration 20261122110000_grupos_sempre_cria.sql num Postgres DESCARTÁVEL (cluster temporário, apagado
# no fim). Nunca conecta no Supabase, não cria grupo, não manda mensagem. Precisa de initdb/pg_ctl/psql no PATH.
#   bash scripts/teste-sql-grupo-sempre-cria.sh
# Roda as migrations REAIS do módulo de grupos em ordem (só stubs do que é do Supabase: auth, storage, pg_net,
# pg_cron, crm_numeros, base_leads, whatsapp_contacts), semeia dados ANTES da nova (campanhas antigas sem criação,
# pendências repetidas), roda a nova duas vezes e confere: criação ligada nas existentes · Avulsos fora · CHECK
# sem exigir admin · 1 criação em andamento por campanha · link lotado espera (sem url_lotado) com UTM e telefone ·
# consulta com token não duplica clique · grupo novo resolve o MESMO clique · pausado usa a URL · chamada antiga
# (5 parâmetros) funciona · anon não chama o lead · tick acorda para criar sem auto_criar e respeita trava/admin.
set -euo pipefail
export LC_ALL=C LANG=C # postmaster no macOS recusa subir com locale inválido
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
MIG="${MIG_DIR:-$RAIZ/supabase/migrations}"
TMP="$(mktemp -d /tmp/tsqlgr.XXXXXX)" # caminho curto: o soquete Unix tem limite de ~100 caracteres
PORTA="${PORTA:-54331}"
trap 'pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

initdb -D "$TMP/db" -U postgres -A trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -h "$TMP" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('teste.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('teste.role', true), '') $$;
CREATE FUNCTION public.is_approved(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT u IS NOT NULL $$;
CREATE SCHEMA extensions;
-- pg_net falso: só registra a chamada
CREATE SCHEMA net;
CREATE TABLE public.teste_http (id serial PRIMARY KEY, url text, body jsonb, em timestamptz DEFAULT now());
CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int) RETURNS bigint
LANGUAGE sql AS $$ INSERT INTO public.teste_http (url, body) VALUES (url, body) RETURNING id::bigint $$;
CREATE SCHEMA cron;
CREATE FUNCTION cron.schedule(a text, b text, c text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid(), bucket_id text, name text);
CREATE TABLE public.crm_numeros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chave text UNIQUE, apelido text, tipo text DEFAULT 'openwa',
  sessao_openwa text, ativo boolean DEFAULT true
);
CREATE TABLE public.base_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), origem text, origem_id text, nome text, telefone_e164 text, email text,
  tags text[], produto text, status text, criado_origem timestamptz, UNIQUE (origem, origem_id)
);
CREATE TABLE public.whatsapp_contacts (
  phone text PRIMARY KEY, name text, source text, tags text[] DEFAULT '{}', updated_at timestamptz DEFAULT now()
);
SQL

# migrations reais do módulo, em ordem (sem CREATE EXTENSION: pg_net/pg_cron não existem no Postgres puro)
grep -v '^CREATE EXTENSION' "$MIG/20261024130000_grupos_whatsapp.sql" | "${PSQL[@]}" >/dev/null
for m in 20261106100000_grupos_fluxo_campanha 20261108110000_disparo_grupos 20261109110000_grupos_dedupe_evento_e_tick 20261110100000_grupos_painel_sendflow; do
  "${PSQL[@]}" -f "$MIG/$m.sql" >/dev/null
done
echo "ok   migrations antigas do módulo aplicadas"

# dados de ANTES da nova migration
"${PSQL[@]}" <<'SQL'
INSERT INTO crm_numeros (id, chave, apelido, sessao_openwa) VALUES
  ('11111111-1111-1111-1111-111111111111', 'grupos-1', 'Grupos 1', 'grupos-1'),
  ('22222222-2222-2222-2222-222222222222', 'pessoal', 'Pessoal', 'pessoal');
INSERT INTO grupos_campanhas (id, nome, slug, numero_id, limite_por_grupo, url_lotado, auto_criar, prefixo_nome, admins_telefones, folga_vagas)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Antiga sem criação', 'grupo-antiga', '11111111-1111-1111-1111-111111111111',
        10, 'https://reserva.exemplo/lotado', false, '', '{}', 2);
SELECT public.grupos_campanha_avulsa('11111111-1111-1111-1111-111111111111');
-- duas pendências na mesma campanha (estado que o índice novo não aceita)
INSERT INTO grupos_criacoes (campanha_id, numero, nome, status, created_at) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 1, 'Velha 01', 'erro', now() - interval '2 hours'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 2, 'Nova 02', 'criando', now() - interval '1 hour');
SQL

"${PSQL[@]}" -f "$MIG/20261122110000_grupos_sempre_cria.sql" >/dev/null
"${PSQL[@]}" -f "$MIG/20261122110000_grupos_sempre_cria.sql" >/dev/null
echo "ok   migration nova roda 2x sem erro (idempotente)"

"${PSQL[@]}" <<'SQL'
\set QUIET on
DO $$
DECLARE
  camp uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v boolean; n int; s text;
BEGIN
  SELECT auto_criar INTO v FROM grupos_campanhas WHERE id = camp;
  ASSERT v, 'campanha existente não ficou com criação ligada';
  SELECT auto_criar INTO v FROM grupos_campanhas WHERE avulsa;
  ASSERT NOT v, 'Avulsos não pode criar grupo';
  SELECT status INTO s FROM grupos_criacoes WHERE nome = 'Velha 01';
  ASSERT s = 'abandonada', 'pendência repetida antiga não foi abandonada: ' || s;
  SELECT status INTO s FROM grupos_criacoes WHERE nome = 'Nova 02';
  ASSERT s = 'criando', 'a pendência mais nova deveria continuar';
  -- campanha nova nasce criando e sem admin/prefixo (CHECK antigo recusaria)
  INSERT INTO grupos_campanhas (nome, slug, numero_id) VALUES ('Nova', 'grupo-nova', '11111111-1111-1111-1111-111111111111');
  SELECT auto_criar INTO v FROM grupos_campanhas WHERE slug = 'grupo-nova';
  ASSERT v, 'campanha nova deveria nascer com criação ligada';
  -- 1 criação em andamento por campanha
  BEGIN
    INSERT INTO grupos_criacoes (campanha_id, numero, nome, status) VALUES (camp, 3, 'Terceira 03', 'erro');
    RAISE EXCEPTION 'aceitou 2 criações em andamento';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- concluir a pendente libera a próxima
  UPDATE grupos_criacoes SET status = 'ok' WHERE nome = 'Nova 02';
  INSERT INTO grupos_criacoes (campanha_id, numero, nome, status) VALUES (camp, 3, 'Terceira 03', 'criando');
  SELECT count(*) INTO n FROM grupos_criacoes WHERE campanha_id = camp AND status IN ('criando', 'erro');
  ASSERT n = 1, 'deveria haver exatamente 1 em andamento';
  UPDATE grupos_criacoes SET status = 'ok' WHERE nome = 'Terceira 03';
END $$;
SQL
echo "ok   criação ligada nas existentes, Avulsos fora, CHECK sem admin, 1 em andamento por campanha"

"${PSQL[@]}" <<'SQL'
\set QUIET on
-- grupo cheio (10/10) sem chat_id: não mexe no tick
INSERT INTO grupos_campanha_grupos (campanha_id, ordem, nome, link_convite, participantes, participantes_em)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 0, 'Antiga 01', 'https://chat.whatsapp.com/AAAAAAAAAAAAAAAAAAAA', 10, now());
CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb);
GRANT ALL ON r TO anon;
SET ROLE anon;
INSERT INTO r VALUES ('lotado', public.grupos_resolver_link('grupo-antiga', '11 99999-8888', 'Ana', 'ana@x.com',
  '{"utm_source":"meta","utm_campaign":"c1","lixo":"x"}'::jsonb));
RESET ROLE;
DO $$
DECLARE j jsonb := (SELECT v FROM r WHERE k = 'lotado'); n int; c record;
BEGIN
  ASSERT j->>'erro' = 'lotado' AND (j->>'aguardando')::boolean AND (j->>'criando')::boolean, 'lotado deveria aguardar: ' || j::text;
  ASSERT j->'url' = 'null'::jsonb, 'lotado NÃO pode usar url_lotado: ' || j::text;
  ASSERT j->>'espera' ~ '^[0-9a-f-]{36}$', 'sem token de espera';
  SELECT count(*) INTO n FROM grupos_cliques; ASSERT n = 1, 'esperado 1 clique';
  SELECT * INTO c FROM grupos_cliques LIMIT 1;
  ASSERT c.resultado = 'aguardando' AND c.esperou, 'clique deveria ser aguardando';
  ASSERT c.telefone_e164 = '+5511999998888', 'telefone perdido: ' || coalesce(c.telefone_e164, 'null');
  ASSERT c.utm = '{"utm_source":"meta","utm_campaign":"c1"}'::jsonb, 'UTM perdido/sujo: ' || c.utm::text;
  SELECT count(*) INTO n FROM base_leads WHERE telefone_e164 = '+5511999998888'; ASSERT n = 1, 'lead não registrado na espera';
END $$;
SQL
echo "ok   lotado: aguardando com token, sem url_lotado, UTM/telefone no clique, lead registrado"

"${PSQL[@]}" <<'SQL'
\set QUIET on
CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb);
GRANT ALL ON r TO anon;
-- token do primeiro clique
INSERT INTO r SELECT 'tok', to_jsonb(espera_token) FROM grupos_cliques WHERE resultado = 'aguardando';
SET ROLE anon;
-- 3 consultas ainda lotado (o front consulta a cada 3 s, sem telefone/UTM)
INSERT INTO r SELECT 'p' || i, public.grupos_resolver_link('grupo-antiga', NULL, NULL, NULL, '{}'::jsonb, (SELECT (v#>>'{}')::uuid FROM r WHERE k = 'tok'))
  FROM generate_series(1, 3) i;
RESET ROLE;
DO $$
DECLARE n int; j jsonb := (SELECT v FROM r WHERE k = 'p3');
BEGIN
  ASSERT j->>'espera' = (SELECT v#>>'{}' FROM r WHERE k = 'tok'), 'token mudou na consulta';
  SELECT count(*) INTO n FROM grupos_cliques; ASSERT n = 1, 'consulta com token duplicou clique: ' || n;
END $$;
-- o disparador cria o grupo novo (simulado: a linha que a edge grava)
INSERT INTO grupos_campanha_grupos (campanha_id, ordem, nome, link_convite, chat_id, criado_pelo_crm, participantes, participantes_em)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 1, 'Antiga 02', 'https://chat.whatsapp.com/BBBBBBBBBBBBBBBBBBBB', '120363000000000002@g.us', true, 2, now());
SET ROLE anon;
INSERT INTO r VALUES ('resolvido', public.grupos_resolver_link('grupo-antiga', NULL, NULL, NULL, '{}'::jsonb, (SELECT (v#>>'{}')::uuid FROM r WHERE k = 'tok')));
INSERT INTO r VALUES ('repetido', public.grupos_resolver_link('grupo-antiga', NULL, NULL, NULL, '{}'::jsonb, (SELECT (v#>>'{}')::uuid FROM r WHERE k = 'tok')));
RESET ROLE;
DO $$
DECLARE j jsonb := (SELECT v FROM r WHERE k = 'resolvido'); j2 jsonb := (SELECT v FROM r WHERE k = 'repetido'); c record; n int;
BEGIN
  ASSERT j->>'url' = 'https://chat.whatsapp.com/BBBBBBBBBBBBBBBBBBBB', 'não redirecionou ao grupo novo: ' || j::text;
  ASSERT j2->>'url' = j->>'url', 'consulta repetida deveria devolver o mesmo grupo';
  SELECT count(*) INTO n FROM grupos_cliques; ASSERT n = 1, 'resolver criou clique novo: ' || n;
  SELECT * INTO c FROM grupos_cliques LIMIT 1;
  ASSERT c.resultado = 'grupo' AND c.esperou AND c.grupo_id IS NOT NULL, 'o MESMO clique deveria virar grupo (esperou)';
  ASSERT c.telefone_e164 = '+5511999998888' AND c.utm ? 'utm_source', 'perdeu telefone/UTM ao resolver';
  SELECT cliques INTO n FROM grupos_campanha_grupos WHERE nome = 'Antiga 02'; ASSERT n = 1, 'clique contado ' || n || 'x no grupo';
END $$;
SQL
echo "ok   espera: consultas não duplicam clique; grupo novo resolve o MESMO clique (esperou, UTM e telefone mantidos)"

"${PSQL[@]}" <<'SQL'
\set QUIET on
CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb);
GRANT ALL ON r TO anon;
SET ROLE anon;
-- chamada do front antigo (5 parâmetros nomeados), com vaga
INSERT INTO r VALUES ('antiga', public.grupos_resolver_link(p_slug => 'grupo-antiga', p_tel => NULL, p_nome => NULL, p_email => NULL, p_utm => '{}'::jsonb));
-- token de outra campanha/inventado: ignorado (vira clique novo normal)
INSERT INTO r VALUES ('tok_falso', public.grupos_resolver_link('grupo-antiga', NULL, NULL, NULL, '{}'::jsonb, gen_random_uuid()));
RESET ROLE;
UPDATE grupos_campanhas SET link_pausado = true WHERE slug = 'grupo-antiga';
SET ROLE anon;
INSERT INTO r VALUES ('pausado', public.grupos_resolver_link('grupo-antiga'));
RESET ROLE;
DO $$
DECLARE n int;
BEGIN
  ASSERT (SELECT v->>'url' FROM r WHERE k = 'antiga') = 'https://chat.whatsapp.com/BBBBBBBBBBBBBBBBBBBB', 'chamada de 5 parâmetros quebrou';
  ASSERT (SELECT v->>'url' FROM r WHERE k = 'tok_falso') LIKE 'https://chat.whatsapp.com/%', 'token falso deveria seguir como clique normal';
  ASSERT (SELECT v->>'erro' FROM r WHERE k = 'pausado') = 'pausado', 'pausado';
  ASSERT (SELECT v->>'url' FROM r WHERE k = 'pausado') = 'https://reserva.exemplo/lotado', 'pausado deveria usar a URL de pausa';
  SELECT count(*) INTO n FROM grupos_cliques WHERE resultado = 'pausado'; ASSERT n = 1, 'clique pausado';
  SELECT count(*) INTO n FROM grupos_cliques WHERE resultado = 'grupo' AND NOT esperou; ASSERT n = 2, 'cliques normais: ' || n;
  ASSERT has_function_privilege('anon', 'public.grupos_resolver_link(text,text,text,text,jsonb,uuid)', 'EXECUTE'), 'anon sem o link';
  ASSERT NOT has_function_privilege('anon', 'public.grupos_link_lead(uuid,text,text,text)', 'EXECUTE'), 'anon chama o lead direto';
  SELECT count(*) INTO n FROM pg_proc WHERE proname = 'grupos_resolver_link'; ASSERT n = 1, 'duas versões do link: ' || n;
END $$;
UPDATE grupos_campanhas SET link_pausado = false WHERE slug = 'grupo-antiga';
SQL
echo "ok   chamada antiga (5 parâmetros), token falso ignorado, pausado usa a URL, anon não chama o lead, 1 versão só"

"${PSQL[@]}" <<'SQL'
\set QUIET on
DO $$
DECLARE s text; camp uuid;
BEGIN
  -- isola: só uma campanha "precisando" de grupo, sem auto_criar (prova que o tick não olha mais a coluna)
  UPDATE grupos_campanhas SET encerrada = true WHERE slug = 'grupo-nova';
  UPDATE grupos_campanha_grupos SET participantes_em = now();
  INSERT INTO grupos_campanhas (nome, slug, numero_id, auto_criar, admins_telefones, folga_vagas, limite_por_grupo)
  VALUES ('Tick', 'grupo-tick', '11111111-1111-1111-1111-111111111111', false, '{5511988887777}', 5, 10) RETURNING id INTO camp;
  UPDATE grupos_campanhas SET encerrada = true WHERE slug = 'grupo-antiga';
  DELETE FROM teste_http;
  s := public.grupos_disparo_tick();
  ASSERT s = 'chamado', 'tick deveria acordar para criar (sem auto_criar): ' || s;
  -- trava com hora marcada: não acorda antes
  UPDATE grupos_campanhas SET criacao_retomar_em = now() + interval '1 hour' WHERE id = camp;
  s := public.grupos_disparo_tick(); ASSERT s = 'nada a fazer', 'acordou com trava marcada: ' || s;
  UPDATE grupos_campanhas SET criacao_retomar_em = now() - interval '1 second' WHERE id = camp;
  s := public.grupos_disparo_tick(); ASSERT s = 'chamado', 'trava vencida deveria acordar: ' || s;
  -- sem admin: o WhatsApp não cria, não acorda à toa
  UPDATE grupos_campanhas SET admins_telefones = '{}' WHERE id = camp;
  s := public.grupos_disparo_tick(); ASSERT s = 'nada a fazer', 'acordou sem admin: ' || s;
  -- número que não é de grupos: não acorda
  UPDATE grupos_campanhas SET admins_telefones = '{5511988887777}', numero_id = '22222222-2222-2222-2222-222222222222' WHERE id = camp;
  s := public.grupos_disparo_tick(); ASSERT s = 'nada a fazer', 'acordou com número que não cria: ' || s;
  -- Avulsos nunca
  INSERT INTO crm_numeros (id, chave, apelido, sessao_openwa) VALUES ('33333333-3333-3333-3333-333333333333', 'grupos-2', 'Grupos 2', 'grupos-2');
  UPDATE grupos_campanhas SET numero_id = '33333333-3333-3333-3333-333333333333' WHERE id = camp;
  s := public.grupos_disparo_tick(); ASSERT s = 'chamado', 'grupos-2 também cria: ' || s;
  UPDATE grupos_campanhas SET avulsa = true WHERE id = camp;
  s := public.grupos_disparo_tick(); ASSERT s = 'nada a fazer', 'acordou para Avulsos: ' || s;
END $$;
SQL
echo "ok   tick acorda para criar sem auto_criar; respeita trava marcada, admin, número de grupos e Avulsos"
echo "TUDO OK"
