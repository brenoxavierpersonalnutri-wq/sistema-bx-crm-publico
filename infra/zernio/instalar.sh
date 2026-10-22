#!/usr/bin/env bash
# headturbo-zernio: instala ou atualiza o serviço na VPS. Idempotente: rodar de novo só refaz o que mudou.
# Rodar como root, de dentro de um checkout do repo (o publicar.sh faz isso sozinho):
#   sudo bash infra/zernio/instalar.sh            # instala/atualiza e reinicia
#   sudo bash infra/zernio/instalar.sh --seco     # só confere e diz o que faria; não grava nada
#   sudo bash infra/zernio/instalar.sh --contas   # depois de instalar, UMA leitura real: lista as contas da Zernio
#   sudo bash infra/zernio/instalar.sh --sem-caddy
#   sudo bash infra/zernio/instalar.sh --registrar-webhook   # ESCRITA na conta da Zernio: só com OK do Breno
#
# O que faz (cada passo diz "ok", "mudou" ou "FALTA"):
#   1) /etc/headturbo-zernio (root 0700) com 4 arquivos 0600:
#        zernio.key     copiado de ZERNIO_API_KEY no cofre do kit (/home/turbo/.config/head-turbo/cofre.env; outro
#                       caminho: HEADTURBO_COFRE=...). Sem a chave no cofre fica VAZIO: o serviço sobe e recusa publicar.
#        sync.secret    gerado aqui uma vez (openssl rand -hex 32); o banco guarda só o sha256
#        webhook.secret gerado aqui uma vez; vai para a Zernio quando o webhook for registrado (README)
#        anon.key       anon key PÚBLICA do Supabase, tirada do bundle publicado em equipe.brenoxavier.com.br
#   2) código em /usr/local/lib/headturbo-zernio, unidade em /etc/systemd/system, enable + restart
#   3) ufw: 172.18.0.0/16 -> 172.18.0.1:7891 (só o Caddy)
#   4) Caddy: rota /zernio no bloco SEU_VPS (backup, adapt num container descartável, reload; se o
#      reload falhar, volta o backup)
#   5) saúde local e pelo Caddy
# Nunca imprime segredo: só nomes, tamanhos, "mudou/igual" e status HTTP.
set -euo pipefail
umask 077

AQUI="$(cd "$(dirname "$0")" && pwd)"
COFRE="${HEADTURBO_COFRE:-/home/turbo/.config/head-turbo/cofre.env}"
ETC=/etc/headturbo-zernio
LIB=/usr/local/lib/headturbo-zernio
UNIT=/etc/systemd/system/headturbo-zernio.service
CADDYFILE=/opt/head-turbo/Caddyfile
CADDY_CT=head-turbo-caddy-1
HOST=SEU_VPS
SITE=https://equipe.brenoxavier.com.br
REF=SEU_PROJECT_REF

SECO=0; CONTAS=0; SEM_CADDY=0; WEBHOOK=0
for a in "$@"; do
  case "$a" in
    --seco) SECO=1 ;;
    --contas) CONTAS=1 ;;
    --sem-caddy) SEM_CADDY=1 ;;
    --registrar-webhook) WEBHOOK=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "PARADO: argumento desconhecido: $a"; exit 2 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "PARADO: rode como root (sudo)."; exit 2; }
for bin in node curl python3 openssl sha256sum systemctl install; do
  command -v "$bin" >/dev/null 2>&1 || { echo "PARADO: falta o comando $bin."; exit 2; }
done
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || { echo "PARADO: precisa de Node 22+"; exit 2; }
fazer() { if [ "$SECO" = 1 ]; then echo "  (seco) faria: $*"; else "$@"; fi; }

