#!/usr/bin/env bash
# Teste das migrations 20261122130000 (Full Funnel sem lead de cliente), 20261122140000 (base de leads se alimenta
# sozinha + backfill) e 20261122150000 (Banco de dados com Pessoas/Registros) num Postgres DESCARTÁVEL (cluster
# temporário, apagado no fim). Nunca conecta no Supabase. Precisa de initdb/pg_ctl/psql no PATH.
#   bash scripts/teste-sql-banco-unico.sh
# Monta o mínimo do schema real (tabelas de origem com as colunas usadas, papéis do Supabase, net.http_post e
# cron.schedule de mentira), aplica as migrations reais que vêm antes (20261013230000 ... 20261112100000), simula a
# base parada em 17/10 18:07 UTC e a chegada dos leads depois disso, e confere:
#   Full Funnel: lead do Breno vai; lead de cliente (host fora da lista, UTM da conta do cliente, quiz do Jhonny) não
#   vai, nem no reenvio da fila · base: contagem antes/depois do backfill, rodar 2x não duplica, nenhum lead de cliente
#   entra, backfill não gera evento de fluxo, rodada normal gera · aba Pessoas: produto e filtro de produto.
set -euo pipefail
export LC_ALL=C LANG=C
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$RAIZ/supabase/migrations"
TMP="$(mktemp -d /tmp/tsqlbu.XXXXXX)"
PORTA="${PORTA:-54331}"
trap 'pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

initdb -D "$TMP/db" -U postgres -A trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
Q() { "${PSQL[@]}" -tA -c "$1"; }
falhas=0
confere() { # nome esperado obtido
  if [ "$2" = "$3" ]; then echo "  ok   $1 = $3"; else echo "  FALHA $1: esperado [$2], veio [$3]"; falhas=$((falhas + 1)); fi
}
aplica() { sed -E '/CREATE EXTENSION/d' "$MIG/$1" | "${PSQL[@]}" >/dev/null; }

# ---------------------------------------------------------------- schema mínimo
"${PSQL[@]}" <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA net; CREATE SCHEMA cron;
GRANT USAGE ON SCHEMA public, auth, extensions, net TO anon, authenticated, service_role;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('teste.uid', true), '')::uuid $$;
CREATE FUNCTION public.is_approved(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT u IS NOT NULL $$;
CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT u IS NOT NULL $$;
CREATE FUNCTION public.has_module(u uuid, m text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT u IS NOT NULL $$;
-- pg_net de mentira: só anota a chamada
CREATE TABLE net.chamadas (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, url text, body jsonb);
CREATE TABLE net._http_response (id bigint, status_code int, error_msg text, timed_out boolean, content text);
CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int) RETURNS bigint
LANGUAGE sql AS $$ INSERT INTO net.chamadas (url, body) VALUES (url, body) RETURNING id $$;
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING 1::bigint $$;

CREATE TABLE public.lead_form_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), consultation_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), email text, instagram text, nivel text NOT NULL DEFAULT 'DQ', nome text,
  origem text, p1_objetivo text, p2_situacao text, p3_profissao text, p4_altura numeric, p4_idade int, p4_peso numeric,
  p5_estrategias text, p6_caneta text, p7_acompanhamento text, p8_investimento text, p9_prioridade text, renda_mensal text,
  score int NOT NULL DEFAULT 0, telefone text, utm_campaign text, utm_content text, utm_medium text, utm_source text, utm_term text
);
CREATE TABLE public.consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_name text NOT NULL, client_phone text, client_email text, via text,
  attended boolean, converted boolean, converted_at timestamptz, refunded boolean NOT NULL DEFAULT false, disqualified boolean,
  event_type_name text, status text NOT NULL DEFAULT 'agendado', date date NOT NULL DEFAULT current_date, start_time text,
  program_value text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.sales_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), customer_email text,
  customer_phone text, source text NOT NULL, value numeric NOT NULL DEFAULT 0
);
CREATE TABLE public.alunas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome_completo text NOT NULL, telefone text, programa text NOT NULL DEFAULT 'consultoria_slim',
  status text NOT NULL DEFAULT 'ativa', is_teste boolean NOT NULL DEFAULT false, data_compra date NOT NULL DEFAULT current_date,
  data_vencimento date NOT NULL DEFAULT current_date + 90, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.whatsapp_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone text NOT NULL, numero_id uuid, name text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'leads', source text, is_group boolean NOT NULL DEFAULT false, tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_fluxos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text, ativo boolean DEFAULT false, excluido_em timestamptz,
  gatilhos jsonb NOT NULL DEFAULT '[]', gatilho_tipo text, gatilho_valor text, passos jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE public.crm_contato_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, contact_phone text NOT NULL, tipo text NOT NULL, valor text NOT NULL,
  dados jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_automacoes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text);
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
SQL

