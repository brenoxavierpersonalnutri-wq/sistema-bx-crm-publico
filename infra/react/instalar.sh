#!/usr/bin/env bash
# headturbo-react: instala ou atualiza o serviço do Estúdio React na VPS. Idempotente: rodar de novo só refaz o que mudou.
# Rodar como root, de dentro de um checkout do repo (o publicar.sh faz isso sozinho):
#   sudo bash infra/react/instalar.sh                 # instala/atualiza e reinicia (só se algo mudou)
#   sudo bash infra/react/instalar.sh --seco          # só confere e diz o que faria; não grava nada
#   sudo bash infra/react/instalar.sh --sem-caddy
#   sudo bash infra/react/instalar.sh --modelo turbo  # Whisper large-v3-turbo (melhor, ~3x mais lento) em vez do small
#   sudo bash infra/react/instalar.sh --arnes         # depois de instalar, roda o arnês (vídeos sintéticos) no venv
#   sudo bash infra/react/instalar.sh --testar-ia     # + uma chamada mínima ao claude -p (gasta um pouco da cota)
#
# O que faz (cada passo diz "ok", "mudou" ou "FALTA"):
#   1) /etc/headturbo-react (root 0700): url.secret (gerado aqui uma vez; assina o endereço do vídeo pronto) e
#      anon.key (a anon key PÚBLICA do Supabase: copiada do headturbo-zernio ou tirada do bundle do site)
#   2) venv /opt/headturbo-react/venv com faster-whisper (pinado) + numpy, do PyPI, sem custo
#   3) modelo do Whisper em /usr/local/share/headturbo-react/modelo: copiado do que já existe na VPS (kit ou
#      closer) ou baixado do Hugging Face (público, sem chave)
#   4) código em /usr/local/lib/headturbo-react, unidades em /etc/systemd/system (headturbo-react e o ajudante da
#      Edição com IA, headturbo-react-ia: claude -p como turbo, socket só do grupo headturbo-ia), enable + restart se mudou
#   5) ufw: 172.18.0.0/16 -> 172.18.0.1:7892 (só o Caddy)
#   6) Caddy: rota /react no bloco SEU_VPS (backup, adapt num container descartável, reload; se o
#      reload falhar, volta o backup)
#   7) saúde local e pelo Caddy
# Nunca imprime segredo: só nomes, tamanhos, "mudou/igual" e status HTTP.
set -euo pipefail
umask 022

AQUI="$(cd "$(dirname "$0")" && pwd)"
ETC=/etc/headturbo-react
LIB=/usr/local/lib/headturbo-react
VENV=/opt/headturbo-react/venv
MODELO_DIR=/usr/local/share/headturbo-react/modelo
UNIT=/etc/systemd/system/headturbo-react.service
CADDYFILE=/opt/head-turbo/Caddyfile
CADDY_CT=head-turbo-caddy-1
HOST=SEU_VPS
SITE=https://equipe.brenoxavier.com.br
REF=SEU_PROJECT_REF
FW_VERSAO=1.2.1
YTDLP_VERSAO=2026.8.19   # o Instagram muda: para atualizar, troque aqui, rode o arnês do link e publique

SECO=0; SEM_CADDY=0; ARNES=0; TESTAR_IA=0; MODELO=small
while [ $# -gt 0 ]; do
  case "$1" in
    --seco) SECO=1 ;;
    --sem-caddy) SEM_CADDY=1 ;;
    --arnes) ARNES=1 ;;
    --testar-ia) TESTAR_IA=1 ;;
    --modelo) shift; MODELO="${1:-}" ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "PARADO: argumento desconhecido: $1"; exit 2 ;;
  esac
  shift
done
case "$MODELO" in
  small) REPO_HF=Systran/faster-whisper-small; CACHE_NOME=models--Systran--faster-whisper-small ;;
  turbo) REPO_HF=mobiuslabsgmbh/faster-whisper-large-v3-turbo; CACHE_NOME=models--mobiuslabsgmbh--faster-whisper-large-v3-turbo ;;
  *) echo "PARADO: --modelo precisa ser small ou turbo"; exit 2 ;;
esac
[ "$(id -u)" -eq 0 ] || { echo "PARADO: rode como root (sudo)."; exit 2; }
for bin in python3 ffmpeg ffprobe curl openssl sha256sum systemctl install; do
  command -v "$bin" >/dev/null 2>&1 || { echo "PARADO: falta o comando $bin."; exit 2; }
