#!/usr/bin/env bash
# Testa a migration 20261030100000 (entrada por webhook, eventos do banco, tags) num Postgres local descartável.
# Uso: bash supabase/tests/fluxos-entrada/run.sh   (precisa de initdb/pg_ctl/psql no PATH)
set -euo pipefail
export LC_ALL=C LANG=C
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
TMP="$(mktemp -d)"
PORTA=55441
trap 'rc=$?; [ $rc -ne 0 ] && tail -5 "$TMP/log" >&2 2>/dev/null; pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true' EXIT
initdb -D "$TMP/db" -U postgres -A trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -X -q -h "$TMP" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$AQUI/stubs.sql" >/dev/null
M="$RAIZ/supabase/migrations/20261030100000_fluxos_entrada_webhook_banco_tags.sql"
grep -v '^CREATE EXTENSION' "$M" > "$TMP/m.sql"
"${PSQL[@]}" -f "$TMP/m.sql" >/dev/null
"${PSQL[@]}" -f "$TMP/m.sql" >/dev/null   # idempotente: roda 2x
echo "migration aplicada 2x sem erro"
PGOPTIONS="" "${PSQL[@]}" -f "$AQUI/tests.sql" > "$TMP/saida" 2>&1 || { sed -n '/ERROR/p' "$TMP/saida"; exit 1; }
sed -n 's/^psql:[^ ]* NOTICE:  //p' "$TMP/saida"
echo "TODOS OS TESTES PASSARAM"
