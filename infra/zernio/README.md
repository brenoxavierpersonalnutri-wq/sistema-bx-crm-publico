# headturbo-zernio: publicar e agendar no Instagram pelo board de Conteúdo

O botão "Publicar no Instagram" de cada card do `/conteudo` abre um painel (conta, tipo, mídia, legenda, agora ou
agendado). Quem fala com a Zernio é este serviço na VPS, não edge function do Lovable nem o navegador: a chave fica
na VPS. O estado de cada envio fica em `conteudo_publicacoes` no Supabase.

```
navegador (CRM logado) --JWT--> https://SEU_VPS/zernio/*  (Caddy)
                                   -> headturbo-zernio 172.18.0.1:7891 (systemd, DynamicUser)
                                        -> Supabase: /auth/v1/user + RPC conteudo_meu_acesso (com o JWT do usuário)
                                        -> Zernio:   https://zernio.com/api/v1/... (Bearer, chave do cofre)
                                        -> Supabase: conteudo_pub_criar (JWT do usuário) / conteudo_pub_sincronizar (segredo)
Zernio --webhook HMAC--> /zernio/webhook   (opcional; sem ele a consulta periódica de 60 s cobre)
```

## Peças

| Arquivo | O que é |
|---|---|
| `server.mjs` | serviço HTTP (Node 22, só biblioteca padrão) |
| `lib.mjs` | validação, montagem do post, tradução de status/erro, HMAC (puro, testado) |
| `headturbo-zernio.service` | unidade systemd (segredos por `LoadCredential`, nada em env) |
| `instalar.sh` | instala/atualiza na VPS, idempotente (`--seco`, `--contas`, `--sem-caddy`) |
| `publicar.sh` | roda no Mac: origin/main -> espelho na VPS -> git pull -> `instalar.sh` |
| `caddy-bloco.py` | põe a rota `/zernio` no bloco `SEU_VPS` sem abrir o n8n |
| `test/` | `node --test infra/zernio/test/` (Zernio e Supabase falsos; nada sai da máquina) |
| `../../supabase/migrations/20261124100000_conteudo_publicacoes.sql` | tabela, RLS e RPCs |
| `../../supabase/tests/conteudo-publicacoes/rodar.sh` | testa a migration num Postgres descartável |

## Rotas (prefixo `/zernio` no Caddy)

| Rota | Quem | O que faz |
|---|---|---|
| `GET /saude` | aberto | `{ok, chave_zernio, pareado}` |
| `GET /v1/contas` | JWT + Conteúdo | contas Instagram da Zernio (id, @, nome, foto, ativa) |
| `POST /v1/midia` | JWT + Conteúdo | corpo = arquivo (JPG/PNG/WEBP/MP4/MOV, até 1 GB): presign na Zernio e PUT; devolve `{url, tipo}` |
| `POST /v1/publicar` | JWT + Conteúdo | valida, grava a linha, cria o post na Zernio (agendado), devolve status |
| `POST /v1/cancelar` | JWT + Conteúdo | `DELETE /v1/posts/{id}` na Zernio e marca cancelado |
| `POST /webhook` | HMAC da Zernio | `post.scheduled/published/failed/partial/cancelled` |
| `GET /interno/contas` | só de dentro da VPS | prova de conexão (uma leitura) |

"Acesso ao Conteúdo" = usuário aprovado e (admin ou módulo `conteudo` em Usuários). O board em si continua aberto
para todo aprovado; o módulo só libera o botão e a lista.

"Postar agora" vai para a Zernio como agendado para daqui a 60 s, não como `publishNow`: o `publishNow` publica
dentro da mesma requisição (vídeo pode passar de minuto e derrubar a conexão sem devolver o id do post), e assim dá
para cancelar no intervalo. Horário no passado é recusado aqui: a Zernio publicaria na hora.

## API da Zernio usada (fonte: https://docs.zernio.com/api/openapi, v1.321.0, lida em 21/10/2026)

