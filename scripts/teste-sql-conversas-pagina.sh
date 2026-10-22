#!/usr/bin/env bash
# Teste da migration 20261206100000 (crm_conversas_pagina rápida) num Postgres DESCARTÁVEL (cluster temporário,
# apagado no fim). Nunca conecta no Supabase. Precisa de initdb/pg_ctl/psql no PATH.
#   bash scripts/teste-sql-conversas-pagina.sh
# Monta o mínimo do schema (whatsapp_contacts/messages, permissões do CRM com as funções reais da 20261123100000 e
# as policies "crm_acesso: ler" no formato da 20261123110000), 30 mil contatos e ~430 mil mensagens, aplica a
# 20261126100000 (versão antiga) e a nova com o nome crm_conversas_pagina_v2, e confere:
#   1) as duas devolvem exatamente as mesmas linhas, na mesma ordem (contato, ultima, nao_lidas, ordem_em), em 18
#      cenários x até 3 páginas, para admin, restrito por número + "só as dele" e restrito por departamento;
#   2) o tempo (média de 5 chamadas) de cada uma nos cenários principais.
set -euo pipefail
export LC_ALL=C LANG=C
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$RAIZ/supabase/migrations"
TMP="$(mktemp -d /tmp/tsqlcp.XXXXXX)"
PORTA="${PORTA:-54332}"
trap 'pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
initdb -D "$TMP/db" -U postgres -A trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

echo "== montando schema e dados (1-2 min)"
"${PSQL[@]}" <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TYPE public.app_role AS ENUM ('admin','user');
CREATE TABLE public.user_roles (user_id uuid, role app_role);
CREATE FUNCTION public.is_approved(u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT u IS NOT NULL $$;
CREATE TABLE public.crm_numeros (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text, padrao boolean DEFAULT false);
CREATE FUNCTION public.crm_numero_padrao_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM public.crm_numeros WHERE padrao LIMIT 1 $$;
CREATE TABLE public.crm_acessos (user_id uuid PRIMARY KEY, todos_numeros boolean NOT NULL DEFAULT false, numeros uuid[] NOT NULL DEFAULT '{}',
  areas jsonb NOT NULL DEFAULT '{}', so_minhas boolean NOT NULL DEFAULT false, so_departamentos boolean NOT NULL DEFAULT false, acoes jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.crm_departamentos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text, regra text NOT NULL DEFAULT 'manual');
CREATE TABLE public.crm_departamento_membros (departamento_id uuid, user_id uuid, PRIMARY KEY (departamento_id, user_id));
CREATE TABLE public.whatsapp_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), numero_id uuid, phone text NOT NULL, name text, ai_agent_slug text, ai_pausado boolean,
  is_group boolean DEFAULT false, atendente_id uuid, departamento_id uuid, stage text, tags text[], notes text, extra jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE (numero_id, phone));
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), numero_id uuid, contact_phone text, body text, caption text, created_at timestamptz,
  direction text, sender_type text, status text, media_url text, media_type text, mime_type text, file_name text, message_id text,
  author_name text, author_phone text, author_id text, media_path text, media_status text, importada boolean NOT NULL DEFAULT false, raw jsonb);
CREATE INDEX idx_whatsapp_messages_numero_phone_created ON public.whatsapp_messages (numero_id, contact_phone, created_at DESC);
CREATE INDEX whatsapp_contacts_atendente_idx ON public.whatsapp_contacts (atendente_id) WHERE atendente_id IS NOT NULL;
CREATE INDEX whatsapp_contacts_departamento_idx ON public.whatsapp_contacts (departamento_id) WHERE departamento_id IS NOT NULL;
CREATE INDEX whatsapp_contacts_numero_updated_idx ON public.whatsapp_contacts (numero_id, updated_at DESC);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE FUNCTION public.crm_acoes() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['conversas.enviar','conversas.transferir']::text[] $$;
SQL
sed -n '/^CREATE OR REPLACE FUNCTION public.crm_eh_admin/,/^-- Uma conversa/p' "$MIG/20261123100000_crm_permissoes_estrutura.sql" | sed '$d' | "${PSQL[@]}"
"${PSQL[@]}" <<'SQL'
SELECT setseed(0.42);
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-0000000000b1'),('00000000-0000-0000-0000-0000000000b2'),
 ('00000000-0000-0000-0000-0000000000c1'),('00000000-0000-0000-0000-0000000000c2');
