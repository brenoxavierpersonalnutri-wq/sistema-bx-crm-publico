#!/usr/bin/env bash
# Testa a migration da Central (20261024100000) num Postgres local descartável, nas duas ordens:
#  A) automações -> central -> central (idempotente) [-> fluxos -> central, se a migration dos fluxos existir]
#  B) automações -> fluxos -> central -> fluxos de novo (bloco 8 dos fluxos liga ao número oficial)
# Uso: bash supabase/tests/central/run.sh   (precisa de initdb/pg_ctl/psql no PATH)
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
BASE=20261018100000_crm_automacoes_campanhas
FLUXOS=20261023120000_crm_fluxos_fullfunnel
CENTRAL=20261024100000_crm_central_numeros
for m in $BASE $FLUXOS $CENTRAL; do
  [ -f "$RAIZ/supabase/migrations/$m.sql" ] && grep -v '^CREATE EXTENSION' "$RAIZ/supabase/migrations/$m.sql" > "$TMP/$m.sql"
done
TEM_FLUXOS=0; [ -f "$TMP/$FLUXOS.sql" ] && TEM_FLUXOS=1

rodar() { # banco, arquivos...
  local db=$1; shift
  for f in "$@"; do psql -X -q -h "$TMP" -p "$PORTA" -U postgres -d "$db" -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
}
testar() { # banco, cenario
  PGOPTIONS="" psql -X -q -h "$TMP" -p "$PORTA" -U postgres -d "$1" -v ON_ERROR_STOP=1 \
    -v tem_fluxos="$TEM_FLUXOS" -v cenario="$2" -f "$AQUI/tests.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; /ERROR/p; /FALHOU/p'
  # sed engole o rc do psql: confere de novo, em silêncio
  PGOPTIONS="-c client_min_messages=warning" psql -X -q -h "$TMP" -p "$PORTA" -U postgres -d "$1" -v ON_ERROR_STOP=1 \
    -v tem_fluxos="$TEM_FLUXOS" -v cenario="$2" -f "$AQUI/tests.sql" >/dev/null 2>&1 || { echo "FALHOU no cenário $2"; exit 1; }
}

for db in ordem_a ordem_b; do
  psql -X -q -h "$TMP" -p "$PORTA" -U postgres -d postgres -c "CREATE DATABASE $db" >/dev/null
  rodar $db "$AQUI/stubs.sql" "$TMP/$BASE.sql"
done

echo "== ordem A: automações -> central (2x)$([ $TEM_FLUXOS = 1 ] && echo ' -> fluxos -> central')"
rodar ordem_a "$TMP/$CENTRAL.sql" "$TMP/$CENTRAL.sql"
[ $TEM_FLUXOS = 1 ] && rodar ordem_a "$TMP/$FLUXOS.sql" "$TMP/$CENTRAL.sql"
testar ordem_a A

if [ $TEM_FLUXOS = 1 ]; then
  echo "== ordem B: automações -> fluxos -> central -> fluxos"
  rodar ordem_b "$TMP/$FLUXOS.sql" "$TMP/$CENTRAL.sql" "$TMP/$FLUXOS.sql"
  testar ordem_b B
else
  echo "== ordem B pulada: migration dos fluxos ainda não está neste checkout"
fi
echo "TODOS OS TESTES PASSARAM"