# migrations reais anteriores, na ordem
for m in 20261013230000_fullfunnel_leads_qualificados.sql 20261016150000_fullfunnel_so_avaliacao.sql \
         20261019100000_base_leads.sql; do aplica "$m"; done
"${PSQL[@]}" -c "GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;" >/dev/null

# Full Funnel ligado com URL de mentira (só net.chamadas recebe)
Q "INSERT INTO integracao_config (chave, valor) VALUES ('fullfunnel_webhook_url', 'https://ff.invalid/hook/x'), ('fullfunnel_ativo', 'true')
   ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor" >/dev/null

# ---------------------------------------------------------------- dados ANTES de 17/10 18:07 UTC
# telefones: Breno 3199xxxxxxx; cliente 2198xxxxxxx (nunca devem entrar na base nem no Full Funnel)
"${PSQL[@]}" <<'SQL'
INSERT INTO lead_form_responses (created_at, updated_at, nome, telefone, nivel, score, origem, utm_source)
SELECT t, t, 'Antiga ' || g, '319' || lpad(g::text, 8, '0'), CASE WHEN g % 4 = 0 THEN 'B' ELSE 'DQ' END, 50, 'avaliacao', 'ig'
FROM generate_series(1, 300) g, LATERAL (SELECT timestamptz '2026-10-01 12:00Z' + g * interval '1 hour' AS t) x;
INSERT INTO lead_form_responses (created_at, updated_at, nome, telefone, nivel, score, origem, utm_campaign)
SELECT timestamptz '2026-10-10 12:00Z', timestamptz '2026-10-10 12:00Z', 'Cliente antiga ' || g, '219' || lpad(g::text, 8, '0'), 'B', 50, 'avaliacao', '120000000000000608'
FROM generate_series(1, 20) g;
INSERT INTO consultations (client_name, client_phone, via, created_at, updated_at)
SELECT 'Agenda antiga ' || g, '319' || lpad(g::text, 8, '0'), 'trafego', timestamptz '2026-10-05 12:00Z', timestamptz '2026-10-05 12:00Z' FROM generate_series(1, 50) g;
INSERT INTO whatsapp_contacts (phone, name, source, created_at, updated_at)
SELECT '55318' || lpad(g::text, 8, '0'), 'Wa antigo ' || g, 'whatsapp', timestamptz '2026-10-06 12:00Z', timestamptz '2026-10-06 12:00Z' FROM generate_series(1, 40) g;
SQL
# base preenchida UMA vez (como em 17/10 18:07): a migration original + as que vêm antes das novas
for m in 20261021100000_base_leads_unificada.sql 20261026120000_crm_segmentos.sql 20261029110000_banco_segmentos_rapido.sql \
         20261030100000_fluxos_entrada_webhook_banco_tags.sql 20261031100000_alunas_por_programa.sql 20261112100000_base_leads_rls_initplan.sql; do
  aplica "$m"
