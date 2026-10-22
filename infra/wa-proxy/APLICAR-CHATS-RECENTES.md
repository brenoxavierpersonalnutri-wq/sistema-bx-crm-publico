# Proxy da VPS: lista primeiro (rota `chats-recentes`)

**Por quê (18/10/2026):** ao conectar um número, a lista de Conversas tem que aparecer em segundos, já com a última
mensagem real e o horário real de cada conversa (como o WhatsApp Web, SellFlux, Full Funnel). Antes, o CRM fazia uma
leitura de histórico POR conversa pelo proxy (2,2 s cada, teto de 60 leituras/min): 40 conversas levavam ~100 s.

**O que faz:** `POST /v1/chats-recentes { limit?: 1-100 (60), porChat?: 1-30 (1), sessao? }`

1. `GET /sessions/:id/chats` no OpenWA local (lista em ordem de atividade); fica só contato (@c.us/@lid) e grupo;
2. para cada uma das `limit` conversas mais recentes, `GET .../messages/:chatId/history?limit=porChat` no OpenWA
   local, 4 por vez, teto de 45 s no total; @lid sem telefone tenta `contacts/:id/phone`;
3. responde `{ itens: [{ chatId, kind, phone, name, timestamp, mensagens: [...] }], parcial }`. Cada mensagem vai
   sem base64 de mídia (só `mimetype`/`filename`): a mídia continua sob demanda pela rota `media-id`.

Conta como UMA leitura no limitador de 60/min (o fan-out é dentro da VPS, no OpenWA local). Rota só de leitura.

Sem esta rota o CRM continua funcionando: a edge function `whatsapp-import-history` (modo `recentes`) detecta o
404 "não existe" do proxy antigo e cai no caminho lento de antes (lista + histórico conversa a conversa).

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
curl -s http://127.0.0.1:2786/healthz                                                        # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:2786/v1/chats-recentes      # 401 (rota existe, sem assinatura)
sudo docker ps --format '{{.Names}} {{.Status}}' | grep openwa-api                           # mesmo "Up" de antes
```

Na tela Conexões, no cartão do número: "Trazer conversas". Com a rota nova vem em segundos; sem ela, o toast avisa
"modo lento".

## Voltar atrás

```bash
B=$(ls -d /opt/headturbo-wa-proxy.bak-* | tail -1)
sudo install -m 0644 "$B/lib.mjs" "$B/server.mjs" /opt/headturbo-wa-proxy/
cd /opt/headturbo-wa-proxy && sudo docker compose build wa-proxy && sudo docker compose up -d --force-recreate --no-deps wa-proxy
```