INSERT INTO user_roles VALUES ('00000000-0000-0000-0000-00000000000a','admin');
INSERT INTO crm_numeros (id, nome, padrao) VALUES ('10000000-0000-0000-0000-000000000001','closer',true),('10000000-0000-0000-0000-000000000002','sdr',false),
 ('10000000-0000-0000-0000-000000000003','fit',false),('10000000-0000-0000-0000-000000000004','cs',false);
INSERT INTO crm_departamentos (id, nome, regra) VALUES ('20000000-0000-0000-0000-000000000001','IA','ia'),('20000000-0000-0000-0000-000000000002','Vendas','manual'),
 ('20000000-0000-0000-0000-000000000003','Suporte','manual'),('20000000-0000-0000-0000-000000000004','Financeiro','manual');
-- b1: 2 números, só as dele · b2: todos os números, só dos departamentos (Vendas)
INSERT INTO crm_acessos (user_id, todos_numeros, numeros, areas, so_minhas, so_departamentos) VALUES
 ('00000000-0000-0000-0000-0000000000b1', false, '{10000000-0000-0000-0000-000000000001,10000000-0000-0000-0000-000000000002}', '{"conversas":"editar"}', true, false),
 ('00000000-0000-0000-0000-0000000000b2', true, '{}', '{"conversas":"ver"}', false, true);
INSERT INTO crm_departamento_membros VALUES ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b2');
INSERT INTO whatsapp_contacts (numero_id, phone, name, ai_agent_slug, ai_pausado, is_group, atendente_id, departamento_id, stage, tags, notes, extra)
SELECT ('10000000-0000-0000-0000-00000000000' || (1 + (i % 4)))::uuid,
       CASE WHEN i % 20 = 0 THEN '1203630' || lpad(i::text, 11, '0') || '@g.us' ELSE '55' || (11000000000 + i)::text END,
       (ARRAY['João','Maria','Ana Paula','José','Lúcia','Pedro','Fernanda','Carlos'])[1 + i % 8] || ' ' || i,
       CASE WHEN i % 10 = 0 THEN 'closer-ia' END, (i % 30 = 0), i % 20 = 0,
       (ARRAY[NULL,'00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2',NULL]::uuid[])[1 + i % 5],
       (ARRAY[NULL,'20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004',NULL,NULL]::uuid[])[1 + i % 6],
       (ARRAY['novo','qualificado','proposta','fechado'])[1 + i % 4],
       CASE WHEN i % 7 = 0 THEN ARRAY['quente'] WHEN i % 11 = 0 THEN ARRAY['frio','retorno'] ELSE '{}' END,
       repeat('anotação ', 30), jsonb_build_object('origem','meta','utm', md5(i::text))
  FROM generate_series(1, 30000) i;
-- 80% com conversa; ~18 mensagens em média
INSERT INTO whatsapp_messages (numero_id, contact_phone, body, created_at, direction, sender_type, status, importada, raw)
SELECT c.numero_id, c.phone, 'mensagem ' || g || ' de ' || c.name,
       now() - (random() * interval '180 days'),
       CASE WHEN random() < 0.5 THEN 'outbound' ELSE 'inbound' END, 'human', 'read', random() < 0.3,
       jsonb_build_object('k', md5(g::text))
  FROM whatsapp_contacts c
  CROSS JOIN LATERAL generate_series(1, (random() * 36)::int + (c.id::text < 'f')::int * 0) g
 WHERE right(c.name, 1) NOT IN ('0','5');
