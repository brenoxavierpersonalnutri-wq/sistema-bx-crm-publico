# YouTube conectado (OAuth do Google) e preparo do Facebook

O estúdio de lives (`/lives`) conecta o canal do YouTube sem colar chave, como o StreamYard:
botão **Conectar conta do YouTube** → login do Google num popup → o canal aparece no modal de destinos.
No **Ir ao vivo**, o `live-control` cria a transmissão no canal (título, descrição e privacidade do destino),
reusa um liveStream RTMP de resolução variável, faz o bind e entrega ao Egress o endereço RTMPS + streamName
(a chave nunca vai pro navegador). O broadcast nasce com `enableAutoStart`/`enableAutoStop`; se o auto start
não pegar, a tela chama `youtube-status` a cada 10 s e a função faz `transition → live` quando o stream fica
`active`. No **Encerrar**, `transition → complete`. O link "ver no YouTube" usa o id do broadcast (é o id do vídeo).
A opção manual (colar servidor + chave) continua no modal, em "Avançado".

## Peças

| Peça | O que faz |
|---|---|
| `supabase/migrations/20261027100000_lives_youtube.sql` | `yt_contas` (token cifrado, sem SELECT pro front), `yt_oauth_estados` (state anti-CSRF), colunas `modo`/`yt_*` em `live_destinations`, funções `google_pareamento_*` |
| `supabase/functions/youtube-oauth` | iniciar login, volta do Google (troca o code no servidor, cifra o refresh_token), status, desconectar (revoga) |
| `supabase/functions/google-pareamento` | a VPS entrega UMA vez o client ID/secret (IP da VPS + HMAC + nonce, igual ao `live-pareamento`) |
| `supabase/functions/live-control` | `salvar-destino-youtube`, `youtube-status`; `ir-ao-vivo`/`encerrar`/`destino-ativo` sabem do modo `youtube_api` |
| `supabase/functions/_shared/youtube.ts`, `youtubeDb.ts` | chamadas da API, cifra do token, regras puras (testadas em `src/test/youtube.test.ts`) |
| `infra/google/headturbo-google-parear` | script root da VPS que faz o pareamento |
| `src/pages/lives/YoutubeRetorno.tsx` | página do popup: avisa o estúdio e fecha |

Secrets: nenhum novo obrigatório. O token é cifrado com o `LIVE_CHAVES_SEGREDO` que as lives já usam
(contexto HKDF próprio). As credenciais do app vêm de `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` no env da
função **ou** de `integracao_config.google_oauth`, que é o caminho previsto (o Breno não cola segredo).

## Checklist do Breno no Google Cloud (uma vez)

1. Entrar em https://console.cloud.google.com com a conta dona do canal e **criar um projeto** (ex.: "Estúdio BX").
2. **APIs e serviços → Biblioteca → YouTube Data API v3 → Ativar.**
3. **Tela de consentimento OAuth** (Google Auth Platform → Branding/Público): tipo **Externo**, nome do app,
   e-mail de suporte; em **Público**, deixar em **Teste** e adicionar o e-mail dele como **usuário de teste**.
   Em modo teste basta pra uso próprio (até 100 usuários de teste, sem verificação do Google). Observação:
   em modo teste o Google expira o refresh token em 7 dias; quando isso acontecer, a conta aparece como
   desconectada e é só clicar em "Conectar" de novo. Pra não expirar, publicar o app (o escopo
   `youtube.force-ssl` é sensível e a publicação pede verificação).
4. **Escopo** (Acesso a dados): `https://www.googleapis.com/auth/youtube.force-ssl`.
5. **Credenciais → Criar credencial → ID do cliente OAuth → Aplicativo da Web.**
   URI de redirecionamento autorizado, exatamente:
   `https://SEU_PROJECT_REF.supabase.co/functions/v1/youtube-oauth`
6. Guardar o client ID e o client secret **pelo cofre**, no terminal do Mac (o script pergunta sem eco e leva pra VPS):
   ```bash
   bash ~/.claude/head-turbo/bin/guardar-chave.sh GOOGLE_CLIENT_ID --testar nenhum --levar-vps
   bash ~/.claude/head-turbo/bin/guardar-chave.sh GOOGLE_CLIENT_SECRET --testar nenhum --levar-vps
   ```
7. **Canal habilitado para live**: https://www.youtube.com/features → "Transmissões ao vivo". Na primeira vez
   o YouTube leva até 24 h pra liberar (exige telefone verificado).

Depois disso (Paulo): rodar a migration, publicar `youtube-oauth`, `google-pareamento` e `live-control`,
instalar o script na VPS e parear:
```bash
sudo install -o root -g root -m 0700 infra/google/headturbo-google-parear /usr/local/sbin/
sudo headturbo-google-parear             # seco
sudo headturbo-google-parear --executar  # grava em integracao_config.google_oauth; mostra só o hash
```

## Cota da API (YouTube Data API v3)

Cota padrão: **10.000 unidades por dia** por projeto, zera à meia-noite do horário do Pacífico
(fonte: developers.google.com/youtube/v3/determine_quota_cost, conferido em 17/10/2026). Custo por chamada,
na tabela atual: `liveBroadcasts.insert` 1, `liveBroadcasts.bind` 1, `liveBroadcasts.transition` 1,
`liveBroadcasts.list` 1, `liveStreams.insert` 1, `liveStreams.list` 1, `channels.list` 1. A troca/renovação
de token (oauth2.googleapis.com) não gasta cota.

Uma live típica gasta pouco: conectar (1) + ir ao vivo (stream list 1 + broadcast insert 1 + bind 1) +
conferência a cada 10 s enquanto não entra no ar (2 por conferência; para quando fica "ao vivo") + encerrar (1).
Na ordem de dezenas de unidades por live.

## Facebook (preparado, não implementado)

Mesmo desenho, pela **Live Video API** da Página (Graph API):
`POST /{page-id}/live_videos?status=LIVE_NOW&title=…&description=…` com o *Page access token* devolve
`secure_stream_url` (RTMPS com a chave); o Egress recebe essa URL; no encerrar,
`POST /{live-video-id}?end_live_video=true`. Precisaria de: app da Meta com o produto Facebook Login,
permissões `pages_manage_posts`, `pages_read_engagement`, `pages_show_list` e `publish_video` (revisão da Meta
pra uso fora do modo de desenvolvimento), tabela `fb_paginas` no molde de `yt_contas`, função `facebook-oauth`
no molde de `youtube-oauth` (dá pra reaproveitar a cifra e o state) e o modo `facebook_api` em
`live_destinations`. Até lá, o Facebook segue pela chave manual.
