#!/usr/bin/env bash
# Manda 1 requisição de AMOSTRA (dados falsos, "teste": true) para o Inbound
# Webhook do Full Funnel, para ele aprender o formato e salvar o gatilho.
# O JSON é o que a migration gera (amostra-payload.json, saída dos testes).
# Uso: bash supabase/tests/fullfunnel/enviar-amostra.sh 'https://services.leadconnectorhq.com/hooks/.../webhook-trigger/<id>'
set -euo pipefail
URL="${1:?passe a URL do Inbound Webhook}"
case "$URL" in https://*) ;; *) echo "URL precisa ser https" >&2; exit 2;; esac
AQUI="$(cd "$(dirname "$0")" && pwd)"
curl -sS -m 20 -X POST "$URL" -H 'Content-Type: application/json' \
  --data-binary @"$AQUI/amostra-payload.json" -w '\nHTTP %{http_code}\n'