done
Q "UPDATE base_leads SET importado_em = '2026-10-17 18:07Z'" >/dev/null

echo "== 1. Full Funnel: o vazamento existe antes do conserto"
Q "SET ROLE service_role; INSERT INTO lead_form_responses (nome, telefone, nivel, score, origem, utm_campaign)
   VALUES ('Cliente vaza', '21987650001', 'A', 70, 'avaliacao', '120000000000000464')" >/dev/null
confere "lead de cliente (UTM 0464) chega ao Full Funnel ANTES do conserto (bug reproduzido)" "1" "$(Q "SELECT count(*) FROM net.chamadas WHERE body->>'phone' = '+5521987650001'")"
# um lead de cliente que ficou na fila em 'erro' (vai ser reenviado pelo pg_cron)
Q "UPDATE fullfunnel_envios SET status = 'erro' WHERE telefone_e164 = '+5521987650001'" >/dev/null

echo "== 2. Aplica 20261122130000 (duas vezes: idempotente)"
aplica 20261122130000_fullfunnel_sem_lead_de_cliente.sql
aplica 20261122130000_fullfunnel_sem_lead_de_cliente.sql
"${PSQL[@]}" -c "GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;" >/dev/null
antes=$(Q "SELECT count(*) FROM net.chamadas")
Q "SELECT fullfunnel_conferir()" >/dev/null
confere "reenvio da fila: lead de cliente em 'erro' não sai de novo" "$antes" "$(Q "SELECT count(*) FROM net.chamadas")"
confere "reenvio da fila: vira bloqueado_cliente sem telefone" "bloqueado_cliente|" "$(Q "SELECT status || '|' || coalesce(telefone_e164, '') FROM fullfunnel_envios e JOIN lead_form_responses r ON r.id = e.lead_id WHERE r.nome = 'Cliente vaza'")"

ff() { # nome host_breno origem_host utm_campaign p1 nivel origem -> chamadas ao Full Funnel com esse nome
  local hb="$2"; [ "$hb" = "" ] && hb=NULL
  Q "SET ROLE service_role; INSERT INTO lead_form_responses (nome, telefone, nivel, score, origem, utm_campaign, p1_objetivo, host_breno, origem_host)
     VALUES ('$1', '3197' || lpad((floor(random() * 1e7))::int::text, 7, '0'), '$6', 70, '$7', nullif('$4', ''), nullif('$5', ''), $hb, nullif('$3', ''))" >/dev/null
  Q "SELECT count(*) FROM net.chamadas WHERE body->>'name' = '$1'"
}
echo "== 3. Full Funnel por origem (insert como service_role, igual à edge function)"
confere "Breno equipe.brenoxavier.com.br nível A -> vai"            1 "$(ff 'FF breno equipe' true equipe.brenoxavier.com.br '' '' A avaliacao)"
confere "Breno novaav.brenoxavier.com.br nível C -> vai"            1 "$(ff 'FF breno novaav' true novaav.brenoxavier.com.br '' '' C avaliacao)"
confere "Breno sem host (edge antiga ainda no ar) -> vai"           1 "$(ff 'FF breno sem host' '' '' '' '' B avaliacao)"
confere "cliente bgimplementacao.brenoxavier.com.br -> NÃO vai"     0 "$(ff 'FF cliente bgimpl' false bgimplementacao.brenoxavier.com.br '' '' A avaliacao)"
confere "cliente site remix (host fora da lista) -> NÃO vai"        0 "$(ff 'FF cliente remix' false site-do-cliente.lovable.app '' '' A avaliacao)"
confere "cliente sem host, UTM conta 0608 -> NÃO vai"               0 "$(ff 'FF cliente utm' '' '' '120000000000000608' '' A avaliacao)"
confere "cliente sem host, quiz joelho -> NÃO vai"                  0 "$(ff 'FF cliente quiz' '' '' '' reduzir_dores A avaliacao)"
confere "cliente com host do Breno mas UTM do cliente -> NÃO vai"   0 "$(ff 'FF cliente utm host' true equipe.brenoxavier.com.br '120000000000000226' '' A avaliacao)"
confere "Breno DQ -> não vai (regra antiga)"                        0 "$(ff 'FF breno dq' true equipe.brenoxavier.com.br '' '' DQ avaliacao)"
confere "Breno individual -> não vai (regra de 16/10)"              0 "$(ff 'FF breno individual' true equipe.brenoxavier.com.br '' '' A individual)"
confere "bloqueios registrados sem telefone e sem payload" "5|0|0" "$(Q "SELECT count(*) || '|' || count(telefone_e164) || '|' || count(*) FILTER (WHERE payload <> '{}') FROM fullfunnel_envios e JOIN lead_form_responses r ON r.id = e.lead_id WHERE r.nome LIKE 'FF cliente%' AND e.status = 'bloqueado_cliente'")"
Q "SELECT fullfunnel_enviar_amostra()" >/dev/null
confere "amostra (lead_id nulo) continua saindo" "1" "$(Q "SELECT count(*) FROM fullfunnel_envios WHERE status = 'amostra_enviada'")"
confere "query de auditoria: leads de cliente que chegaram ao FF (status ok/enviado)" "0" "$(Q "SELECT count(*) FROM fullfunnel_envios e JOIN lead_form_responses r ON r.id = e.lead_id WHERE base_leads_form_de_cliente(r) AND e.status IN ('ok','enviado')")"