ALTER TABLE whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aprovado ler" ON whatsapp_contacts FOR SELECT TO authenticated USING ((SELECT is_approved((SELECT auth.uid()))));
CREATE POLICY "aprovado ler" ON whatsapp_messages FOR SELECT TO authenticated USING ((SELECT is_approved((SELECT auth.uid()))));
CREATE POLICY "crm_acesso: ler" ON whatsapp_contacts AS RESTRICTIVE FOR SELECT TO authenticated USING (
  (SELECT public.crm_pode((SELECT auth.uid()), '{conversas,kanban}'::text[], 1)) AND (
  numero_id = ANY ((SELECT public.crm_numeros_do_usuario((SELECT auth.uid())))::uuid[]) AND ((SELECT NOT public.crm_so_minhas((SELECT auth.uid()))) OR atendente_id IS NULL OR atendente_id = (SELECT auth.uid()))
  AND ((SELECT NOT public.crm_so_departamentos((SELECT auth.uid()))) OR departamento_id IS NULL
  OR departamento_id = ANY ((SELECT public.crm_meus_departamentos((SELECT auth.uid())))::uuid[]))));
CREATE POLICY "crm_acesso: ler" ON whatsapp_messages AS RESTRICTIVE FOR SELECT TO authenticated USING (
  (SELECT public.crm_pode((SELECT auth.uid()), '{conversas,kanban}'::text[], 1)) AND (
  numero_id = ANY ((SELECT public.crm_numeros_do_usuario((SELECT auth.uid())))::uuid[]) AND ((SELECT public.crm_ve_todas_conversas((SELECT auth.uid()))) OR EXISTS (SELECT 1 FROM public.whatsapp_contacts c
  WHERE c.numero_id = whatsapp_messages.numero_id AND c.phone = whatsapp_messages.contact_phone))));
SQL
"${PSQL[@]}" -f "$MIG/20261126100000_crm_conversas_lista_paginada.sql" >/dev/null 2>&1
sed 's/public\.crm_conversas_pagina(/public.crm_conversas_pagina_v2(/g' "$MIG/20261206100000_crm_conversas_pagina_rapida.sql" | "${PSQL[@]}" >/dev/null 2>&1
"${PSQL[@]}" <<'SQL'
-- grupos com conversa, mudanças recentes (delta) e empates de ordem
INSERT INTO whatsapp_messages (numero_id, contact_phone, body, caption, created_at, direction, importada)
SELECT c.numero_id, c.phone, 'aviso do grupo ' || g, CASE WHEN g = 1 THEN 'Promoção Lúcia' END, now() - (g || ' hours')::interval, 'inbound', false
  FROM whatsapp_contacts c CROSS JOIN generate_series(1, 5) g WHERE c.is_group AND right(c.name, 2) IN ('20','40','60');
UPDATE whatsapp_contacts SET notes = notes WHERE right(name, 3) = '777';
-- dez contatos com a MESMA ultima_msg_em (empate resolvido pelo id)
UPDATE whatsapp_contacts SET ultima_msg_em = '2026-10-20 12:00:00+00' WHERE id IN (SELECT id FROM whatsapp_contacts WHERE ultima_msg_em IS NOT NULL ORDER BY md5(id::text) LIMIT 10);
ANALYZE;
SQL

echo "== 1) antiga x nova, linha a linha"
cat > "$TMP/compara.sql" <<'SQL'
-- compara crm_conversas_pagina (antiga) x crm_conversas_pagina_v2 (nova): 3 páginas por cenário, linha a linha
-- (contato, ultima, nao_lidas, ordem_em — só consultado_em fica de fora, é o now()). Rodar como authenticated.
DO $$
DECLARE
  u text; cen record; pag int; ant jsonb; nov jsonb; cur_em timestamptz; cur_id uuid; nlin int;
  total int := 0; difs int := 0; linhas_total bigint := 0;
  leit jsonb; desde timestamptz;
