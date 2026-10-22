#!/usr/bin/env bash
# Teste do ROLLBACK de emergência (supabase/rollback/20261123_permissoes_ROLLBACK.sql) num Postgres DESCARTÁVEL em /tmp.
# Nunca conecta no Supabase. Precisa de initdb/pg_ctl/psql no PATH (brew install postgresql@17).
#   bash supabase/tests/permissoes/rollback.sh        # sai com 1 se alguma checagem falhar
#   MANTER=1 bash ...                                 # deixa o banco no ar no fim
# Roteiro:
#   1) stubs do Supabase + migrations anteriores a 20261123 (como rodar.sh) + cenário (rollback_cenario.sql)
#   2) foto + matriz "antes" (ADMIN, COMUM, PEND, anon, service_role)
#   3) as 5 migrations de permissão (2x); o admin RESTRINGE o COMUM e nasce o NOVO (aprovado depois); matriz "migrado"
#   4) rollback 1x -> matriz "rollback1"; rollback mais 2x -> matriz "rollback3" e foto
#   5) rollback_checagens.sql compara; depois testa as seções opcionais 2, 3 e 4 (cada uma 2x)
set -euo pipefail
export LC_ALL=C LANG=C
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations"
RB="${RB:-$RAIZ/supabase/rollback/20261123_permissoes_ROLLBACK.sql}"  # RB=... testa outra versão (teste de mutação)
TMP="$(mktemp -d /tmp/pgrb.XXXXXX)"
PORTA="${PORTA:-55482}"
parar() { pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true; }
if [[ "${MANTER:-0}" == "1" ]]; then trap 'echo "banco no ar: psql -h $TMP -p $PORTA -U postgres  (parar: pg_ctl -D $TMP/db stop)"' EXIT; else trap parar EXIT; fi

initdb -D "$TMP/db" -U postgres -A trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$TMP/db" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORTA" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)
export PGOPTIONS="-c client_min_messages=error"

