#!/usr/bin/env bash
# Teste da migration 20261113100000_crm_ai_tags_ao_iniciar.sql num Postgres DESCARTÁVEL (cluster temporário, apagado
# no fim). Nunca conecta no Supabase. Precisa de initdb/pg_ctl/psql no PATH (ex.: brew install postgresql@17).
#   bash scripts/teste-sql-tags-ia.sh
# Monta só o mínimo do schema real (tabelas com as colunas usadas; trigger de eventos e crm_tag_normalizar copiados
# das migrations originais), roda a migration duas vezes (idempotência) e confere:
#   botão "Transferir para IA" aplica as tags · só adiciona · não duplica (normalizado) · evento tags_aplicadas ·
#   trigger de "recebeu a tag" dispara igual à tag posta à mão · falha na tag não desfaz a transferência.
set -euo pipefail
export LC_ALL=C LANG=C # postmaster no macOS recusa subir com locale inválido ("became multithreaded")
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$RAIZ/supabase/migrations"
TMP="$(mktemp -d /tmp/tsqlia.XXXXXX)" # caminho curto: o soquete Unix tem limite de ~100 caracteres
PORTA="${PORTA:-54329}"
trap 'pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

initdb -D "$TMP/db" -U postgres -A trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

# trecho de uma migration: da linha que casa com $2 até a primeira linha que casa com $3 (inclusive)
trecho() { awk -v a="$2" -v b="$3" '$0 ~ a {on=1} on {print} on && $0 ~ b && !($0 ~ a) {exit}' "$MIG/$1"; }

{
  cat <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
-- simula o JWT do Supabase: role e uid lidos de configurações da sessão
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('teste.role', true), '') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('teste.uid', true), '')::uuid $$;
CREATE FUNCTION public.is_approved(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT u IS NOT NULL $$;
CREATE TABLE public.crm_ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, nome text NOT NULL, numero_id uuid, tipo text DEFAULT 'atendimento'
);
CREATE TABLE public.whatsapp_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone text NOT NULL, numero_id uuid, name text, stage text DEFAULT 'leads',
  source text, is_group boolean DEFAULT false, tags text[] NOT NULL DEFAULT '{}',
  ai_agent_slug text, ai_pausado boolean NOT NULL DEFAULT false, ai_pausado_motivo text, ai_atribuido_em timestamptz,
  ai_precisa_humano boolean NOT NULL DEFAULT false, ai_respostas integer NOT NULL DEFAULT 0, ai_falhas integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.crm_ai_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_phone text NOT NULL, agent_slug text, tipo text NOT NULL, detalhe text,
  numero_id uuid, agent_id uuid, mensagem text, usuario_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_contato_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, contact_phone text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('etapa', 'tag')), valor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
SQL
  trecho 20261103100000_crm_robo_atendimento_ia.sql 'FUNCTION public[.]crm_ai_pode[(]' '^[$]fn[$];'
  trecho 20261030100000_fluxos_entrada_webhook_banco_tags.sql 'FUNCTION public[.]crm_tag_normalizar' '^[$][$];'
  trecho 20261025100000_whatsapp_backfill_midia_nomes.sql 'FUNCTION public[.]crm_registrar_eventos_contato' '^[$][$];'
  cat <<'SQL'
CREATE TRIGGER trg_crm_eventos_contato AFTER INSERT OR UPDATE OF stage, tags ON public.whatsapp_contacts
FOR EACH ROW EXECUTE FUNCTION public.crm_registrar_eventos_contato();
SQL
} | "${PSQL[@]}"

# duas vezes: idempotente
"${PSQL[@]}" -f "$MIG/20261113100000_crm_ai_tags_ao_iniciar.sql" >/dev/null
"${PSQL[@]}" -f "$MIG/20261113100000_crm_ai_tags_ao_iniciar.sql" >/dev/null
echo "ok   migration roda 2x sem erro (idempotente)"

