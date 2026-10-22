#!/usr/bin/env bash
# Publica o headturbo-react na VPS a partir do repo (rodar no Mac, em qualquer checkout do funnel-friend-tool):
#   bash infra/react/publicar.sh            # origin/main -> VPS, git pull lá, instalar.sh (reinicia se mudou)
#   bash infra/react/publicar.sh --seco     # idem, mas o instalar.sh só confere
#   bash infra/react/publicar.sh --arnes    # idem + roda o arnês (vídeos sintéticos) no venv do serviço
#
# A VPS não tem credencial do GitHub: o Mac empurra a origin/main para um repo nu na VPS
# (/opt/headturbo-react/repo.git, root 0700) e a VPS faz o checkout desse espelho em /opt/headturbo-react/src.
# Segue a origin/main mesmo quando o Lovable reescreve a main (push com +, checkout com reset).
set -euo pipefail
VPS="${VPS:-head-turbo-vps}"
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
REF="${REACT_REF:-refs/remotes/origin/main}"
git -C "$REPO" fetch -q origin main
echo "publicando: $(git -C "$REPO" log -1 --format='%h %s' "$REF")"
ssh "$VPS" 'set -e; install -d -m 0755 /opt/headturbo-react; [ -d /opt/headturbo-react/repo.git ] || { git init -q --bare /opt/headturbo-react/repo.git; chmod 700 /opt/headturbo-react/repo.git; }; git -C /opt/headturbo-react/repo.git config receive.shallowUpdate true; git -C /opt/headturbo-react/repo.git symbolic-ref HEAD refs/heads/main'
git -C "$REPO" push -q "ssh://$VPS/opt/headturbo-react/repo.git" "+$REF:refs/heads/main"
ssh "$VPS" "set -e; cd /opt/headturbo-react; [ -d src/.git ] || git clone -q repo.git src; chmod 700 src; cd src
  git fetch -q origin; git checkout -q -B main origin/main 2>/dev/null || true; git reset -q --hard origin/main
  echo \"VPS checkout: \$(git log -1 --format='%h %s')\"
  bash infra/react/instalar.sh $*"
