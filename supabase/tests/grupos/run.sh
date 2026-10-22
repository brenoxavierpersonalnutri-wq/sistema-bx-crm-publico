#!/usr/bin/env bash
# Testa a migration dos grupos (20261024130000) num Postgres local descartável.
# Uso: bash supabase/tests/grupos/run.sh   (precisa de initdb/pg_ctl/psql no PATH)
set -euo pipefail
export LC_ALL=C LANG=C
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
TMP="$(mktemp -d)"
PORTA=55438
trap 'rc=$?; [ $rc -ne 0 ] && tail -5 "$TMP/log" >&2 2>/dev/null; pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true' EXIT
initdb -D "$TMP/db" -U postgres -A trust >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -X -q -h "$TMP" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$AQUI/stubs.sql" >/dev/null
M=20261024130000_grupos_whatsapp
grep -v '^CREATE EXTENSION' "$RAIZ/supabase/migrations/$M.sql" > "$TMP/$M.sql"
"${PSQL[@]}" -f "$TMP/$M.sql" >/dev/null
"${PSQL[@]}" -f "$TMP/$M.sql" >/dev/null   # idempotente: roda 2x
echo "migration aplicada 2x sem erro"
# crm_numeros criada depois: rodar de novo cria a FK
"${PSQL[@]}" -c "CREATE TABLE public.crm_numeros (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sessao_openwa text)" >/dev/null
"${PSQL[@]}" -f "$TMP/$M.sql" >/dev/null
PGOPTIONS="" "${PSQL[@]}" -f "$AQUI/tests.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; /ERROR/p; /FALHOU/p'
echo "TODOS OS TESTES PASSARAM"
