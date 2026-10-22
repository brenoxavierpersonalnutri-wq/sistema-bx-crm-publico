#!/usr/bin/env bash
# Testa a migration de etapas configuráveis (20261101100000) num Postgres local descartável.
# Uso: bash supabase/tests/etapas/run.sh   (precisa de initdb/pg_ctl/psql no PATH)
set -euo pipefail
export LC_ALL=C LANG=C
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations/20261101100000_crm_etapas_configuraveis.sql"
TMP="$(mktemp -d)"
PORTA=55441
trap 'rc=$?; [ $rc -ne 0 ] && tail -5 "$TMP/log" >&2 2>/dev/null; pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true' EXIT
initdb -D "$TMP/db" -U postgres -A trust >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
PSQL=(psql -X -q -h "$TMP" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1)
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$AQUI/stubs.sql" >/dev/null
PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -f "$MIG" 2>&1 | grep crm_etapas: | sed -n 's/^psql:[^ ]* NOTICE:  /  aviso: /p'
"${PSQL[@]}" -f "$MIG" >/dev/null 2>&1   # idempotente: roda 2x
echo "migration aplicada 2x sem erro"
"${PSQL[@]}" -v mig="$MIG" -f "$AQUI/tests.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; /ERROR/p; /FALHOU/p' | grep -v '^crm_etapas:'
echo "TODOS OS TESTES PASSARAM"