# ---------------------------------------------------------------- dados DEPOIS de 17/10 18:07 UTC
echo "== 4. Chegam os leads de 17/10 a 21/10 (sem a base acompanhar)"
"${PSQL[@]}" <<'SQL'
-- 390 formulários do Breno (metade com host gravado), 20 de cliente por host, 15 de cliente por UTM, 5 do quiz
INSERT INTO lead_form_responses (created_at, updated_at, nome, telefone, nivel, score, origem, utm_source, host_breno, origem_host)
SELECT t, t, 'Nova ' || g, '3196' || lpad(g::text, 7, '0'), CASE WHEN g % 5 = 0 THEN 'A' ELSE 'DQ' END, 40,
       CASE WHEN g % 13 = 0 THEN 'individual' ELSE 'avaliacao' END, 'fb',
       CASE WHEN g % 2 = 0 THEN true END, CASE WHEN g % 2 = 0 THEN 'equipe.brenoxavier.com.br' END
FROM generate_series(1, 390) g, LATERAL (SELECT timestamptz '2026-10-17 19:00Z' + g * interval '10 minutes' AS t) x;
INSERT INTO lead_form_responses (created_at, updated_at, nome, telefone, nivel, score, origem, host_breno, origem_host)
SELECT timestamptz '2026-10-19 12:00Z', timestamptz '2026-10-19 12:00Z', 'Cli host ' || g, '2195' || lpad(g::text, 7, '0'), 'B', 50, 'avaliacao', false, 'bgimplementacao.brenoxavier.com.br'
FROM generate_series(1, 20) g;
INSERT INTO lead_form_responses (created_at, updated_at, nome, telefone, nivel, score, origem, utm_campaign)
SELECT timestamptz '2026-10-19 13:00Z', timestamptz '2026-10-19 13:00Z', 'Cli utm ' || g, '2194' || lpad(g::text, 7, '0'), 'DQ', 10, 'avaliacao', 'c_120000000000000698'
FROM generate_series(1, 15) g;
INSERT INTO lead_form_responses (created_at, updated_at, nome, telefone, nivel, score, origem, p1_objetivo)
SELECT timestamptz '2026-10-19 14:00Z', timestamptz '2026-10-19 14:00Z', 'Cli quiz ' || g, '2193' || lpad(g::text, 7, '0'), 'DQ', 10, 'avaliacao', 'treinar_sem_risco'
FROM generate_series(1, 5) g;
-- 102 contatos novos de WhatsApp + 5 grupos + 3 empurrados pela própria base
INSERT INTO whatsapp_contacts (phone, name, source, created_at, updated_at)
SELECT '55317' || lpad(g::text, 8, '0'), 'Wa novo ' || g, 'whatsapp', timestamptz '2026-10-18 12:00Z', timestamptz '2026-10-18 12:00Z' FROM generate_series(1, 102) g;
INSERT INTO whatsapp_contacts (phone, name, source, is_group, created_at, updated_at)
SELECT '1203630' || g || '@g.us', 'Grupo ' || g, 'whatsapp', true, timestamptz '2026-10-18 12:00Z', timestamptz '2026-10-18 12:00Z' FROM generate_series(1, 5) g;
INSERT INTO whatsapp_contacts (phone, name, source, created_at, updated_at)
SELECT '55316' || lpad(g::text, 8, '0'), 'Do kanban ' || g, 'base_leads', timestamptz '2026-10-18 12:00Z', timestamptz '2026-10-18 12:00Z' FROM generate_series(1, 3) g;
-- 62 agendamentos, 3 vendas, 3 alunas + 1 de teste
INSERT INTO consultations (client_name, client_phone, via, event_type_name, created_at, updated_at)
SELECT 'Agenda nova ' || g, '3196' || lpad(g::text, 7, '0'), 'trafego', 'Avaliação', timestamptz '2026-10-18 15:00Z', timestamptz '2026-10-18 15:00Z' FROM generate_series(1, 62) g;
INSERT INTO sales_events (created_at, customer_email, customer_phone, source, value)
SELECT timestamptz '2026-10-20 10:00Z', 'compra' || g || '@exemplo.invalid', '3195' || lpad(g::text, 7, '0'), 'PAGTRUST_2', 497 FROM generate_series(1, 3) g;
INSERT INTO alunas (nome_completo, telefone, programa, created_at, updated_at)
SELECT 'Aluna nova ' || g, '3195' || lpad(g::text, 7, '0'), 'elite', timestamptz '2026-10-20 11:00Z', timestamptz '2026-10-20 11:00Z' FROM generate_series(1, 3) g;
INSERT INTO alunas (nome_completo, telefone, programa, is_teste, created_at, updated_at)
VALUES ('Aluna teste', '31950000099', 'elite', true, timestamptz '2026-10-20 11:00Z', timestamptz '2026-10-20 11:00Z');
-- uma agenda antiga mudou depois (compareceu): deve ser atualizada, não duplicada
UPDATE consultations SET attended = true, updated_at = '2026-10-19 10:00Z' WHERE client_name = 'Agenda antiga 1';
-- fluxo LIGADO ouvindo "Novo lead no banco" (base_leads): o backfill não pode gerar evento para ele
INSERT INTO crm_fluxos (nome, ativo, gatilhos) VALUES ('Boas-vindas banco', true, '[{"tipo":"banco","fonte":"base_leads"}]');
SQL