"${PSQL[@]}" <<'SQL'
\set QUIET on
DO $$
DECLARE
  n1 uuid := '11111111-1111-1111-1111-111111111111';
  n2 uuid := '22222222-2222-2222-2222-222222222222';
  v text[];
  c int;
BEGIN
  PERFORM set_config('teste.uid', '99999999-9999-9999-9999-999999999999', false);
  INSERT INTO crm_ai_agents (slug, nome, numero_id, tags_ao_iniciar) VALUES
    ('avaliacao', 'Avaliação', n1, ARRAY['IA Avaliação', 'lead-quente', 'ia-avaliacao', '', 'Comprou']),
    ('sem-tags', 'Sem tags', n1, '{}');
  -- coluna nova: padrão vazio
  SELECT tags_ao_iniciar INTO v FROM crm_ai_agents WHERE slug = 'sem-tags';
  ASSERT v = '{}', 'padrão não é vazio';

  INSERT INTO whatsapp_contacts (phone, numero_id, tags) VALUES ('5531900000001', n1, ARRAY['Comprou', 'vip']);
  DELETE FROM crm_contato_eventos;

  -- caminho 3: botão "Transferir para IA"
  PERFORM crm_ai_transferir_para_ia(n1, '5531900000001', 'avaliacao');
  SELECT tags INTO v FROM whatsapp_contacts WHERE phone = '5531900000001';
  ASSERT v = ARRAY['Comprou', 'vip', 'ia-avaliacao', 'lead-quente'], format('tags erradas: %s', v);
  RAISE NOTICE 'ok   transferir: tags = % (manteve Comprou/vip, não duplicou comprou/ia-avaliacao)', v;
  ASSERT (SELECT ai_agent_slug FROM whatsapp_contacts WHERE phone = '5531900000001') = 'avaliacao', 'não transferiu';
  SELECT count(*) INTO c FROM crm_ai_eventos WHERE tipo = 'tags_aplicadas' AND detalhe = 'tags ao começar (transferencia_manual): ia-avaliacao, lead-quente';
  ASSERT c = 1, 'evento tags_aplicadas faltando';
  RAISE NOTICE 'ok   evento tags_aplicadas gravado';
  -- trigger: mesmas linhas 'tag' que a equipe geraria pondo a tag à mão
  ASSERT (SELECT array_agg(valor ORDER BY valor) FROM crm_contato_eventos WHERE tipo = 'tag') = ARRAY['ia-avaliacao', 'lead-quente'],
    'trigger de tag não disparou';
  RAISE NOTICE 'ok   trigger crm_contato_eventos: tag ia-avaliacao e lead-quente (dispara "recebeu a tag")';

  -- de novo: nada a adicionar, nenhum evento novo, nada duplicado
  DELETE FROM crm_contato_eventos;
  PERFORM crm_ai_transferir_para_ia(n1, '5531900000001', 'avaliacao');
  SELECT tags INTO v FROM whatsapp_contacts WHERE phone = '5531900000001';
  ASSERT v = ARRAY['Comprou', 'vip', 'ia-avaliacao', 'lead-quente'], format('duplicou: %s', v);
  ASSERT (SELECT count(*) FROM crm_ai_eventos WHERE tipo = 'tags_aplicadas') = 1, 'evento repetido sem tag nova';
  ASSERT NOT EXISTS (SELECT 1 FROM crm_contato_eventos), 'trigger disparou sem tag nova';
  RAISE NOTICE 'ok   segunda transferência: não duplica, sem evento';

  -- tag tirada à mão depois volta só na próxima ativação (só adiciona; nada remove a tag da equipe)
  UPDATE whatsapp_contacts SET tags = ARRAY['vip', 'nova-da-equipe'] WHERE phone = '5531900000001';
  v := crm_ai_aplicar_tags_inicio(n1, '5531900000001', 'avaliacao', 'gatilho');
  ASSERT v = ARRAY['ia-avaliacao', 'lead-quente', 'comprou'], format('adicionadas erradas: %s', v);
  ASSERT (SELECT tags FROM whatsapp_contacts WHERE phone = '5531900000001') = ARRAY['vip', 'nova-da-equipe', 'ia-avaliacao', 'lead-quente', 'comprou'];
  RAISE NOTICE 'ok   RPC direta (edge): adicionadas = %, tags da equipe intactas', v;

  -- agente sem tags / agente inexistente / grupo: nada
  ASSERT crm_ai_aplicar_tags_inicio(n1, '5531900000001', 'sem-tags', 'todas') = '{}';
  ASSERT crm_ai_aplicar_tags_inicio(n1, '5531900000001', 'nao-existe', 'todas') = '{}';
  ASSERT crm_ai_aplicar_tags_inicio(n1, '120363@g.us', 'avaliacao', 'todas') = '{}';
  RAISE NOTICE 'ok   sem tags / agente inexistente / grupo: nada muda';

  -- numero_id null (passo agente_ia): todas as conversas do telefone
  INSERT INTO whatsapp_contacts (phone, numero_id, tags) VALUES ('5531900000002', n1, '{}'), ('5531900000002', n2, ARRAY['lead-quente']);
  v := crm_ai_aplicar_tags_inicio(NULL, '5531900000002', 'avaliacao', 'fluxo_agente_ia');
  ASSERT (SELECT tags FROM whatsapp_contacts WHERE phone = '5531900000002' AND numero_id = n2) = ARRAY['lead-quente', 'ia-avaliacao', 'comprou'];
  ASSERT (SELECT tags FROM whatsapp_contacts WHERE phone = '5531900000002' AND numero_id = n1) = ARRAY['ia-avaliacao', 'lead-quente', 'comprou'];
  RAISE NOTICE 'ok   numero null: as duas conversas do telefone, sem duplicar';

  -- sem permissão (anon): a RPC recusa
  PERFORM set_config('teste.uid', '', false);
  BEGIN
    PERFORM crm_ai_aplicar_tags_inicio(n1, '5531900000001', 'avaliacao', 'x');
    RAISE EXCEPTION 'devia recusar';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM = 'sem permissão', SQLERRM;
  END;
  RAISE NOTICE 'ok   sem login: sem permissão';
  PERFORM set_config('teste.uid', '99999999-9999-9999-9999-999999999999', false);
