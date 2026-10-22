#!/usr/bin/env bash
# Testa a 20261205100000_conteudo_reacts_edicao_link num Postgres DESCARTÁVEL (pasta temporária). Nunca conecta no Supabase.
#   bash supabase/tests/conteudo-reacts/rodar-edicao.sh     # sai com 1 se algum cenário falhar
# Aplica stubs + 20261125100000 + 20261201100000 + a 20261205100000 duas vezes (idempotente) e confere as travas.
set -euo pipefail
export LC_ALL=C LANG=C
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations"
TMP="$(mktemp -d /tmp/pgreacted.XXXXXX)"
PORTA="${PORTA:-55484}"
parar() { pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true; }
trap parar EXIT
initdb -D "$TMP/db" -U postgres -A trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORTA" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)
export PGOPTIONS="-c client_min_messages=error"
"${PSQL[@]}" -f "$RAIZ/supabase/tests/permissoes/stubs_supabase_completo.sql" >/dev/null
for f in "$MIG"/*.sql; do   # as anteriores (is_approved, has_module...), como no rodar.sh
  b="$(basename "$f")"
  [[ "$b" > "20261124" ]] && continue
  sed -E '/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net|pgcrypto)/d' "$f" | "${PSQL[@]}" -f - >/dev/null 2>&1 || true
done
for f in 20261125100000_conteudo_reacts.sql 20261201100000_conteudo_reacts_edicao_ia.sql \
         20261205100000_conteudo_reacts_edicao_link.sql 20261205100000_conteudo_reacts_edicao_link.sql; do
  "${PSQL[@]}" -f "$MIG/$f" >/dev/null
  echo "ok   $f aplicada"
done
falhas=0
caso() {  # caso "nome" "sql" esperado(ok|erro)
  if "${PSQL[@]}" -c "$2" >/dev/null 2>&1; then r=ok; else r=erro; fi
  if [ "$r" = "$3" ]; then echo "ok   $1"; else echo "FALHA $1 (deu $r)"; falhas=$((falhas+1)); fi
}
caso "edição válida grava" "INSERT INTO public.conteudo_reacts (titulo, edicao, modelo_edicao, origem_url, origem_autor) VALUES ('t', '{\"trechos\":[{\"tipo\":\"tocando\",\"ini\":0,\"fim\":1,\"orig\":0,\"layout\":\"ele\"}],\"edicao\":{\"volume_geral\":0.5}}', 'nativo', 'https://www.instagram.com/reel/X/', 'natgeo')" ok
caso "edição sem trechos é recusada" "INSERT INTO public.conteudo_reacts (titulo, edicao) VALUES ('t', '{\"edicao\":{}}')" erro
caso "edição que não é objeto é recusada" "INSERT INTO public.conteudo_reacts (titulo, edicao) VALUES ('t', '[1,2]')" erro
caso "modelo com caractere estranho é recusado" "INSERT INTO public.conteudo_reacts (titulo, modelo_edicao) VALUES ('t', '../x')" erro
caso "origem sem https é recusada" "INSERT INTO public.conteudo_reacts (titulo, origem_url) VALUES ('t', 'javascript:alert(1)')" erro
caso "linhas antigas continuam valendo (colunas nulas)" "INSERT INTO public.conteudo_reacts (titulo) VALUES ('t')" ok
n=$("${PSQL[@]}" -t -A -c "SELECT count(*) FROM pg_constraint WHERE conname LIKE 'conteudo_reacts_%_check' AND conname IN ('conteudo_reacts_edicao_check','conteudo_reacts_modelo_edicao_check','conteudo_reacts_origem_url_check','conteudo_reacts_origem_autor_check')")
[ "$n" = 4 ] && echo "ok   4 travas, sem duplicar na 2a aplicação" || { echo "FALHA travas: $n"; falhas=$((falhas+1)); }
echo "== $falhas falha(s)"
[ "$falhas" = 0 ]
