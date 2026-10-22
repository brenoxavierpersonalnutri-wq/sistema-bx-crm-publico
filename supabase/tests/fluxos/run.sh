#!/usr/bin/env bash
# Testa a migration dos fluxos (20261023120000) por cima da 20261018100000 num Postgres local descartável.
# Uso: bash supabase/tests/fluxos/run.sh   (precisa de initdb/pg_ctl/psql no PATH)
set -euo pipefail
export LC_ALL=C LANG=C
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
TMP="$(mktemp -d)"
PORTA=55437
trap 'rc=$?; [ $rc -ne 0 ] && tail -5 "$TMP/log" >&2 2>/dev/null; pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true' EXIT
initdb -D "$TMP/db" -U postgres -A trust >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -X -q -h "$TMP" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$AQUI/stubs.sql" >/dev/null
for m in 20261018100000_crm_automacoes_campanhas 20261023120000_crm_fluxos_fullfunnel 20261024110000_crm_fluxos_numero_oficial; do
  grep -v '^CREATE EXTENSION' "$RAIZ/supabase/migrations/$m.sql" > "$TMP/$m.sql"
done
"${PSQL[@]}" -f "$TMP/20261018100000_crm_automacoes_campanhas.sql" >/dev/null
"${PSQL[@]}" -f "$TMP/20261023120000_crm_fluxos_fullfunnel.sql" >/dev/null
"${PSQL[@]}" -f "$TMP/20261023120000_crm_fluxos_fullfunnel.sql" >/dev/null   # idempotente: roda 2x
echo "migrations aplicadas (fluxos 2x) sem erro"
PGOPTIONS="" "${PSQL[@]}" -v mig="$TMP/20261023120000_crm_fluxos_fullfunnel.sql" -v mig2="$TMP/20261024110000_crm_fluxos_numero_oficial.sql" -f "$AQUI/tests.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; /ERROR/p; /FALHOU/p'
echo "TODOS OS TESTES PASSARAM"