# Lê NOME=valor de um .env sem executar o arquivo (mesma regra do headturbo-ig-parear).
ler_env() {
  local arq="$1" nome="$2" linha k v achou=""
  while IFS= read -r linha || [ -n "$linha" ]; do
    linha="${linha#"${linha%%[![:space:]]*}"}"
    linha="${linha#export }"
    case "$linha" in ''|'#'*) continue ;; esac
    [[ "$linha" == *=* ]] || continue
    k="${linha%%=*}"; k="${k%"${k##*[![:space:]]}"}"
    [ "$k" = "$nome" ] || continue
    v="${linha#*=}"
    v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
    if [ "${#v}" -ge 2 ]; then
      case "$v" in \"*\"|\'*\') v="${v:1:${#v}-2}" ;; esac
    fi
    achou="$v"
  done < "$arq"
  printf '%s' "$achou"
}

# grava conteúdo (stdin) em arquivo 0600 só se mudou; ecoa "mudou" ou "igual"
gravar_se_mudou() {
  local destino="$1" tmp
  tmp="$(mktemp "$ETC/.tmp.XXXXXX")"
  cat > "$tmp"
  if [ -f "$destino" ] && cmp -s "$tmp" "$destino"; then rm -f "$tmp"; echo igual; return; fi
  chmod 600 "$tmp"; mv -f "$tmp" "$destino"; echo mudou
}

MUDOU=0
echo "== 1) credenciais em $ETC"
fazer install -d -m 0700 -o root -g root "$ETC"

CHAVE=""
if [ -r "$COFRE" ]; then CHAVE="$(ler_env "$COFRE" ZERNIO_API_KEY)"; else echo "  aviso: não consegui ler o cofre ($COFRE)"; fi
if [ -n "$CHAVE" ]; then
  echo "  ZERNIO_API_KEY no cofre: presente (${#CHAVE} caracteres)"
  if [ "$SECO" = 0 ]; then r="$(printf '%s' "$CHAVE" | gravar_se_mudou "$ETC/zernio.key")"; echo "  zernio.key: $r"; [ "$r" = mudou ] && MUDOU=1; fi
else
  echo "  FALTA ZERNIO_API_KEY no cofre: o serviço sobe, mas recusa publicar até a chave chegar (README, 'A chave')"
  # só NOMES parecidos (a Zernio já se chamou Late), nunca valor
  if [ -r "$COFRE" ]; then
    parecidos="$(sed -n 's/^[[:space:]]*\(export[[:space:]]\+\)\{0,1\}\([A-Za-z_][A-Za-z0-9_]*\)=.*/\2/p' "$COFRE" | grep -iE 'zernio|late' | tr '\n' ' ' || true)"
    [ -n "$parecidos" ] && echo "  no cofre há nomes parecidos: $parecidos(o serviço só lê ZERNIO_API_KEY)"
  fi
  if [ "$SECO" = 0 ] && [ ! -f "$ETC/zernio.key" ]; then : > "$ETC/zernio.key"; chmod 600 "$ETC/zernio.key"; MUDOU=1; fi
fi
unset CHAVE

for s in sync.secret webhook.secret; do
  if [ -s "$ETC/$s" ]; then echo "  $s: já existe (mantido)"
  elif [ "$SECO" = 1 ]; then echo "  (seco) geraria $s"
  else openssl rand -hex 32 | tr -d '\n' | gravar_se_mudou "$ETC/$s" >/dev/null; echo "  $s: gerado"; MUDOU=1; fi
done

# anon key pública: do bundle publicado (confere ref do projeto e role=anon antes de aceitar)
ANON="$(python3 -I - "$SITE" "$REF" <<'PY'
import base64, json, re, sys, urllib.request
site, ref = sys.argv[1], sys.argv[2]
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers={"user-agent": "headturbo-zernio"}), timeout=20) as r:
        return r.read().decode("utf-8", "replace")
try:
    html = get(site + "/")
    for js in re.findall(r'/assets/index-[A-Za-z0-9_-]+\.js', html):
        for tok in set(re.findall(r'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', get(site + js))):
            p = tok.split(".")[1]; p += "=" * (-len(p) % 4)
            c = json.loads(base64.urlsafe_b64decode(p))
            if c.get("ref") == ref and c.get("role") == "anon":
                print(tok); sys.exit(0)
except Exception:
    pass
sys.exit(1)
PY
)" || ANON=""
if [ -n "$ANON" ]; then
  echo "  anon key pública do site: encontrada (${#ANON} caracteres, ref $REF, role anon)"
  if [ "$SECO" = 0 ]; then r="$(printf '%s' "$ANON" | gravar_se_mudou "$ETC/anon.key")"; echo "  anon.key: $r"; [ "$r" = mudou ] && MUDOU=1; fi
elif [ -s "$ETC/anon.key" ]; then echo "  aviso: não li a anon key do site; mantenho a que já está em $ETC/anon.key"
else echo "PARADO: sem anon key (o site $SITE não respondeu?)"; exit 3; fi
unset ANON

echo "== 2) código e unidade"
fazer install -d -m 0755 -o root -g root "$LIB"
for f in server.mjs lib.mjs; do
  if [ -f "$LIB/$f" ] && cmp -s "$AQUI/$f" "$LIB/$f"; then echo "  $f: igual"
  else fazer install -m 0644 -o root -g root "$AQUI/$f" "$LIB/$f"; echo "  $f: mudou"; MUDOU=1; fi
done
if [ -f "$UNIT" ] && cmp -s "$AQUI/headturbo-zernio.service" "$UNIT"; then echo "  unidade: igual"
else fazer install -m 0644 -o root -g root "$AQUI/headturbo-zernio.service" "$UNIT"; fazer systemctl daemon-reload; echo "  unidade: mudou"; MUDOU=1; fi
fazer systemctl enable headturbo-zernio.service >/dev/null 2>&1 || true
if [ "$SECO" = 0 ]; then
  systemctl restart headturbo-zernio.service
  sleep 2
  systemctl is-active --quiet headturbo-zernio.service && echo "  serviço: ativo" || { echo "  FALHA: serviço não subiu"; journalctl -u headturbo-zernio -n 20 --no-pager; exit 4; }
fi

echo "== 3) ufw"
if command -v ufw >/dev/null 2>&1; then
  if ufw status | grep -q '172.18.0.1 7891/tcp'; then echo "  regra 172.18.0.0/16 -> 172.18.0.1:7891: já existe"
  elif [ "$SECO" = 1 ]; then echo "  (seco) criaria a regra 172.18.0.0/16 -> 172.18.0.1:7891"
  else ufw allow from 172.18.0.0/16 to 172.18.0.1 port 7891 proto tcp comment 'caddy -> headturbo-zernio' >/dev/null; echo "  regra: criada"; fi
