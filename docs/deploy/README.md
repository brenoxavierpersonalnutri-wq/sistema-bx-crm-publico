# Publicar as Edge Functions

As migrations rodam no SQL Editor. As Edge Functions, não — são código Deno, e
o SQL Editor só executa SQL.

**Nada disso é necessário para o painel web e o app em `/aluna` funcionarem.**
Só para o app nativo (`mobile-v1`) e as notificações push (`mobile-push`).

---

## Antes de tudo: este projeto roda no Lovable Cloud

O backend deste projeto é o **Lovable Cloud** — o Supabase gerenciado dentro do
Lovable. Tudo fica no menu **Cloud** da barra lateral do Lovable, e não em
supabase.com:

| Menu no Lovable | Para quê |
|---|---|
| SQL editor | as duas migrations |
| Edge functions | `mobile-v1` e `mobile-push` |
| Secrets | `CRON_SECRET` |
| Jobs | agendar o worker de push |
| Storage | conferir os buckets `dietas` e `feedback-fotos` |
| Logs | ver erro de function |

### Não se cola código: publica-se pelo repositório

**Cloud → Edge functions** no Lovable é uma tela de monitoramento — lista nome,
status, invocações e taxa de sucesso, e não tem botão de criar nem editor.

O Lovable publica as Edge Functions **a partir do repositório**: o que estiver
em `supabase/functions/<nome>/index.ts` vira uma function no build. Confirmado
comparando as duas pontas: as 19 functions listadas na tela são exatamente as 19
pastas em `supabase/functions/` na branch `main`, mesmos nomes.

Ou seja, para publicar `mobile-v1` e `mobile-push` basta **mesclar a branch**.
Elas aparecem na lista depois do build seguinte.

Enquanto a branch não for mesclada, o Lovable não enxerga nada disso — nem as
telas novas do painel, nem as functions.

> O `docs/deploy/mobile-v1-arquivo-unico.ts` continua no repositório para o caso
> de precisar colar num painel do Supabase direto (fora do Lovable). Neste
> projeto, não é o caminho.

---

## Caminho A — colando pelo painel (só fora do Lovable)

Para projetos ligados direto ao supabase.com, onde a tela de Edge Functions tem
editor. **Não é o caso deste projeto** — veja acima.

### 1. `mobile-v1` — a API do app nativo

1. Abra **Edge functions** → criar/deploy de uma nova function.
2. Nome da função: **`mobile-v1`** — exatamente assim, é o que vira a URL.
3. Apague o código de exemplo e cole o conteúdo inteiro de
   [`mobile-v1-arquivo-unico.ts`](./mobile-v1-arquivo-unico.ts).

   > Esse arquivo é gerado: junta `index.ts` e `lib.ts` da função num arquivo
   > só, porque o editor do painel trabalha melhor assim. Ele tem exatamente o
   > mesmo comportamento da versão modular, e um teste garante que os dois não
   > saem de sincronia.

4. **Desmarque "Verify JWT"** nas opções da função. A `mobile-v1` valida o token
   por dentro para conseguir responder `401` com uma mensagem em português —
   com o Verify JWT ligado, o gateway barra antes e a aluna vê um erro cru.
5. **Deploy**.

### 2. `mobile-push` — o worker de notificações

Mesma coisa: **Deploy a new function**, nome **`mobile-push`**, cole o conteúdo
de [`supabase/functions/mobile-push/index.ts`](../../supabase/functions/mobile-push/index.ts)
(esse é um arquivo só, não precisa de versão gerada). Desmarque **Verify JWT**
— ele é chamado por cron e se autentica por um segredo no cabeçalho.

### 3. O segredo do cron

No Lovable: **Cloud → Secrets**. No Supabase: **Project Settings → Edge
Functions → Secrets**. Adicione:

| Nome | Valor |
|---|---|
| `CRON_SECRET` | uma senha longa e aleatória que você inventa |

