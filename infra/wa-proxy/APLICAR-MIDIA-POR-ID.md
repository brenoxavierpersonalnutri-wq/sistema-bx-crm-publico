# Proxy da VPS: mídia pelo ID da mensagem (rota `media-id`)

**Problema (17/10/2026):** 176 mídias em `whatsapp_messages` com `media_status='falhou'`; 153 com "não está entre as
30 mensagens mais recentes do chat". A edge function só achava a mídia no arquivo guardado pelo OpenWA ou num
histórico fixo de 30 mensagens com `includeMedia`.

**O que o OpenWA v0.24.0 oferece** (conferido no código da tag `v0.24.0`, commit `e9afb97`):

- `GET /sessions/:id/messages/:chatId/:messageId/media` serve só mídia GUARDADA (arquivo do archive ou cópia
  inline na linha da mensagem). Não vai ao WhatsApp. 404 se nada foi guardado.
- `GET .../:chatId/history?limit=N&includeMedia=true` baixa de novo pelo WhatsApp Web, com teto de 100 mensagens
  (`MAX_CHAT_HISTORY_LIMIT`). `deep=true` chega a 2000, mas é só metadado (força `includeMedia` desligado).
- **Não existe** download por `messageId` direto no WhatsApp nessa versão. Mensagem além das 100 mais recentes do
  chat, sem arquivo guardado, não tem como ser baixada pelo OpenWA v0.24.0.

**Rota nova `media-id`** `{ chatId, messageId, sessao? }`, resposta binária (`X-Midia-Fonte: arquivo | historico-N`):

1. arquivo guardado (`.../:messageId/media`), que vale para qualquer idade;
2. sem arquivo: histórico SEM mídia das 100 mais recentes, só para achar a posição N da mensagem;
3. histórico COM mídia `limit=N`: ela é a mais antiga da página, então é baixada primeiro, dentro do orçamento.

Erros: `404 {"error":"fora-da-janela"}` (além das 100, sem arquivo, definitivo), `404 sem-midia | midia-indisponivel`,
`409 {"error":"sessao-desconectada"}` (OpenWA 409, ou 400 "not connected"), `502` (5xx/timeout do OpenWA, transitório).
A edge function (`_shared/waMidia.ts` + `_shared/waMidiaRegras.ts`) repete o 502 com espera de 1 s, 3 s e 8 s, espera a
sessão voltar a `ready` (até 30 s) no 409, e com proxy antigo (404 "não existe") cai para a rota `media` de antes.

## Aplicar

Do Mac, na pasta do repo:

```bash
scp infra/wa-proxy/lib.mjs infra/wa-proxy/server.mjs head-turbo-vps:/tmp/
```

Na VPS (`ssh head-turbo-vps`). Só o container do proxy é recriado; o `headturbo-openwa-api` não é tocado:

```bash
sudo cp -a /opt/headturbo-wa-proxy /opt/headturbo-wa-proxy.bak-$(date +%F-%H%M)
sudo install -m 0644 /tmp/lib.mjs /tmp/server.mjs /opt/headturbo-wa-proxy/
cd /opt/headturbo-wa-proxy
sudo docker compose build wa-proxy
sudo docker compose up -d --force-recreate --no-deps wa-proxy
```

## Conferir

```bash
curl -s http://127.0.0.1:2786/healthz                                                   # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:2786/v1/media-id      # 401 (rota existe, sem assinatura)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:2786/v1/send-video    # 404 (continua não existindo)
sudo docker ps --format '{{.Names}} {{.Status}}' | grep openwa-api                      # mesmo "Up" de antes
```

Depois publicar as funções `openwa-webhook`, `whatsapp-backfill` e `whatsapp-import-history` e reenfileirar:

```sql
UPDATE whatsapp_messages
   SET media_status = 'pendente', media_tentativas = 0, media_erro = NULL
 WHERE media_status = 'falhou';
```

(`media_tentativas = 0` é obrigatório: o tick do `whatsapp-backfill` só pega `media_tentativas < 3`.) As que estiverem
além das 100 mais recentes e sem arquivo voltam a `falhou` na primeira passada, com o motivo escrito em `media_erro`.

## Voltar atrás

```bash
B=$(ls -d /opt/headturbo-wa-proxy.bak-* | tail -1)
sudo install -m 0644 "$B/lib.mjs" "$B/server.mjs" /opt/headturbo-wa-proxy/
cd /opt/headturbo-wa-proxy && sudo docker compose build wa-proxy && sudo docker compose up -d --force-recreate --no-deps wa-proxy
```

Com o proxy antigo as funções novas continuam funcionando: `media-id` dá 404 "não existe" e elas usam a rota `media`.