"${PSQL[@]}" -f "$AQUI/stubs_supabase_completo.sql" >/dev/null
puladas=0
for f in "$MIG"/*.sql; do
  b="$(basename "$f")"
  [[ "$b" > "20261123" ]] && continue
  sed -E '/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net|pgcrypto)/d' "$f" | "${PSQL[@]}" -f - >/dev/null 2>"$TMP/err" || puladas=$((puladas+1))
done
echo "ok   migrations anteriores aplicadas ($puladas pulada(s) que já falham localmente; as mesmas do rodar.sh)"

"${PSQL[@]}" -f "$AQUI/rollback_arnes.sql" >/dev/null
"${PSQL[@]}" -f "$AQUI/rollback_cenario.sql" >/dev/null
echo "ok   cenário montado ($("${PSQL[@]}" -tAc 'SELECT count(*) FROM teste.tabelas') tabelas na matriz)"

ADM=00000000-0000-0000-0000-0000000000ad
COMUM=bbbbbbbb-0000-0000-0000-000000000001
PEND=bbbbbbbb-0000-0000-0000-000000000002
NOVO=bbbbbbbb-0000-0000-0000-000000000003
matriz() { # etapa quem...
  local etapa="$1"; shift
  local sql=""
  for q in "$@"; do
    case "$q" in
      ADMIN) sql+="SELECT teste.como('$ADM','authenticated'); SET ROLE authenticated; SELECT teste.matriz('$etapa','ADMIN'); RESET ROLE;";;
      COMUM) sql+="SELECT teste.como('$COMUM','authenticated'); SET ROLE authenticated; SELECT teste.matriz('$etapa','COMUM'); RESET ROLE;";;
      PEND)  sql+="SELECT teste.como('$PEND','authenticated'); SET ROLE authenticated; SELECT teste.matriz('$etapa','PEND'); RESET ROLE;";;
      NOVO)  sql+="SELECT teste.como('$NOVO','authenticated'); SET ROLE authenticated; SELECT teste.matriz('$etapa','NOVO'); RESET ROLE;";;
      anon)  sql+="SELECT teste.como(NULL,'anon'); SET ROLE anon; SELECT teste.matriz('$etapa','anon'); RESET ROLE;";;
      service_role) sql+="SELECT teste.como(NULL,'service_role'); SET ROLE service_role; SELECT teste.matriz('$etapa','service_role'); RESET ROLE;";;
    esac
  done
  "${PSQL[@]}" -c "$sql" >/dev/null
}

"${PSQL[@]}" -c "SELECT teste.foto('antes')" >/dev/null
matriz antes ADMIN COMUM PEND anon service_role
echo "ok   matriz 'antes' ($("${PSQL[@]}" -tAc "SELECT count(*) FROM teste.mat WHERE etapa='antes'") medições)"

for vez in 1 2; do
  for f in "$MIG"/20261123*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
done
echo "ok   migrations de permissão aplicadas (2x)"

# o admin restringe o COMUM (sem número, sem área) e o NOVO é reaprovado depois das migrations (ganha o padrão: nada)
"${PSQL[@]}" >/dev/null <<SQL
UPDATE public.crm_acessos SET todos_numeros = false, numeros = '{}', areas = public.crm_areas_todas('nenhum'),
       so_minhas = true, so_departamentos = true WHERE user_id = '$COMUM';
DELETE FROM public.crm_acessos WHERE user_id = '$NOVO';
UPDATE public.profiles SET approved = false WHERE id = '$NOVO';
UPDATE public.profiles SET approved = true WHERE id = '$NOVO';   -- crm_acessos_ao_aprovar: nasce com o padrão
-- dado NOVO (das telas novas), que o rollback não pode apagar
UPDATE public.whatsapp_contacts SET atendente_id = '$ADM' WHERE phone = '5511900000001';
INSERT INTO public.crm_departamentos (nome, cor) VALUES ('Comercial RB', '#123456') ON CONFLICT DO NOTHING;
CREATE TABLE teste.dado_novo AS
SELECT (SELECT count(*) FROM public.crm_acessos) AS acessos, (SELECT count(*) FROM public.crm_departamentos) AS deps,
       (SELECT count(*) FROM public.whatsapp_contacts WHERE atendente_id IS NOT NULL) AS com_atendente,
       (SELECT count(*) FROM public.whatsapp_contacts WHERE departamento_id IS NOT NULL) AS com_dep,
       (SELECT count(*) FROM public.profiles_meta_credenciais) AS meta_cred,
       (SELECT count(*) FROM public.whatsapp_contacts) AS contatos, (SELECT count(*) FROM public.whatsapp_messages) AS msgs;
SQL
matriz migrado ADMIN COMUM PEND NOVO anon service_role
echo "ok   matriz 'migrado' (COMUM restringido, NOVO aprovado depois)"

"${PSQL[@]}" -f "$RB" >/dev/null
echo "ok   rollback aplicado (vez 1)"
matriz rollback1 ADMIN COMUM PEND NOVO anon service_role
"${PSQL[@]}" -f "$RB" >/dev/null
"${PSQL[@]}" -f "$RB" >/dev/null
echo "ok   rollback aplicado (vezes 2 e 3, sem erro)"
matriz rollback3 ADMIN COMUM PEND NOVO anon service_role
"${PSQL[@]}" -c "SELECT teste.foto('rollback')" >/dev/null

SAIDA="$("${PSQL[@]}" -t -A -f "$AQUI/rollback_checagens.sql")"
echo "$SAIDA" | grep -v '^$'

# desfazer o rollback (reaplicar as migrations) e rodar o rollback de novo: volta ao mesmo ponto
for f in "$MIG"/20261123110000*.sql "$MIG"/20261123130000*.sql "$MIG"/20261123140000*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
REST="$("${PSQL[@]}" -tAc "SELECT count(*) FROM pg_policies WHERE policyname LIKE 'crm_acesso:%'")"
TRGS="$("${PSQL[@]}" -tAc "SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_crm_contato_zz_acoes_guarda','trg_profiles_guarda_campos')")"
"${PSQL[@]}" -f "$RB" >/dev/null
matriz rollback_de_novo ADMIN COMUM PEND NOVO anon service_role
DIFS="$("${PSQL[@]}" -tAc "SELECT count(*) FROM (SELECT quem, chave, valor FROM teste.mat WHERE etapa='rollback1' EXCEPT SELECT quem, chave, valor FROM teste.mat WHERE etapa='rollback_de_novo') x")"
if [[ "$REST" -gt 0 && "$TRGS" == 2 && "$DIFS" == 0 ]]; then
  echo "ok   desfazer o rollback (reaplicar 110000/130000/140000) religa tudo ($REST restritivas, 2 gatilhos); rollback de novo volta à mesma matriz"
else
  echo "FALHA desfazer/refazer: restritivas=$REST gatilhos=$TRGS diferenças=$DIFS"; SAIDA="${SAIDA/ 0 falha(s)/ 1 falha(s)}"
fi

# seções opcionais: extraídas do arquivo entre os marcadores e rodadas 2x cada
secao() { sed -n "/^-- @@SECAO$1_INICIO/,/^-- @@SECAO$1_FIM/p" "$RB"; }
for s in 2 3 4; do
  [[ -n "$(secao $s)" ]] || { echo "FALHA seção $s não encontrada no arquivo"; exit 1; }
  secao $s | "${PSQL[@]}" -f - >/dev/null
  secao $s | "${PSQL[@]}" -f - >/dev/null
done
echo "ok   seções opcionais 2, 3 e 4 rodaram (2x cada, sem erro)"
matriz secoes COMUM NOVO PEND
SAIDA2="$("${PSQL[@]}" -t -A -f "$AQUI/rollback_checagens_secoes.sql")"
echo "$SAIDA2" | grep -v '^$'

[[ "$SAIDA" == *"RESULTADO: "*" 0 falha(s)"* && "$SAIDA2" == *"RESULTADO (seções opcionais): "*" 0 falha(s)"* ]]