antes_total=$(Q "SELECT count(*) FROM base_leads")
antes_origem=$(Q "SELECT string_agg(origem || '=' || n, ' ' ORDER BY origem) FROM (SELECT origem, count(*) n FROM base_leads GROUP BY 1) x")
echo "  base ANTES do backfill: $antes_total linhas ($antes_origem)"
eventos_antes=$(Q "SELECT count(*) FROM crm_contato_eventos WHERE valor = 'banco_base_leads'")

echo "== 5. Aplica 20261122140000 (backfill dentro) e depois de novo (idempotente)"
aplica 20261122140000_base_leads_alimenta_sozinha.sql
depois1=$(Q "SELECT count(*) FROM base_leads")
depois1_origem=$(Q "SELECT string_agg(origem || '=' || n, ' ' ORDER BY origem) FROM (SELECT origem, count(*) n FROM base_leads GROUP BY 1) x")
echo "  base DEPOIS do backfill: $depois1 linhas ($depois1_origem)"
aplica 20261122140000_base_leads_alimenta_sozinha.sql
Q "SELECT base_leads_sincronizar('2026-10-17 00:00Z', true)" >/dev/null
depois2=$(Q "SELECT count(*) FROM base_leads")
# esperado: 390 formulários do Breno + 5 do Breno do passo 3 + 102 WhatsApp + 62 agendamentos + 3 compras + 3 alunas = 565
confere "backfill entrou com 565 linhas novas" "565" "$((depois1 - antes_total))"
confere "rodar 3x (2 migrations + 1 manual) não duplica" "$depois1" "$depois2"
confere "chave natural sem repetição" "0" "$(Q "SELECT count(*) FROM (SELECT origem, origem_id FROM base_leads GROUP BY 1, 2 HAVING count(*) > 1) x")"
confere "formulários novos do lote de 17-21/10 (390)" "390" "$(Q "SELECT count(*) FROM base_leads WHERE origem IN ('avaliacao','individual') AND nome LIKE 'Nova %'")"
confere "formulários do Breno do passo 3 (5) também entram" "5" "$(Q "SELECT count(*) FROM base_leads WHERE nome LIKE 'FF breno%'")"
confere "formulários de cliente do passo 3 não entram" "0" "$(Q "SELECT count(*) FROM base_leads WHERE nome LIKE 'FF cliente%' OR nome = 'Cliente vaza'")"
confere "WhatsApp novos (sem grupo, sem os do kanban)" "102" "$(Q "SELECT count(*) FROM base_leads WHERE origem = 'crm_whatsapp' AND criado_origem > '2026-10-17 18:07Z'")"
confere "agendamentos novos" "62" "$(Q "SELECT count(*) FROM base_leads WHERE origem = 'agendamento' AND criado_origem > '2026-10-17 18:07Z'")"
confere "vendas novas" "3" "$(Q "SELECT count(*) FROM base_leads WHERE origem = 'compra' AND criado_origem > '2026-10-17 18:07Z'")"
confere "alunas novas (sem a de teste)" "3" "$(Q "SELECT count(*) FROM base_leads WHERE origem = 'aluna' AND criado_origem > '2026-10-17 18:07Z'")"
confere "NENHUM lead de cliente na base (telefones 21...)" "0" "$(Q "SELECT count(*) FROM base_leads WHERE telefone_e164 LIKE '+5521%'")"
confere "nenhum grupo na base" "0" "$(Q "SELECT count(*) FROM base_leads WHERE nome LIKE 'Grupo %'")"
confere "agenda antiga atualizada com a tag compareceu (sem duplicar)" "1|true" "$(Q "SELECT count(*) || '|' || bool_and('compareceu' = ANY(tags)) FROM base_leads WHERE nome = 'Agenda antiga 1' AND origem = 'agendamento'")"
confere "backfill não gerou evento de fluxo" "$eventos_antes" "$(Q "SELECT count(*) FROM crm_contato_eventos WHERE valor = 'banco_base_leads'")"
confere "estado do sync gravado sem erro" "true|" "$(Q "SELECT (ultimo_ok IS NOT NULL) || '|' || coalesce(ultimo_erro, '') FROM base_leads_sync_estado")"