END $$;

-- falha ao pôr tag NÃO desfaz a transferência: quebra a função de tags e transfere
CREATE OR REPLACE FUNCTION public.crm_ai_aplicar_tags_inicio(p_numero_id uuid, p_phone text, p_agent_slug text, p_origem text DEFAULT NULL)
RETURNS text[] LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulada'; END $$;
DO $$
DECLARE n1 uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  PERFORM set_config('teste.uid', '99999999-9999-9999-9999-999999999999', false);
  INSERT INTO whatsapp_contacts (phone, numero_id, tags, ai_pausado, ai_pausado_motivo) VALUES ('5531900000003', n1, ARRAY['vip'], true, 'humano');
  ASSERT crm_ai_transferir_para_ia(n1, '5531900000003', 'avaliacao') = 'ok';
  ASSERT (SELECT ai_agent_slug = 'avaliacao' AND NOT ai_pausado FROM whatsapp_contacts WHERE phone = '5531900000003'), 'transferência desfeita';
  ASSERT (SELECT tags FROM whatsapp_contacts WHERE phone = '5531900000003') = ARRAY['vip'];
  ASSERT EXISTS (SELECT 1 FROM crm_ai_eventos WHERE contact_phone = '5531900000003' AND tipo = 'transferido_ia');
  ASSERT EXISTS (SELECT 1 FROM crm_ai_eventos WHERE contact_phone = '5531900000003' AND tipo = 'tags_falha' AND detalhe LIKE '%simulada%');
  RAISE NOTICE 'ok   tag falhou: transferência ficou, evento tags_falha gravado';
END $$;
SQL
echo "TUDO OK"
