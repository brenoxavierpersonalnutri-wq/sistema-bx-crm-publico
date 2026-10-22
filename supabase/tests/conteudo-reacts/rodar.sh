#!/usr/bin/env bash
# Testes da 20261125100000_conteudo_reacts num Postgres DESCARTÁVEL (pasta temporária). Nunca conecta no Supabase.
# Precisa de initdb/pg_ctl/psql no PATH (brew install postgresql@17).
#   bash supabase/tests/conteudo-reacts/rodar.sh     # sai com 1 se algum cenário falhar
# Monta: stubs do Supabase + migrations anteriores SEM a 20261124100000 (prova que esta roda sozinha) + a
# 20261125100000 duas vezes + a 20261124100000 depois + a 20261125100000 de novo (qualquer ordem) + cenarios.sql.
set -euo pipefail
export LC_ALL=C LANG=C
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations"
ALVO="$MIG/20261125100000_conteudo_reacts.sql"
PUB="$MIG/20261124100000_conteudo_publicacoes.sql"
TMP="$(mktemp -d /tmp/pgreact.XXXXXX)"
PORTA="${PORTA:-55483}"
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
  [[ "$b" > "20261124" ]] && continue
  sed -E '/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net|pgcrypto)/d' "$f" | "${PSQL[@]}" -f - >/dev/null 2>"$TMP/err" || puladas=$((puladas+1))
done
echo "ok   migrations anteriores aplicadas ($puladas pulada(s) por dependerem de dado de produção)"
"${PSQL[@]}" -t -A -c "SELECT CASE WHEN to_regclass('public.conteudo_publicacoes') IS NULL THEN 'ok   sem a 20261124100000 (conteudo_publicacoes não existe)' ELSE 'FALHA a 20261124100000 já estava aplicada' END"

"${PSQL[@]}" -f "$ALVO" >/dev/null && echo "ok   20261125100000 aplicada sozinha (1a vez)"
"${PSQL[@]}" -f "$ALVO" >/dev/null && echo "ok   20261125100000 aplicada (2a vez: idempotente)"
"${PSQL[@]}" -f "$PUB" >/dev/null && echo "ok   20261124100000 aplicada depois"
"${PSQL[@]}" -f "$ALVO" >/dev/null && echo "ok   20261125100000 aplicada de novo depois da 20261124100000"

"${PSQL[@]}" -v ON_ERROR_STOP=0 -f "$AQUI/cenarios.sql" 2>&1 | tee "$TMP/saida" | grep -E '^(ok|FALHA)' || true
falhas=$(grep -c '^FALHA' "$TMP/saida" || true)
oks=$(grep -c '^ok' "$TMP/saida" || true)
if grep -qE 'ERROR' "$TMP/saida"; then echo "ERRO inesperado no cenarios.sql:"; grep -E 'ERROR' "$TMP/saida" | head; exit 1; fi
echo "resultado: $oks ok / $falhas falha"
[ "$falhas" -eq 0 ] && [ "$oks" -gt 0 ]