echo "== 6. Rodada normal do cron (base_leads_unificada_atualizar): lead novo entra sozinho"
Q "SET ROLE service_role; INSERT INTO lead_form_responses (nome, telefone, nivel, score, origem, host_breno, origem_host) VALUES
   ('Chegou agora', '31991112222', 'A', 70, 'avaliacao', true, 'equipe.brenoxavier.com.br'),
   ('Cliente agora', '21991112222', 'A', 70, 'avaliacao', false, 'bgimplementacao.brenoxavier.com.br')" >/dev/null
Q "SELECT base_leads_unificada_atualizar()" >/dev/null
confere "lead do Breno entrou na base pelo cron" "1" "$(Q "SELECT count(*) FROM base_leads WHERE telefone_e164 = '+5531991112222'")"
confere "lead de cliente não entrou" "0" "$(Q "SELECT count(*) FROM base_leads WHERE telefone_e164 = '+5521991112222'")"
confere "rodada normal gera o evento Novo lead no banco (fluxo ligado)" "1" "$(Q "SELECT count(*) FROM crm_contato_eventos WHERE valor = 'banco_base_leads' AND contact_phone = '5531991112222'")"
confere "Banco de dados (cópia) já mostra o lead" "1" "$(Q "SELECT count(*) FROM base_leads_unificada_mat WHERE telefone_e164 = '+5531991112222'")"
confere "cópia sem nenhum telefone de cliente" "0" "$(Q "SELECT count(*) FROM base_leads_unificada_mat WHERE telefone_e164 LIKE '+5521%'")"
Q "SELECT base_leads_unificada_atualizar()" >/dev/null
confere "segunda rodada não duplica" "1" "$(Q "SELECT count(*) FROM base_leads WHERE telefone_e164 = '+5531991112222'")"

