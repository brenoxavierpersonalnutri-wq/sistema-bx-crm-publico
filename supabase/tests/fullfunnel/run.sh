#!/usr/bin/env bash
# Testa a migration do Full Funnel num Postgres local descartável (stubs de pg_net/pg_cron).
# Uso: bash supabase/tests/fullfunnel/run.sh   (precisa de initdb/pg_ctl/psql no PATH)
set -euo pipefail
export LC_ALL=C LANG=C   # postmaster no macOS recusa subir com locale inválido
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations/20261013230000_fullfunnel_leads_qualificados.sql"
TMP="$(mktemp -d)"
PORTA=55433
trap 'rc=$?; [ $rc -ne 0 ] && tail -5 "$TMP/log" >&2 2>/dev/null; pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true' EXIT   # a pasta temporária fica; o sistema limpa
initdb -D "$TMP/db" -U postgres -A trust >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
PSQL=(psql -X -q -h "$TMP" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$AQUI/stubs.sql" >/dev/null
# pg_net/pg_cron não existem aqui: tira só as linhas CREATE EXTENSION (os stubs fazem o papel).
grep -v '^CREATE EXTENSION' "$MIG" > "$TMP/mig.sql"
"${PSQL[@]}" -f "$TMP/mig.sql" >/dev/null 2>&1
"${PSQL[@]}" -f "$TMP/mig.sql" >/dev/null 2>&1   # idempotente: roda 2x
echo "migration aplicada 2x sem erro"
cd "$AQUI"
"${PSQL[@]}" -f "$AQUI/tests.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; /ERROR/p; /FALHOU/p'
echo "TODOS OS TESTES PASSARAM"
