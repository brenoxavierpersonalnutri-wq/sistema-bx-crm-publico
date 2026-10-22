#!/usr/bin/env bash
# Testa a migration do Banco de dados rápido (20261029110000): cópia materializada, RPCs dos segmentos e a
# regra de Alunas ativas / Ex-alunas, num Postgres local descartável.
# Uso: bash supabase/tests/banco-segmentos/run.sh   (precisa de initdb/pg_ctl/psql no PATH)
set -euo pipefail
export LC_ALL=C LANG=C
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
M="$RAIZ/supabase/migrations"
TMP="$(mktemp -d)"
PORTA=55441
trap 'rc=$?; [ $rc -ne 0 ] && tail -5 "$TMP/log" >&2 2>/dev/null; pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true' EXIT
initdb -D "$TMP/db" -U postgres -A trust >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -X -q -h "$TMP" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$AQUI/stubs.sql" >/dev/null
for m in 20261019100000_base_leads 20261021100000_base_leads_unificada 20261026120000_crm_segmentos 20261029110000_banco_segmentos_rapido; do
  grep -v '^CREATE EXTENSION' "$M/$m.sql" > "$TMP/$m.sql"
  "${PSQL[@]}" -f "$TMP/$m.sql" >/dev/null
done
"${PSQL[@]}" -f "$TMP/20261029110000_banco_segmentos_rapido.sql" >/dev/null   # idempotente: roda 2x
echo "migrations aplicadas (banco rápido 2x) sem erro"
[ -n "${DEPURAR:-}" ] && { "${PSQL[@]}" -f "$AQUI/tests.sql" >/dev/null 2>&1 || true; "${PSQL[@]}" -c "$DEPURAR"; exit 0; }
PGOPTIONS="" "${PSQL[@]}" -f "$AQUI/tests.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; /ERROR/p; /FALHOU/p'
echo "TODOS OS TESTES PASSARAM"
