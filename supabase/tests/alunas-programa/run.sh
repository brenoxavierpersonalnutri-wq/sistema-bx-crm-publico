#!/usr/bin/env bash
# Testa a 20261031100000 (alunas ativas por programa: MGMD / ELITE / PLATAFORMA) por cima da 20261029110000,
# num Postgres local descartável. Roda também os testes da 20261029110000 depois dela (regressão).
# Uso: bash supabase/tests/alunas-programa/run.sh   (precisa de initdb/pg_ctl/psql no PATH)
set -euo pipefail
export LC_ALL=C LANG=C
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
M="$RAIZ/supabase/migrations"
BS="$RAIZ/supabase/tests/banco-segmentos"
TMP="$(mktemp -d)"
PORTA=55443
trap 'rc=$?; [ $rc -ne 0 ] && tail -5 "$TMP/log" >&2 2>/dev/null; pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true' EXIT
initdb -D "$TMP/db" -U postgres -A trust >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -X -q -h "$TMP" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$BS/stubs.sql" >/dev/null
for m in 20261019100000_base_leads 20261021100000_base_leads_unificada 20261026120000_crm_segmentos 20261029110000_banco_segmentos_rapido 20261031100000_alunas_por_programa; do
  grep -v '^CREATE EXTENSION' "$M/$m.sql" > "$TMP/$m.sql"
  "${PSQL[@]}" -f "$TMP/$m.sql" >/dev/null
done
"${PSQL[@]}" -f "$TMP/20261031100000_alunas_por_programa.sql" >/dev/null   # idempotente: roda 2x
echo "migrations aplicadas (alunas por programa 2x) sem erro"
echo "-- regressão: testes da 20261029110000 com a função nova"
PGOPTIONS="" "${PSQL[@]}" -f "$BS/tests.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; /ERROR/p; /FALHOU/p'
echo "-- testes da 20261031100000"
PGOPTIONS="" "${PSQL[@]}" -f "$AQUI/tests.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; /ERROR/p; /FALHOU/p'
echo "TODOS OS TESTES PASSARAM"
