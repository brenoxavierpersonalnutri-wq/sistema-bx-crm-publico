#!/usr/bin/env bash
# Testa a migration da aluna de teste num Postgres local descartável.
# Uso: bash supabase/tests/aluna-teste/run.sh   (precisa de initdb/pg_ctl/psql no PATH)
# Aplica também o gatilho do aviso na agenda (20261014120000, anamnese/feedback ->
# agenda) e confere que o apagar limpa os avisos. AVISO_MIG= (vazio) testa sem ele.
set -euo pipefail
export LC_ALL=C LANG=C   # postmaster no macOS recusa subir com locale inválido
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
M="$RAIZ/supabase/migrations"
MIG="$M/20261014150000_aluna_teste.sql"
TMP="$(mktemp -d)"
PORTA=55435
trap 'rc=$?; [ $rc -ne 0 ] && tail -5 "$TMP/log" >&2 2>/dev/null; pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true' EXIT
initdb -D "$TMP/db" -U postgres -A trust >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
SU=(psql -X -q -h "$TMP" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1)
PSQL=(psql -X -q -h "$TMP" -p "$PORTA" -U supa -d postgres -v ON_ERROR_STOP=1)
"${SU[@]}" -f "$AQUI/stubs.sql" >/dev/null
# As migrations reais do repositório que criam o que a aluna de teste toca.
for f in \
  20260309043458_c5fe6f89-80fb-44c2-92ca-3a4c9306bbde.sql \
  20260311181500_add_signal_payment_fields.sql \
  20260316200743_743c13a2-d67a-4c5f-8374-5f749fb54f22.sql \
  20260318014816_5d958f22-7556-4581-b3bb-778f9c6695b6.sql \
  20260523191150_2378a25e-2aee-40a0-8cef-d72eaf3465e2.sql \
  20260927040000_aluna_anamnese_mfit.sql \
  20260311205653_9d7bcc52-0dd9-44f9-b042-298548a0c597.sql \
  20260414202016_76feaed4-cd97-4162-9f37-2d5c5cffcd94.sql \
  20260602222451_09e6c68d-7281-453b-a686-384620397f8c.sql \
  20260824120000_app_aluna_treino.sql \
  20260824140000_feedback_semanal.sql \
  20260927010000_telefone_nono_digito.sql \
  20260927030000_anamnese.sql \
  20260927031000_anamnese_funcoes.sql \
  20261011120000_agenda_camada_conteudo.sql; do
  "${PSQL[@]}" -f "$M/$f" >/dev/null 2>&1 || { echo "falhou base: $f"; "${PSQL[@]}" -f "$M/$f"; exit 1; }
done
"${PSQL[@]}" -f "$RAIZ/drizzle/migrations/0000_feedback_aluna_link.sql" >/dev/null 2>&1
"${PSQL[@]}" -f "$RAIZ/drizzle/migrations/0002_agenda_alunas_access.sql" >/dev/null 2>&1
AVISO_MIG="${AVISO_MIG-$M/20261014120000_aviso_anamnese_feedback.sql}"
TEM_AVISO=0
if [ -n "$AVISO_MIG" ]; then
  "${PSQL[@]}" -f "$AVISO_MIG" >/dev/null 2>&1 || { "${PSQL[@]}" -f "$AVISO_MIG"; exit 1; }
  TEM_AVISO=1; echo "migration do aviso aplicada: $(basename "$AVISO_MIG")"
fi
"${PSQL[@]}" -c "CREATE TABLE public._policies_antes AS SELECT tablename, policyname, cmd, roles::text, qual, with_check FROM pg_policies WHERE schemaname='public'" >/dev/null
"${PSQL[@]}" -f "$MIG" >/dev/null 2>&1 || { "${PSQL[@]}" -f "$MIG"; exit 1; }
"${PSQL[@]}" -f "$MIG" >/dev/null 2>&1   # idempotente: roda 2x
echo "migration aplicada 2x sem erro"
"${PSQL[@]}" -v tem_aviso="$TEM_AVISO" -f "$AQUI/tests.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; /ERROR/p; /FALHOU/p'
echo "TODOS OS TESTES PASSARAM"