echo "== 7. Aplica 20261122150000 (2x) e confere a aba Pessoas"
aplica 20261122150000_banco_unico_pessoas_registros.sql
aplica 20261122150000_banco_unico_pessoas_registros.sql
confere "cópia refeita com o mesmo número de pessoas" "$(Q "SELECT count(*) FROM base_leads_unificada")" "$(Q "SELECT count(*) FROM base_leads_unificada_mat")"
confere "produto mais recente na pessoa (agenda nova = Avaliação)" "Avaliação" "$(Q "SELECT produto FROM base_leads_unificada_mat WHERE telefone_e164 = '+5531960000001'")"
U="SET teste.uid = '00000000-0000-0000-0000-000000000001'; SET ROLE authenticated;"
"${PSQL[@]}" -c "GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;" >/dev/null
confere "RPC filtra por produto" "62" "$(Q "$U SELECT coalesce(max(total), 0) FROM crm_segmento_listar('todos', '{\"produto\":\"Avaliação\"}', 0, 50)")"
confere "RPC devolve produto na linha" "Avaliação" "$(Q "$U SELECT produto FROM crm_segmento_listar('todos', '{\"produto\":\"Avaliação\"}', 0, 1)")"
confere "RPC aceita grafias da tag (tagVariantes)" "t" "$(Q "$U SELECT coalesce(max(total), 0) > 0 FROM crm_segmento_listar('todos', '{\"tag\":\"x-nao-existe\",\"tagVariantes\":[\"agendou\"]}', 0, 1)")"
confere "contar segue funcionando (= pessoas da cópia)" "$(Q "SELECT count(*) FROM base_leads_unificada_mat")" "$(Q "$U SELECT crm_segmento_contar('todos')")"
confere "resumo por origem (RLS de aprovado)" "t" "$(Q "$U SELECT count(*) >= 5 FROM base_leads_resumo_origens()")"
confere "resumo por origem sem usuário = vazio" "0" "$(Q "SET ROLE authenticated; SELECT count(*) FROM base_leads_resumo_origens()")"
confere "produtos com contagem" "t" "$(Q "$U SELECT bool_or(produto = 'Avaliação') FROM base_leads_produtos()")"
Q "SELECT base_leads_unificada_atualizar()" >/dev/null
confere "cron segue funcionando depois da cópia nova" "t" "$(Q "SELECT atualizado_em > now() - interval '1 minute' FROM base_leads_unificada_estado")"

echo
if [ "$falhas" -eq 0 ]; then echo "TUDO OK"; else echo "$falhas FALHA(S)"; exit 1; fi
