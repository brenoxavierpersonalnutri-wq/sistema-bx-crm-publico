# Proxy da VPS: envio para grupo (módulo Grupos do CRM)

O que muda no `headturbo-wa-proxy` (código em `lib.mjs` / `server.mjs`, testes em `src/test/grupos.test.ts`):

| Rota | O que faz |
|---|---|
| `group-allowlist` | o CRM grava a lista de grupos (`…@g.us`, até 500) que podem receber; fica em `/data/grupos-permitidos.json` |
| `send-group-text` | `{ chatId, text, linkPreview?, sessao? }` para UM grupo da allowlist |
| `send-group-media` | `{ chatId, kind: image\|video\|audio\|document, url (https), caption?, filename?, sessao? }` |
| `group-invite` | leitura: link de convite do grupo (a sessão precisa ser admin) |

As rotas de telefone (`send-text`, `send-image`, `send-document`) continuam recusando grupo. Grupo fora da
allowlist = 403. Limite próprio do envio a grupo: 6 por minuto, 200 por dia e 8 s entre envios, por sessão
(`/data/limites-grupo.json`), separado dos 20/min e 300/dia de telefone.

Multi-sessão (contrato da Central, `supabase/functions/_shared/numerosWa.ts`): `sessao` no corpo assinado é o
NOME da sessão OpenWA do número (`crm_numeros.sessao_openwa`). Vale em todas as rotas (envio a telefone, status,
qr, grupos), só para nomes listados em `OPENWA_SESSOES_EXTRAS` no `proxy.env`. Sem `sessao`, usa a sessão padrão
(`OPENWA_SESSION_NAME`, hoje `closer`). As funções só mandam `sessao` com o secret `WA_PROXY_MULTISESSAO=1`.

## Aplicar (não foi aplicado; quem aplica é o Breno ou o Paulo com OK dele)

Do Mac, na pasta do repo:

```bash
scp infra/wa-proxy/lib.mjs infra/wa-proxy/server.mjs head-turbo-vps:/tmp/
```

Na VPS (`ssh head-turbo-vps`):

```bash
sudo cp -a /opt/headturbo-wa-proxy /opt/headturbo-wa-proxy.bak-$(date +%F-%H%M)
sudo install -m 0644 /tmp/lib.mjs /tmp/server.mjs /opt/headturbo-wa-proxy/
# só se for usar um número dedicado: acrescentar a linha abaixo no proxy.env (editor, não echo)
#   OPENWA_SESSOES_EXTRAS=<sessao-do-numero-dedicado>[,<outra>]
# e garantir que a chave OPERATOR do OpenWA tem essa sessão no allowedSessions.
cd /opt/headturbo-wa-proxy
sudo docker compose build wa-proxy
sudo docker compose up -d --force-recreate --no-deps wa-proxy
```

## Conferir

```bash
sudo docker logs --tail 3 headturbo-wa-proxy          # linha "inicio" com sessoesExtras e gruposPermitidos
curl -s http://127.0.0.1:2786/healthz                  # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:2786/v1/send-group-text   # 401 (rota existe, sem assinatura)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:2786/v1/send-bulk         # 404 (continua não existindo)
```

Depois, no CRM: Grupos > campanha > Relatório mostra "último tick" sem "ERRO no proxy".

## Voltar atrás

```bash
B=$(ls -d /opt/headturbo-wa-proxy.bak-* | tail -1)
sudo install -m 0644 "$B/lib.mjs" "$B/server.mjs" /opt/headturbo-wa-proxy/
cd /opt/headturbo-wa-proxy && sudo docker compose build wa-proxy && sudo docker compose up -d --force-recreate --no-deps wa-proxy
```

Com o proxy antigo, o CRM não envia nada: o tick registra `erro_allowlist: proxy 404` e as mensagens ficam
em "enviando". Envio atrasado mais de 30 min vira "falhou" e não sai depois (aviso velho no grupo é pior que nenhum).

## Envio MANUAL a grupo (tela Conversas) — aplicado em 18/10/2026

| Rota | O que faz |
|---|---|
| `send-group-manual-text` | `{ chatId, text, sessao? }`: o atendente digitando, para QUALQUER grupo em que a sessão é membro |
| `send-group-manual-media` | `{ chatId, kind, url (https), caption?, filename?, ptt?, sessao? }`; `ptt: true` só com `kind: audio` (nota de voz Ogg/Opus) |

Sem allowlist (quem confere a participação é o WhatsApp: grupo em que a sessão não está volta erro do OpenWA).
Limite anti-loop próprio, por sessão: 60/min e 1000/dia, sem intervalo mínimo (`/data/limites-grupo-manual.json`).
A allowlist e os 6/min, 200/dia, 8 s continuam valendo só para o disparo automático (`send-group-text`/`-media`).
Quem chama: `whatsapp-send` e `whatsapp-send-media`, só com `manual: true` no corpo e usuário logado
(`supabase/functions/_shared/envioGrupoManual.ts`). Automação, fluxo e IA não mandam a flag e não passam por aqui.

Aplicado na VPS com backup em `/opt/headturbo-wa-proxy/backup-20261018-040759-grupo-manual/` (lib.mjs e server.mjs
de antes); rebuild só do `wa-proxy` (`--no-deps`), openwa-api sem reinício. Voltar atrás: copiar os dois arquivos do
backup e repetir o build/up do bloco "Voltar atrás" acima.