fi

echo "== 4) Caddy"
if [ "$SEM_CADDY" = 1 ]; then echo "  pulado (--sem-caddy)"
else
  CAND="$(mktemp /tmp/Caddyfile.zernio.XXXXXX)"
  rc=0; python3 -I "$AQUI/caddy-bloco.py" "$CADDYFILE" "$CAND" || rc=$?
  if [ "$rc" = 3 ]; then echo "  rota /zernio: já está"
  elif [ "$rc" != 0 ]; then echo "PARADO: não consegui montar o Caddyfile (rc $rc)"; rm -f "$CAND"; exit 5
  else
    IMG="$(docker inspect -f '{{.Config.Image}}' "$CADDY_CT")"
    chmod 644 "$CAND"
    if ! docker run --rm -v "$CAND:/etc/caddy/Caddyfile:ro" "$IMG" caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>/tmp/caddy-adapt.err; then
      echo "PARADO: o Caddyfile novo não passou no caddy adapt:"; head -5 /tmp/caddy-adapt.err; rm -f "$CAND"; exit 5
    fi
    echo "  Caddyfile novo: passou no caddy adapt ($IMG)"
    if [ "$SECO" = 1 ]; then echo "  (seco) faria backup, gravaria no lugar e daria reload"
    else
      BAK="$CADDYFILE.bak-$(date +%Y%m%d-%H%M%S)"
      cp -p "$CADDYFILE" "$BAK"
      cat "$CAND" > "$CADDYFILE"   # no lugar (mesmo inode): o arquivo é bind mount do container
      if docker exec "$CADDY_CT" caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>/tmp/caddy-reload.err; then
        echo "  Caddy: recarregado (backup em $BAK)"
      else
        cat "$BAK" > "$CADDYFILE"; docker exec "$CADDY_CT" caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
        echo "PARADO: reload falhou; Caddyfile voltou ao backup."; head -5 /tmp/caddy-reload.err; exit 5
      fi
    fi
  fi
  rm -f "$CAND"
fi

echo "== 5) saúde"
if [ "$SECO" = 0 ]; then
  sleep 1
  echo "  local:  $(curl -s -m 5 http://172.18.0.1:7891/saude || echo 'sem resposta')"
  echo "  Caddy:  HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 10 --resolve "$HOST:443:127.0.0.1" "https://$HOST/zernio/saude")"
  echo "  n8n segue fechado para quem não é o dono: HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 10 --resolve "$HOST:443:127.0.0.1" "https://$HOST/")  (esperado 403 daqui)"
  echo "  /zernio/interno pelo Caddy: HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 10 --resolve "$HOST:443:127.0.0.1" "https://$HOST/zernio/interno/contas")  (esperado 403)"
fi
if [ "$CONTAS" = 1 ]; then
  echo "== leitura real (GET /v1/accounts?platform=instagram, só leitura)"
  curl -s -m 30 http://172.18.0.1:7891/interno/contas; echo
fi
if [ "$WEBHOOK" = 1 ] && [ "$SECO" = 0 ]; then
  echo "== webhook na Zernio (https://$HOST/zernio/webhook)"
  [ -s "$ETC/zernio.key" ] || { echo "  FALTA a chave da Zernio"; exit 6; }
  CFG="$(mktemp "$ETC/.curl.XXXXXX")"; CORPO="$(mktemp "$ETC/.wh.XXXXXX")"
  trap 'rm -f "$CFG" "$CORPO"' EXIT
  # chave só em arquivo 0600 lido pelo curl (--config), nunca em argumento
  printf 'header = "authorization: Bearer %s"\nheader = "content-type: application/json"\n' "$(cat "$ETC/zernio.key")" > "$CFG"
  JA="$(curl -s -m 20 -K "$CFG" https://zernio.com/api/v1/webhooks/settings | python3 -I -c 'import json,sys
try: print(any(w.get("url")==sys.argv[1] for w in json.load(sys.stdin).get("webhooks",[])))
except Exception: print("erro")' "https://$HOST/zernio/webhook")"
  if [ "$JA" = True ]; then echo "  já registrado (nada feito)"
  elif [ "$JA" = erro ]; then echo "  FALHA: não consegui listar os webhooks da Zernio"; exit 6
  else
    python3 -I -c 'import json,sys; print(json.dumps({"name":"CRM equipe (headturbo-zernio)","url":sys.argv[1],"secret":open(sys.argv[2]).read().strip(),"events":["post.scheduled","post.published","post.failed","post.partial","post.cancelled"]}))' "https://$HOST/zernio/webhook" "$ETC/webhook.secret" > "$CORPO"
    echo "  registrar: HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 20 -K "$CFG" --data-binary @"$CORPO" https://zernio.com/api/v1/webhooks/settings)"
  fi
fi
echo "PRONTO (mudanças nesta rodada: $([ $MUDOU = 1 ] && echo sim || echo não))"
