#!/usr/bin/env bash
# Sobe um Postgres DESCARTÁVEL (pasta temporária, porta 55439), roda as migrations de grupos com stubs do
# Supabase e os testes de supabase/tests/grupos_disparo.test.sql. Não toca em banco nenhum de verdade.
set -euo pipefail
export LC_ALL=C  # postmaster do Homebrew recusa subir sem locale válido
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$(mktemp -d /tmp/pgg.XXXXXX)"  # caminho curto: socket unix tem limite de ~100 caracteres
PORTA=55439
trap 'pg_ctl -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true' EXIT  # a pasta fica em /tmp (o sistema limpa)
initdb -D "$DIR/data" -U teste -A trust >/dev/null
pg_ctl -D "$DIR/data" -o "-p $PORTA -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
P="psql -h $DIR -p $PORTA -U teste -d postgres -v ON_ERROR_STOP=1 -q"
$P -f "$RAIZ/supabase/tests/stubs_supabase.sql"
for m in 20261024130000_grupos_whatsapp 20261106100000_grupos_fluxo_campanha 20261108110000_disparo_grupos; do
  # pg_net/pg_cron não existem no Postgres local: os stubs fazem o papel
  sed -E '/CREATE EXTENSION/d' "$RAIZ/supabase/migrations/$m.sql" | $P -f - >/dev/null
  echo "migration ok: $m"
done
# idempotência: a nova roda de novo sem erro
$P -f "$RAIZ/supabase/migrations/20261108110000_disparo_grupos.sql" >/dev/null && echo "migration idempotente: 20261108110000_disparo_grupos"
SAIDA="$(PGOPTIONS='-c client_min_messages=notice' $P -f "$RAIZ/supabase/tests/grupos_disparo.test.sql" 2>&1 || true)"
echo "$SAIDA" | grep -E "OK:|ERROR|ERRO" || echo "$SAIDA"
[[ "$SAIDA" == *"OK: todos"* ]]
