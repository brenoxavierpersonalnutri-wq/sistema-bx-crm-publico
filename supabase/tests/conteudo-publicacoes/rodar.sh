#!/usr/bin/env bash
# Testes da 20261124100000_conteudo_publicacoes num Postgres DESCARTÁVEL (pasta temporária). Nunca conecta no Supabase.
# Precisa de initdb/pg_ctl/psql no PATH (brew install postgresql@17).
#   bash supabase/tests/conteudo-publicacoes/rodar.sh     # sai com 1 se algum cenário falhar
# Monta: stubs do Supabase + migrations anteriores (as que falham localmente por depender de dado de produção são
# puladas e listadas) + a 20261124100000 DUAS vezes com ON_ERROR_STOP (idempotência) + cenarios.sql.
set -euo pipefail
export LC_ALL=C LANG=C
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations"
ALVO="$MIG/20261124100000_conteudo_publicacoes.sql"
TMP="$(mktemp -d /tmp/pgcont.XXXXXX)"
PORTA="${PORTA:-55482}"
parar() { pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true; }
trap parar EXIT

initdb -D "$TMP/db" -U postgres -A trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORTA" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)
export PGOPTIONS="-c client_min_messages=error"

"${PSQL[@]}" -f "$RAIZ/supabase/tests/permissoes/stubs_supabase_completo.sql" >/dev/null
puladas=0
for f in "$MIG"/*.sql; do
  b="$(basename "$f")"
  [[ "$b" > "20261124100000" || "$b" == "20261124100000_conteudo_publicacoes.sql" ]] && continue
  sed -E '/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net|pgcrypto)/d' "$f" | "${PSQL[@]}" -f - >/dev/null 2>"$TMP/err" || puladas=$((puladas+1))
done
echo "ok   migrations anteriores aplicadas ($puladas pulada(s) por dependerem de dado de produção)"
for f in has_role is_approved has_module; do
  "${PSQL[@]}" -t -A -c "SELECT CASE WHEN to_regproc('public.$f') IS NULL THEN 'FALTA public.$f' ELSE 'ok   public.$f existe' END"
done

"${PSQL[@]}" -f "$ALVO" >/dev/null && echo "ok   20261124100000 aplicada (1a vez)"
"${PSQL[@]}" -f "$ALVO" >/dev/null && echo "ok   20261124100000 aplicada (2a vez: idempotente)"

"${PSQL[@]}" -v ON_ERROR_STOP=0 -f "$AQUI/cenarios.sql" 2>&1 | tee "$TMP/saida" | grep -E '^(ok|FALHA)' || true
falhas=$(grep -c '^FALHA' "$TMP/saida" || true)
oks=$(grep -c '^ok' "$TMP/saida" || true)
if grep -qE 'ERROR' "$TMP/saida"; then echo "ERRO inesperado no cenarios.sql:"; grep -E 'ERROR' "$TMP/saida" | head; exit 1; fi
echo "resultado: $oks ok / $falhas falha"
[ "$falhas" -eq 0 ] && [ "$oks" -gt 0 ]