done
FILTROS="$(ffmpeg -hide_banner -filters 2>/dev/null || true)"   # sem pipe direto no grep -q (pipefail + SIGPIPE)
grep -qE '[[:space:]]ass[[:space:]]' <<<"$FILTROS" || { echo "PARADO: o ffmpeg da VPS não tem libass (legenda)."; exit 2; }
unset FILTROS
fazer() { if [ "$SECO" = 1 ]; then echo "  (seco) faria: $*"; else "$@"; fi; }

MUDOU=0
echo "== 1) credenciais em $ETC"
fazer install -d -m 0700 -o root -g root "$ETC"
if [ -s "$ETC/url.secret" ]; then echo "  url.secret: já existe (mantido)"
elif [ "$SECO" = 1 ]; then echo "  (seco) geraria url.secret"
else (umask 077; openssl rand -hex 32 | tr -d '\n' > "$ETC/url.secret"); chmod 600 "$ETC/url.secret"; echo "  url.secret: gerado"; MUDOU=1; fi

ANON=""
if [ -s /etc/headturbo-zernio/anon.key ]; then ANON="$(cat /etc/headturbo-zernio/anon.key)"; ORIGEM="headturbo-zernio"
else
  ORIGEM="bundle do site"
  ANON="$(python3 -I - "$SITE" "$REF" <<'PY'
import base64, json, re, sys, urllib.request
site, ref = sys.argv[1], sys.argv[2]
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers={"user-agent": "headturbo-react"}), timeout=20) as r:
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
fi
# só aceita se for a anon do projeto certo
if [ -n "$ANON" ] && python3 -I -c 'import base64,json,sys
p=sys.argv[1].split(".")[1]; p+="="*(-len(p)%4); c=json.loads(base64.urlsafe_b64decode(p))
sys.exit(0 if c.get("ref")==sys.argv[2] and c.get("role")=="anon" else 1)' "$ANON" "$REF" 2>/dev/null; then
  echo "  anon key pública: encontrada ($ORIGEM, ${#ANON} caracteres, ref $REF, role anon)"
  if [ "$SECO" = 0 ]; then
    if [ -f "$ETC/anon.key" ] && [ "$(cat "$ETC/anon.key")" = "$ANON" ]; then echo "  anon.key: igual"
    else (umask 077; printf '%s' "$ANON" > "$ETC/anon.key"); chmod 600 "$ETC/anon.key"; echo "  anon.key: mudou"; MUDOU=1; fi
  fi
elif [ -s "$ETC/anon.key" ]; then echo "  aviso: não li a anon key; mantenho a que já está em $ETC/anon.key"
else echo "PARADO: sem anon key (nem /etc/headturbo-zernio/anon.key nem o site $SITE)"; exit 3; fi
unset ANON

echo "== 2) venv $VENV (faster-whisper $FW_VERSAO + numpy)"
if [ -x "$VENV/bin/python" ] && "$VENV/bin/python" -c "import faster_whisper, numpy, sys; sys.exit(0 if faster_whisper.__version__ == '$FW_VERSAO' else 1)" 2>/dev/null; then
  echo "  venv: ok ($("$VENV/bin/python" -c 'import faster_whisper, numpy; print("faster-whisper", faster_whisper.__version__, "numpy", numpy.__version__)'))"
