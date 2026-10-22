#!/usr/bin/env bash
# Testes de RLS das permissões do CRM num Postgres DESCARTÁVEL (pasta temporária em /tmp). Nunca conecta no Supabase.
# Precisa de initdb/pg_ctl/psql no PATH (brew install postgresql@17).
#   bash supabase/tests/permissoes/rodar.sh            # cenários de RLS (sai com 1 se algum falhar)
#   bash supabase/tests/permissoes/rodar.sh --explain  # + volume (10 mil conversas, 300 mil mensagens) e EXPLAIN antes/depois
#   MANTER=1 bash ...                                  # deixa o banco no ar no fim (imprime como conectar) pra atacar à mão
#   CENARIO=producao bash ...                          # simula a produção de 21/10/2026: SEM a 20260927010000 (telefone_nucleo
#                                                      # e cia. nunca foram aplicadas lá) e SEM a coluna profiles.meta_access_token
# Como monta: stubs do Supabase + TODAS as migrations da pasta, em ordem. As anteriores às de permissão que já falham
# localmente (dependem de dado que só existe em produção) são registradas e puladas; as de permissão (20261123*)
# rodam com ON_ERROR_STOP e DUAS vezes (idempotência). Um usuário aprovado é criado ANTES delas (o "antigo").
set -euo pipefail
export LC_ALL=C LANG=C
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations"
TMP="$(mktemp -d /tmp/pgperm.XXXXXX)" # caminho curto: soquete Unix tem limite de ~100 caracteres
PORTA="${PORTA:-55481}"
CENARIO="${CENARIO:-completo}"
case "$CENARIO" in completo|producao) ;; *) echo "CENARIO inválido: $CENARIO (completo|producao)" >&2; exit 2 ;; esac
EXPLAIN=0; [[ "${1:-}" == "--explain" ]] && EXPLAIN=1
parar() { pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true; }  # a pasta fica em /tmp (o sistema limpa)
if [[ "${MANTER:-0}" == "1" ]]; then trap 'echo "banco no ar: psql -h $TMP -p $PORTA -U postgres  (parar: pg_ctl -D $TMP/db stop)"' EXIT; else trap parar EXIT; fi

initdb -D "$TMP/db" -U postgres -A trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORTA" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)
export PGOPTIONS="-c client_min_messages=error"

"${PSQL[@]}" -f "$AQUI/stubs_supabase_completo.sql" >/dev/null
puladas=0
for f in "$MIG"/*.sql; do
  b="$(basename "$f")"
  [[ "$b" > "20261123" ]] && continue
  if [[ "$CENARIO" == producao && "$b" == 20260927010000_telefone_nono_digito.sql ]]; then echo "  (cenário produção: $b NÃO aplicada)"; continue; fi
  sed -E '/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net|pgcrypto)/d' "$f" | "${PSQL[@]}" -f - >/dev/null 2>"$TMP/err" || { puladas=$((puladas+1)); echo "  (anterior pulada: $b — $(head -c 120 "$TMP/err" | tr '\n' ' '))"; }
done
echo "ok   migrations anteriores aplicadas ($puladas pulada(s), nenhuma de CRM/WhatsApp)"

# usuário que já estava aprovado antes das permissões
"${PSQL[@]}" <<'SQL'
INSERT INTO auth.users (id, email) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'antigo@t');
INSERT INTO public.profiles (id, full_name, approved) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Antigo', true)
ON CONFLICT (id) DO UPDATE SET approved = true, full_name = 'Antigo';
-- token da Meta gravado do jeito antigo (coluna em profiles): a 20261123140000 tem que copiar antes de tirar a coluna
UPDATE public.profiles SET meta_access_token = 'tok-antigo' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SQL
if [[ "$CENARIO" == producao ]]; then
  "${PSQL[@]}" <<'SQL'
ALTER TABLE public.profiles DROP COLUMN IF EXISTS meta_access_token;
DROP FUNCTION IF EXISTS public.telefone_nucleo(text), public.telefone_ddd(text), public.telefone_local(text);
SQL
  "${PSQL[@]}" -t -A -c "SELECT 'cenario producao: coluna meta_access_token=' || count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='meta_access_token'" \
    -c "SELECT 'cenario producao: telefone_nucleo existe=' || (to_regprocedure('public.telefone_nucleo(text)') IS NOT NULL)"
fi

if [[ $EXPLAIN == 1 ]]; then
  "${PSQL[@]}" -f "$AQUI/volume.sql" >/dev/null
  echo "ok   volume carregado (10 mil conversas, 300 mil mensagens)"
  echo "== EXPLAIN ANTES (policies de hoje) =="
  "${PSQL[@]}" -f "$AQUI/explain.sql"
fi

for vez in 1 2; do
  for f in "$MIG"/20261123*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
  echo "ok   migrations de permissão rodaram (vez $vez, cenário $CENARIO)"
done

if [[ $EXPLAIN == 1 ]]; then
  echo "== EXPLAIN DEPOIS (permissões) =="
  "${PSQL[@]}" -f "$AQUI/explain.sql"
fi

SEMCOL=(); [[ "$CENARIO" == producao ]] && SEMCOL=(-v SEM_COLUNA_META=1)
SAIDA="$("${PSQL[@]}" "${SEMCOL[@]}" -t -A -f "$AQUI/rls_permissoes.test.sql")"
echo "$SAIDA" | grep -v '^$'
[[ "$SAIDA" == *"RESULTADO:"*" 0 falha(s)"* ]]