BEGIN
  u := current_setting('request.jwt.claims')::json->>'sub';
  -- leituras reais: 300 conversas lidas em horários variados (chave número|fone e só fone)
  SELECT jsonb_object_agg(CASE WHEN i % 2 = 0 THEN numero_id::text || '|' || phone ELSE phone END,
                          to_char((ultima_msg_em - interval '2 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    INTO leit
    FROM (SELECT c.*, row_number() OVER () i FROM whatsapp_contacts c WHERE ultima_msg_em IS NOT NULL ORDER BY ultima_msg_em DESC LIMIT 300) s;
  leit := coalesce(leit, '{}');
  SELECT min(lista_mudou_em) - interval '1 millisecond' INTO desde FROM whatsapp_contacts WHERE right(name, 3) = '777';
  FOR cen IN SELECT * FROM (VALUES
      ('tudo', NULL::uuid, 'todos', 'tudo', NULL::text, NULL::timestamptz, NULL::text[]),
      ('nao-lidas', NULL, 'todos', 'nao-lidas', NULL, NULL, NULL),
      ('grupos', NULL, 'todos', 'grupos', NULL, NULL, NULL),
      ('dep-vendas', NULL, 'todos', 'dep:20000000-0000-0000-0000-000000000002', NULL, NULL, NULL),
      ('dep-ia', NULL, 'todos', 'dep:20000000-0000-0000-0000-000000000001', NULL, NULL, NULL),
      ('etapa', NULL, 'todos', 'etapa:fechado', NULL, NULL, NULL),
      ('tag', NULL, 'todos', 'tag:quente', NULL, NULL, NULL),
      ('sem-conv', NULL, 'todos', 'sem-conversa', NULL, NULL, NULL),
      ('atend-ia', NULL, 'ia', 'tudo', NULL, NULL, NULL),
      ('atend-sem', NULL, 'sem', 'tudo', NULL, NULL, NULL),
      ('atend-c1', NULL, 'u:00000000-0000-0000-0000-0000000000c1', 'tudo', NULL, NULL, NULL),
      ('numero2', '10000000-0000-0000-0000-000000000002', 'todos', 'tudo', NULL, NULL, NULL),
      ('busca-nome', NULL, 'todos', 'tudo', 'lucia 2', NULL, NULL),
      ('busca-previa', NULL, 'todos', 'tudo', 'promocao', NULL, NULL),
      ('busca-fone', NULL, 'todos', 'tudo', '1100002', NULL, NULL),
      ('busca+aba', NULL, 'todos', 'nao-lidas', 'maria', NULL, NULL),
      ('delta', NULL, 'todos', 'tudo', NULL, desde, NULL),
      ('chaves', NULL, 'todos', 'tudo', NULL, NULL, (SELECT array_agg(CASE WHEN right(name,1) IN ('1','3') THEN numero_id::text || '|' || phone ELSE phone END) FROM (SELECT * FROM whatsapp_contacts ORDER BY id LIMIT 40) z))
    ) v(nome, numero, atend, filtro, busca, desde, chaves)
  LOOP
    cur_em := NULL; cur_id := NULL;
    FOR pag IN 1..3 LOOP
      SELECT coalesce(jsonb_agg(jsonb_build_array(r.contato, r.ultima, r.nao_lidas, r.ordem_em) ORDER BY r.o), '[]'), count(*)
        INTO ant, nlin
        FROM crm_conversas_pagina(now() - interval '3 days', leit, ARRAY['10000000-0000-0000-0000-000000000003|5511000000003'],
               cen.numero, '{10000000-0000-0000-0000-000000000004}', cen.atend, cen.filtro, cen.busca, cur_em, cur_id, cen.desde, cen.chaves, 25)
             WITH ORDINALITY r(contato, ultima, nao_lidas, ordem_em, consultado_em, o);
      SELECT coalesce(jsonb_agg(jsonb_build_array(r.contato, r.ultima, r.nao_lidas, r.ordem_em) ORDER BY r.o), '[]')
        INTO nov
        FROM crm_conversas_pagina_v2(now() - interval '3 days', leit, ARRAY['10000000-0000-0000-0000-000000000003|5511000000003'],
               cen.numero, '{10000000-0000-0000-0000-000000000004}', cen.atend, cen.filtro, cen.busca, cur_em, cur_id, cen.desde, cen.chaves, 25)
             WITH ORDINALITY r(contato, ultima, nao_lidas, ordem_em, consultado_em, o);
      total := total + 1; linhas_total := linhas_total + nlin;
      IF ant IS DISTINCT FROM nov THEN
        difs := difs + 1;
        RAISE NOTICE 'DIFERENTE user=% cenario=% pagina=% (antiga % linhas, nova % linhas)', right(u, 2), cen.nome, pag, jsonb_array_length(ant), jsonb_array_length(nov);
      ELSE
        RAISE NOTICE 'igual     user=% cenario=% pagina=% linhas=% ids=%', right(u, 2), cen.nome, pag, nlin,
          (SELECT string_agg(left(e -> 0 ->> 'id', 4), ',') FROM jsonb_array_elements(ant) WITH ORDINALITY t(e, i) WHERE i <= 3);
      END IF;
      EXIT WHEN nlin < 25 OR cen.desde IS NOT NULL OR cen.chaves IS NOT NULL;
      cur_em := coalesce((ant -> -1 ->> 3)::timestamptz, '-infinity'); cur_id := (ant -> -1 -> 0 ->> 'id')::uuid;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'RESUMO user=% paginas_comparadas=% linhas=% diferentes=%', right(u, 2), total, linhas_total, difs;
END $$;
SQL
falhas=0
for u in 0a b1 b2; do
  r=$("${PSQL[@]}" -c "SET ROLE authenticated" -c "SELECT set_config('request.jwt.claims','{\"sub\":\"00000000-0000-0000-0000-0000000000$u\"}',false)" \
       -f "$TMP/compara.sql" 2>&1 | grep -E "DIFERENTE|RESUMO" | sed 's/.*NOTICE:  //')
  echo "$r"
  echo "$r" | grep -q "diferentes=0" || falhas=$((falhas + 1))
done

echo "== 2) tempo (ms, média de 5 chamadas, admin)"
for f in crm_conversas_pagina crm_conversas_pagina_v2; do
  for c in "tudo|'todos','tudo',NULL,NULL" "nao-lidas|'todos','nao-lidas',NULL,NULL" "busca|'todos','tudo','lucia 29',NULL" "delta|'todos','tudo',NULL,now() - interval '1 minute'"; do
    nome="${c%%|*}"; IFS=',' read -r a fl b d <<<"${c#*|}"
    ms=$("${PSQL[@]}" -tA -c "SET ROLE authenticated" -c "SELECT set_config('request.jwt.claims','{\"sub\":\"00000000-0000-0000-0000-00000000000a\"}',false)" -c "
      DO \$\$ DECLARE t0 timestamptz; n int; BEGIN
        PERFORM count(*) FROM public.$f(now() - interval '3 days','{}','{}',NULL,'{}',$a,$fl,$b,NULL,NULL,$d,NULL,60);
        t0 := clock_timestamp();
        FOR i IN 1..5 LOOP PERFORM count(*) FROM public.$f(now() - interval '3 days','{}','{}',NULL,'{}',$a,$fl,$b,NULL,NULL,$d,NULL,60); END LOOP;
        RAISE NOTICE 'ms=%', round(extract(epoch FROM clock_timestamp() - t0) * 200, 1);
      END \$\$;" 2>&1 | grep -o 'ms=.*')
    printf '  %-26s %-10s %s\n' "$f" "$nome" "$ms"
  done
done

if [ "$falhas" -eq 0 ]; then echo "OK: nova = antiga em todas as páginas"; else echo "FALHA: $falhas usuário(s) com diferença"; exit 1; fi