- base `https://zernio.com/api`, `Authorization: Bearer <chave>`
- `GET /v1/accounts?platform=instagram` (listAccounts)
- `POST /v1/media/presign` `{filename, contentType, size}` -> `{uploadUrl, publicUrl}`; PUT do arquivo no `uploadUrl`
- `POST /v1/posts` (createPost) com `platforms:[{platform:"instagram", accountId, platformSpecificData}]`,
  `mediaItems`, `content`, `scheduledFor`, `timezone`, `metadata`, cabeçalho `Idempotency-Key` (= id da linha)
  - story: `platformSpecificData.contentType = "story"`; reels: `shareToFeed: true`; carrossel = várias `mediaItems`
- `GET /v1/posts/{id}` (status, `platforms[].platformPostUrl`, `errorMessage`, `errorCategory`)
- `DELETE /v1/posts/{id}` (qualquer status menos publicado)
- webhooks: `POST /v1/webhooks/settings` `{name, url, events, secret}`; assinatura `X-Zernio-Signature` =
  HMAC-SHA256 hex do corpo cru (https://docs.zernio.com/webhooks); payload em `WebhookPayloadPost` (`post.id`,
  `post.metadata`, `platforms[].publishedUrl`, `error`)

## Instalar / atualizar (no Mac)

```bash
bash infra/zernio/publicar.sh --seco     # confere tudo, não grava nada na VPS além do espelho do repo
bash infra/zernio/publicar.sh            # instala/atualiza e reinicia
bash infra/zernio/publicar.sh --contas   # + UMA leitura real das contas (prova a chave)
```

Na VPS, à mão: `sudo bash /opt/headturbo-zernio/src/infra/zernio/instalar.sh`.
Logs: `journalctl -u headturbo-zernio -n 50`. Desligar: `systemctl disable --now headturbo-zernio` (a rota do Caddy
passa a dar 502; o n8n não é afetado). Voltar o Caddy: o instalador deixa `Caddyfile.bak-<data>` em `/opt/head-turbo`.

## A chave

O instalador copia `ZERNIO_API_KEY` do cofre do kit na VPS (`/home/turbo/.config/head-turbo/cofre.env`) para
`/etc/headturbo-zernio/zernio.key` (root 0600) e o systemd entrega ao processo. Ninguém cola a chave em chat.
O Breno, no terminal do Mac:

```bash
bash ~/.claude/head-turbo/bin/guardar-chave.sh ZERNIO_API_KEY --testar zernio   # pergunta a chave sem eco e testa
bash ~/.claude/head-turbo/bin/guardar-chave.sh ZERNIO_API_KEY --levar-vps       # copia para o cofre da VPS
bash infra/zernio/publicar.sh --contas    # o instalador pega a chave nova, reinicia e faz UMA leitura das contas
```
A chave é gerada em https://zernio.com/dashboard/api-keys (catálogo do kit, `servicos-chave.tsv`).

Trocou a chave: o mesmo par de comandos (o instalador vê que mudou e reinicia).

## Pareamento com o banco (automático)

O serviço tem um segredo próprio (`sync.secret`, gerado na VPS); o banco guarda só o sha256 dele. Na primeira vez
que um admin abre o painel de publicação com o serviço no ar, o serviço grava o hash com o JWT desse admin
(`conteudo_zernio_parear`). Antes disso a publicação responde "serviço ainda não pareado". Trocar o segredo:
apagar `/etc/headturbo-zernio/sync.secret`, rodar `SELECT public.conteudo_zernio_reabrir();` no SQL e reinstalar.

## Webhook (opcional, precisa de OK do Breno: é escrita na conta da Zernio)

Sem webhook o serviço consulta a Zernio a cada 60 s (posts vencendo em até 2 min ou publicando) e a cada ~30 min
(agendados distantes). Com webhook o card vira "publicado" na hora. Registrar (confere antes se já existe; a
chave vai ao curl por arquivo 0600, nunca por argumento):

```bash
bash infra/zernio/publicar.sh --registrar-webhook
```
