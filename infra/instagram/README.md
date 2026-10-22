# Instagram: pareamento das credenciais do app (VPS -> CRM)

O "Conectar Instagram" do CRM precisa do `IG_APP_ID` e do `IG_APP_SECRET` do app da Meta. Ninguém cola esses
valores no painel: a VPS entrega **uma vez** pela `instagram-oauth` (`POST ?evento=parear`), no mesmo molde do
`headturbo-live-parear` e do `headturbo-google-parear`. O segredo que cifra os tokens (`instagram_token_segredo`)
não viaja: a migration `20261026120100_instagram_pareamento.sql` gera no banco.

## Como funciona

| Peça | O que faz |
|---|---|
| `supabase/migrations/20261026120100_instagram_pareamento.sql` | `integracao_config` (`instagram_app`, `instagram_token_segredo`), nonces, `instagram_pareamento_aceita/gravar/reabrir` |
| `supabase/functions/instagram-oauth` (`?evento=parear`) | confere IPv4 da VPS -> uso único -> HMAC -> grava atômico (nonce único) |
| `supabase/functions/_shared/pareamentoIg.ts` | valida o corpo `{"app_id","app_secret"}` (só dígitos; 32 hex) |
| `infra/instagram/headturbo-ig-parear` | script root da VPS (bash) que monta, assina e envia |

O script lê `IG_APP_ID`/`IG_APP_SECRET` do cofre do kit (`/home/turbo/.config/head-turbo/cofre.env`; outro caminho:
`HEADTURBO_COFRE=/caminho`) e o `WA_PROXY_SECRET` de `/etc/headturbo-wa-proxy/proxy.env` (o mesmo que os outros
pareamentos usam). Assina `"<ts>.<nonce>.<corpo>"` com HMAC-SHA256 (cabeçalhos `x-live-ts`, `x-live-nonce`,
`x-live-assinatura`; janela de 5 min; nonce `token_urlsafe(24)`), envia por IPv4 e confere o hash que a função devolve
(12 hex do sha256 do JSON gravado) contra o calculado aqui.

Nunca imprime valor: só nomes, tamanhos, status HTTP e o hash. Nada de segredo em argv: o corpo entra no curl por
stdin, os cabeçalhos por `--config` num `/dev/fd`, e a chave do HMAC por variável de ambiente só do processo que assina.

A Meta não é consultada: o app do Instagram Login não tem endpoint de checagem só com id + secret (o
`client_credentials` do graph.facebook.com é do app do Facebook, que tem outro id). O par se prova no primeiro
"Conectar Instagram"; se o secret estiver errado, a troca do code falha lá e é rearmar e parear de novo.

## Antes (uma vez, no Mac do Breno)

```bash
bash ~/.claude/head-turbo/bin/guardar-chave.sh IG_APP_ID --testar nenhum --levar-vps
bash ~/.claude/head-turbo/bin/guardar-chave.sh IG_APP_SECRET --testar nenhum --levar-vps
```

Os dois ficam em Meta for Developers -> app -> Instagram -> "Configuração da API com login do Instagram"
(ID e chave secreta do app do Instagram).

## Instalar (na VPS, a partir de um checkout do repo)

```bash
sudo install -o root -g root -m 0700 infra/instagram/headturbo-ig-parear /usr/local/sbin/
```

## Rodar seco (não grava nada)

```bash
sudo headturbo-ig-parear
```

Confere cofre (tamanho e formato), `WA_PROXY_SECRET` e manda um POST **sem assinatura** com corpo `{}`: a função para
antes do banco. Leitura:

- `HTTP 401 sem assinatura` = publicada, origem aceita, pareamento aberto -> pode executar (rc 0)
- `HTTP 410` = já pareado (rearmar abaixo) · `403` = origem recusada (não é o IPv4 da VPS) · `404` = não publicada

## Executar (grava uma vez)

```bash
sudo headturbo-ig-parear --executar
```

Saída esperada: `instagram-oauth?evento=parear: HTTP 200 hash=<12 hex> (confere)`. Outros códigos: `410` já pareado,
`401` relógio da VPS fora da janela ou `WA_PROXY_SECRET` diferente do CRM, `400` formato recusado, `403` origem.

## Rearmar (trocou o app secret na Meta)

O dono roda no SQL do Supabase:

```sql
SELECT public.instagram_pareamento_reabrir();
```

Depois atualiza o cofre (`guardar-chave.sh IG_APP_SECRET ... --levar-vps`) e roda `sudo headturbo-ig-parear --executar`
de novo. Os tokens das contas já conectadas não mudam (eles são cifrados com o `instagram_token_segredo`, não com o
app secret).
