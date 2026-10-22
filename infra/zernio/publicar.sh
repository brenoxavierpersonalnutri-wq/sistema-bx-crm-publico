#!/usr/bin/env bash
# Publica o headturbo-zernio na VPS a partir do repo (rodar no Mac, em qualquer checkout do funnel-friend-tool):
#   bash infra/zernio/publicar.sh            # origin/main -> VPS, git pull lá, instalar.sh (reinicia o serviço)
#   bash infra/zernio/publicar.sh --seco     # idem, mas o instalar.sh só confere
#   bash infra/zernio/publicar.sh --contas   # idem + UMA leitura real das contas da Zernio
#
# A VPS não tem credencial do GitHub. Por isso o Mac empurra a origin/main para um repo nu na VPS
# (/opt/headturbo-zernio/repo.git, root 0700) e a VPS faz o git pull desse espelho em /opt/headturbo-zernio/src.
# Clone raso no Mac também serve (receive.shallowUpdate). O espelho segue a origin/main mesmo quando o Lovable reescreve a main (push com +, checkout com reset).
set -euo pipefail
VPS="${VPS:-head-turbo-vps}"
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
git -C "$REPO" fetch -q origin main
echo "origin/main: $(git -C "$REPO" log -1 --format='%h %s' origin/main)"
ssh "$VPS" 'set -e; install -d -m 0700 /opt/headturbo-zernio; [ -d /opt/headturbo-zernio/repo.git ] || git init -q --bare /opt/headturbo-zernio/repo.git; git -C /opt/headturbo-zernio/repo.git config receive.shallowUpdate true; git -C /opt/headturbo-zernio/repo.git symbolic-ref HEAD refs/heads/main'
git -C "$REPO" push -q "ssh://$VPS/opt/headturbo-zernio/repo.git" "+refs/remotes/origin/main:refs/heads/main"
ssh "$VPS" "set -e; cd /opt/headturbo-zernio; [ -d src/.git ] || git clone -q repo.git src; cd src
  git fetch -q origin; git checkout -q -B main origin/main 2>/dev/null || true; git reset -q --hard origin/main
  echo \"VPS checkout: \$(git log -1 --format='%h %s')\"
  bash infra/zernio/instalar.sh $*"
