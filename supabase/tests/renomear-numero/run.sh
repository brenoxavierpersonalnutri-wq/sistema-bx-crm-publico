#!/usr/bin/env bash
# Testa a migration 20261102110000_crm_numero_renomear num Postgres local descartável:
# stubs da Central -> automações -> central -> renomear (2x, idempotente) -> tests.sql.
# Uso: bash supabase/tests/renomear-numero/run.sh   (precisa de initdb/pg_ctl/psql no PATH)
set -euo pipefail
export LC_ALL=C LANG=C
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
TMP="$(mktemp -d)"
PORTA=55441
trap 'rc=$?; [ $rc -ne 0 ] && tail -5 "$TMP/log" >&2 2>/dev/null; pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true' EXIT
initdb -D "$TMP/db" -U postgres -A trust >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
P() { psql -X -q -h "$TMP" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
for m in 20261018100000_crm_automacoes_campanhas 20261024100000_crm_central_numeros; do
  grep -v '^CREATE EXTENSION' "$RAIZ/supabase/migrations/$m.sql" > "$TMP/$m.sql"
done
P -f "$RAIZ/supabase/tests/central/stubs.sql" >/dev/null
P -f "$TMP/20261018100000_crm_automacoes_campanhas.sql" >/dev/null
P -f "$TMP/20261024100000_crm_central_numeros.sql" >/dev/null
P -c "ALTER TABLE public.crm_numeros ADD COLUMN IF NOT EXISTS openwa_session_id text" >/dev/null
P -f "$RAIZ/supabase/migrations/20261102110000_crm_numero_renomear.sql" >/dev/null
P -f "$RAIZ/supabase/migrations/20261102110000_crm_numero_renomear.sql" >/dev/null
PGOPTIONS="" P -f "$AQUI/tests.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; /ERROR/p; /FALHOU/p'
P -f "$AQUI/tests.sql" >/dev/null 2>&1 || { echo "FALHOU"; exit 1; }
echo "TODOS OS TESTES PASSARAM"