elif [ "$SECO" = 1 ]; then echo "  (seco) criaria o venv e instalaria faster-whisper==$FW_VERSAO numpy"
else
  install -d -m 0755 /opt/headturbo-react
  [ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
  PIP_DISABLE_PIP_VERSION_CHECK=1 "$VENV/bin/pip" install -q "faster-whisper==$FW_VERSAO" numpy
  "$VENV/bin/python" -c "import faster_whisper, numpy" && echo "  venv: instalado" || { echo "PARADO: o venv não importa faster_whisper"; exit 4; }
  chmod -R a+rX /opt/headturbo-react
  MUDOU=1
fi

echo "== 2b) yt-dlp $YTDLP_VERSAO no venv (vídeo original pelo link do Instagram; sem login nem cookie)"
if [ -x "$VENV/bin/python" ] && "$VENV/bin/python" -c "import importlib.metadata as md, sys; sys.exit(0 if md.version('yt-dlp') == '$YTDLP_VERSAO' else 1)" 2>/dev/null; then
  echo "  yt-dlp: ok ($YTDLP_VERSAO)"
elif [ "$SECO" = 1 ]; then echo "  (seco) instalaria yt-dlp==$YTDLP_VERSAO"
else
  PIP_DISABLE_PIP_VERSION_CHECK=1 "$VENV/bin/pip" install -q "yt-dlp==$YTDLP_VERSAO"
  "$VENV/bin/python" -c "import yt_dlp" && echo "  yt-dlp: instalado ($YTDLP_VERSAO)" || { echo "PARADO: o venv não importa yt_dlp"; exit 4; }
  chmod -R a+rX /opt/headturbo-react
  MUDOU=1
fi

echo "== 3) modelo do Whisper ($MODELO) em $MODELO_DIR"
if [ -s "$MODELO_DIR/model.bin" ] && [ "$(cat "$MODELO_DIR/.origem" 2>/dev/null)" = "$REPO_HF" ]; then
  echo "  modelo: ok ($(du -sh "$MODELO_DIR" | cut -f1), $REPO_HF)"
elif [ "$SECO" = 1 ]; then echo "  (seco) copiaria/baixaria $REPO_HF"
else
  ACHADO=""
  for base in /home/turbo/.local/share/head-turbo/whisper-modelos /home/turbo/closer/asr/models; do
    for snap in "$base/$CACHE_NOME"/snapshots/*/; do
      [ -s "${snap}model.bin" ] && ACHADO="$snap" && break 2
    done
  done
  TMPM="$(mktemp -d /usr/local/share/.react-modelo.XXXXXX)"
  if [ -n "$ACHADO" ]; then
    cp -L "$ACHADO"* "$TMPM"/ && echo "  modelo: copiado de $ACHADO"
  else
    "$VENV/bin/python" -c "import sys; from huggingface_hub import snapshot_download; snapshot_download(sys.argv[1], local_dir=sys.argv[2])" "$REPO_HF" "$TMPM" >/dev/null
    echo "  modelo: baixado de huggingface.co/$REPO_HF"
  fi
  [ -s "$TMPM/model.bin" ] || { rm -rf "$TMPM"; echo "PARADO: modelo sem model.bin"; exit 4; }
  printf '%s' "$REPO_HF" > "$TMPM/.origem"
  rm -rf "$MODELO_DIR"; install -d -m 0755 "$(dirname "$MODELO_DIR")"; mv "$TMPM" "$MODELO_DIR"
  chmod -R a+rX "$MODELO_DIR"
  MUDOU=1
fi

echo "== 4) código e unidade"
if getent group headturbo-ia >/dev/null; then echo "  grupo headturbo-ia: ok"
elif [ "$SECO" = 1 ]; then echo "  (seco) criaria o grupo headturbo-ia"
else groupadd --system headturbo-ia; echo "  grupo headturbo-ia: criado"; MUDOU=1; fi
fazer install -d -m 0755 -o root -g root "$LIB" "$LIB/fontes"
fazer install -d -m 0755 -o root -g root "$LIB/modelos"
for f in headturbo-react.py montagem.py legendas.py sincronia.py edicao_ia.py ia_ponte.py baixar_link.py contexto-head.md \
         fontes/ArchivoBlack-Regular.ttf fontes/OFL.txt fontes/DMSans-Bold.ttf fontes/OFL-DMSans.txt \
         modelos/nativo.json modelos/eduestevesfitness.json modelos/classico.json modelos/planejados.json modelos/LEIA.md; do
  if [ -f "$LIB/$f" ] && cmp -s "$AQUI/$f" "$LIB/$f"; then echo "  $f: igual"
  else fazer install -m 0644 -o root -g root "$AQUI/$f" "$LIB/$f"; echo "  $f: mudou"; MUDOU=1; fi
done
if [ -f "$UNIT" ] && cmp -s "$AQUI/headturbo-react.service" "$UNIT"; then echo "  unidade: igual"
else fazer install -m 0644 -o root -g root "$AQUI/headturbo-react.service" "$UNIT"; fazer systemctl daemon-reload; echo "  unidade: mudou"; MUDOU=1; fi
# ajudante da Edição com IA: claude -p como turbo (assinatura do Breno), socket só para o grupo headturbo-ia
UNIT_IA=/etc/systemd/system/headturbo-react-ia.service
if [ -f "$UNIT_IA" ] && cmp -s "$AQUI/headturbo-react-ia.service" "$UNIT_IA"; then echo "  unidade da IA: igual"
else fazer install -m 0644 -o root -g root "$AQUI/headturbo-react-ia.service" "$UNIT_IA"; fazer systemctl daemon-reload; echo "  unidade da IA: mudou"; MUDOU=1; fi
fazer systemctl enable headturbo-react-ia.service >/dev/null 2>&1 || true
fazer systemctl enable headturbo-react.service >/dev/null 2>&1 || true
if [ "$SECO" = 0 ]; then
  if [ "$MUDOU" = 1 ] || ! systemctl is-active --quiet headturbo-react-ia.service; then
    systemctl restart headturbo-react-ia.service; sleep 1
  fi
  systemctl is-active --quiet headturbo-react-ia.service && echo "  ajudante da IA: ativo ($(stat -c '%U:%G %a' /run/headturbo-react-ia/ia.sock 2>/dev/null || echo 'sem socket'))" \
    || echo "  aviso: o ajudante da IA não subiu (a montagem segue sem IA): journalctl -u headturbo-react-ia -n 20"
  if [ "$MUDOU" = 1 ] || ! systemctl is-active --quiet headturbo-react.service; then
    systemctl restart headturbo-react.service; sleep 2
  fi
  systemctl is-active --quiet headturbo-react.service && echo "  serviço: ativo" || { echo "  FALHA: serviço não subiu"; journalctl -u headturbo-react -n 20 --no-pager; exit 4; }
fi

echo "== 5) ufw"
if command -v ufw >/dev/null 2>&1; then
  if ufw status | grep -q '172.18.0.1 7892/tcp'; then echo "  regra 172.18.0.0/16 -> 172.18.0.1:7892: já existe"
  elif [ "$SECO" = 1 ]; then echo "  (seco) criaria a regra 172.18.0.0/16 -> 172.18.0.1:7892"
  else ufw allow from 172.18.0.0/16 to 172.18.0.1 port 7892 proto tcp comment 'caddy -> headturbo-react' >/dev/null; echo "  regra: criada"; fi
fi

echo "== 6) Caddy"
if [ "$SEM_CADDY" = 1 ]; then echo "  pulado (--sem-caddy)"
else
  CAND="$(mktemp /tmp/Caddyfile.react.XXXXXX)"
  rc=0; python3 -I "$AQUI/caddy-bloco.py" "$CADDYFILE" "$CAND" || rc=$?
  if [ "$rc" = 3 ]; then echo "  rota /react: já está"
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

echo "== 7) saúde"
if [ "$SECO" = 0 ]; then
  sleep 1
  echo "  local:  $(curl -s -m 5 http://172.18.0.1:7892/saude || echo 'sem resposta')"
  echo "  ajudante da IA: $(systemctl is-active headturbo-react-ia.service 2>/dev/null)"
  echo "  Caddy:  HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 10 --resolve "$HOST:443:127.0.0.1" "https://$HOST/react/saude")"
  echo "  sem login (esperado 401): HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 10 --resolve "$HOST:443:127.0.0.1" "https://$HOST/react/v1/estado/00000000-0000-0000-0000-000000000000")"
  echo "  vídeo sem assinatura (esperado 401): HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 10 --resolve "$HOST:443:127.0.0.1" "https://$HOST/react/v1/arquivo/00000000-0000-0000-0000-000000000000/final.mp4")"
  echo "  zernio segue no ar: HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 10 --resolve "$HOST:443:127.0.0.1" "https://$HOST/zernio/saude")"
  echo "  n8n segue fechado para quem não é o dono: HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 10 --resolve "$HOST:443:127.0.0.1" "https://$HOST/")  (esperado 403 daqui)"
fi
if [ "$TESTAR_IA" = 1 ] && [ "$SECO" = 0 ]; then
  echo "== Claude da assinatura (uma chamada mínima, como turbo, fora da pasta do kit; nunca faz login)"
  runuser -u turbo -- env HOME=/home/turbo PATH=/usr/local/bin:/usr/bin:/bin timeout 150 python3 -I "$LIB/ia_ponte.py" --teste \
    | python3 -I -c 'import json,sys; r=json.load(sys.stdin); print("  ok" if r.get("ok") else "  FALHA", {k: r.get(k) for k in ("modelo","tokens_entrada","tokens_saida","segundos","erro") if r.get(k) is not None})' \
    || echo "  FALHA: o teste do Claude não terminou"
fi
if [ "$ARNES" = 1 ] && [ "$SECO" = 0 ]; then
  echo "== arnês (vídeos sintéticos, nice 19, fora do serviço)"
  SAIDA="$(mktemp -d /tmp/arnes-react.XXXXXX)"
  REACT_WHISPER_MODELO="$MODELO_DIR" REACT_FONTES="$AQUI/fontes" HF_HUB_OFFLINE=1 \
    nice -n 19 ionice -c 3 "$VENV/bin/python" "$AQUI/test/arnes.py" --saida "$SAIDA" ${ARNES_VOZES:+--vozes "$ARNES_VOZES"} ${ARNES_FRAMES:+--frames "$ARNES_FRAMES"} || true
fi
echo "PRONTO (mudanças nesta rodada: $([ $MUDOU = 1 ] && echo sim || echo não))"