Serve para ninguém disparar o envio de push chamando a URL pública. Guarde o
valor, você vai usá-lo no passo 5.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` **não**
precisam ser cadastrados — o Supabase injeta sozinho em toda função.

### 4. Agendar o envio de push

**Se o Lovable tiver a tela Cloud → Jobs**, agende por ali: uma chamada HTTP
para `/functions/v1/mobile-push` a cada 15 minutos, com o cabeçalho
`x-cron-secret`. É mais simples e dispensa o passo das extensões.

**Se não tiver**, vá pelo `pg_cron`. Primeiro habilite as extensões em
**Database → Extensions**:

- `pg_cron` — agenda a tarefa
- `pg_net` — permite ao banco chamar a função por HTTP

Depois, no **SQL Editor**, trocando os dois valores marcados:

```sql
select cron.schedule(
  'mobile-push',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://SEU_PROJETO.supabase.co/functions/v1/mobile-push',
    headers := '{"x-cron-secret": "O_MESMO_CRON_SECRET"}'::jsonb
  )
  $$
);
```

`SEU_PROJETO` é o subdomínio que aparece na barra de endereço do painel.

Sem esse agendamento, as notificações se acumulam na tabela `notificacoes` e
nunca são entregues — nada quebra, só não chega push.

Para conferir o que está agendado:

```sql
select jobname, schedule, active from cron.job;
```

### 5. Conferir o storage

Em **Cloud → Storage**, os buckets `dietas` e `feedback-fotos` devem existir
(as migrations criam). Se a primeira migration avisou que não conseguiu criar as
policies de storage, é aqui que elas entram.

---

## Caminho B — pelo CLI (se você tiver terminal)

```bash
npm install -g supabase
supabase login
supabase link --project-ref SEU_PROJETO

supabase functions deploy mobile-v1
supabase functions deploy mobile-push
supabase secrets set CRON_SECRET="$(openssl rand -hex 32)"
```

Pelo CLI a função vai modular (`index.ts` + `lib.ts`), sem precisar do arquivo
gerado. Os passos 4 e 5 acima continuam valendo.

---

## Conferir se funcionou

### A função está no ar?

```bash
curl -i https://SEU_PROJETO.supabase.co/functions/v1/mobile-v1/bootstrap
```

Esperado: **`401`** com `{"erro":{"codigo":"sem_token",...}}`.
Isso já é sucesso — significa que a função subiu e está rejeitando quem não
mandou token. Se vier `404`, o nome da função está diferente de `mobile-v1`.

### A API responde para uma aluna de verdade?

Precisa de uma aluna com acesso liberado no painel (aba Acesso) e senha criada.

```bash
PROJETO="https://SEU_PROJETO.supabase.co"
ANON="sua_publishable_key"

TOKEN=$(curl -s -X POST "$PROJETO/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"aluna@exemplo.com","password":"a_senha"}' | jq -r .access_token)

curl -s "$PROJETO/functions/v1/mobile-v1/bootstrap" \
  -H "Authorization: Bearer $TOKEN" -H "apikey: $ANON" \
  -H "x-app-versao: 1.0.0" -H "x-app-plataforma: ios" | jq
```

Deve voltar o perfil, a fase de treino e a dieta dela.

### O push está saindo?

```sql
-- quantas esperam envio
select count(*) from notificacoes where enviada_em is null;

-- as últimas, com o motivo de falha se houver
select tipo, titulo, agendada_para, enviada_em, tentativas, erro
from notificacoes order by created_at desc limit 10;
```

Notificação com `agendada_para` no futuro é normal: o push da fase que abre
daqui a 30 dias fica parado até lá, de propósito.

`enviada_em` preenchido com `erro = 'sem dispositivo registrado'` também é
esperado enquanto nenhuma aluna tiver instalado o app.

Para forçar um envio sem esperar o cron:

```bash
curl -i -X POST https://SEU_PROJETO.supabase.co/functions/v1/mobile-push \
  -H "x-cron-secret: O_MESMO_CRON_SECRET"
```

Resposta esperada: `{"enviadas":0,"sem_dispositivo":N,"falhas":0}`.
Se vier `401`, o `CRON_SECRET` do cabeçalho não bate com o cadastrado.

### Ver o log de erro

**Edge Functions** → clique na função → aba **Logs**. É onde aparece qualquer
exceção do lado do servidor.

---

## Se mexer no código depois

A fonte de verdade é `supabase/functions/mobile-v1/`. Depois de editar, regere
o arquivo do painel:

```bash
node scripts/gerar-bundle-edge.mjs
```

`npm test` falha se você esquecer — tem um teste comparando os dois.
