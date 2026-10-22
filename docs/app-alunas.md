# App das Alunas

Camada de entrega da consultoria: a aluna abre o app e encontra o treino da fase
atual (com vídeo), a dieta e o formulário de feedback. O time monta tudo pelo
painel em `/alunas/app`.

## Como subir

### Pelo SQL Editor (Lovable ou painel do Supabase)

Cole e rode **nesta ordem**, uma migration por vez:

1. `supabase/migrations/20260824120000_app_aluna_treino.sql`
2. `supabase/migrations/20260825001000_app_aluna_mobile.sql`

A segunda depende da primeira — invertendo, ela falha em `alunas` e
`aluna_acessos`. Nenhuma das duas precisa de extensão ou superusuário, e as
duas são idempotentes: rodar de novo não duplica nada.

**Um aviso pode aparecer no fim da primeira**, e é esperado:

> WARNING: Sem permissão para criar as policies de storage.

`storage.objects` pertence a `supabase_storage_admin`, não ao papel do SQL
Editor. O bloco tenta assumir esse papel — o que costuma funcionar — e, quando
não dá, avisa e segue em vez de derrubar a migration inteira. Se o aviso
aparecer, crie as 5 policies em **Storage → Policies** (buckets `dietas` e
`feedback-fotos`), ou rode só aquele trecho pelo CLI. Sem elas, o PDF da dieta
e as fotos de feedback não abrem; o resto do app funciona.

Para conferir se passou:

```sql
select count(*) from pg_policies where schemaname = 'storage'
  and policyname like 'dietas%' or policyname like 'feedback_fotos%';  -- espera 5
select count(*) from storage.buckets where id in ('dietas','feedback-fotos'); -- espera 2
```

### O que o SQL Editor NÃO faz

- **Edge Functions** (`mobile-v1`, `mobile-push`) — são código Deno. Vão pela
  tela Edge Functions do painel do Supabase ou pelo CLI. Passo a passo dos dois
  caminhos em [`docs/deploy/README.md`](./deploy/README.md).
- **Secrets** (`CRON_SECRET`) — CLI ou Settings → Edge Functions → Secrets.
- **Cron do push** — precisa das extensões `pg_cron` e `pg_net` ligadas antes,
  em Database → Extensions. Só depois o `cron.schedule(...)` do
  [guia do app nativo](./app-nativo.md) roda.

Nada disso é necessário para o painel web e o app da aluna em `/aluna`
funcionarem — só para o app nativo e as notificações.

### Depois

- Em **Authentication → Providers**, garanta que e-mail/senha está habilitado —
  é como a aluna entra.
- Se o código veio de uma branch, faça o merge: o Lovable lê o repositório do
  GitHub e não enxerga o que está em branch não mesclada.
- Opcional: regere `src/integrations/supabase/types.ts` para o TypeScript passar
  a conhecer as tabelas novas (hoje `src/lib/appAluna/store.ts` isola isso num
  alias `LinhaDb`).

## Existem dois feedbacks no projeto

Convivem sem conflito, mas fazem coisas diferentes — vale decidir se os dois
continuam:

| | Feedback semanal (`/feedback`) | Feedback do app (`/aluna/feedback`) |
|---|---|---|
| quem responde | qualquer uma, pelo link do WhatsApp | só a aluna logada |
| onde vê | `/alunas/feedback` | dentro do app, com resposta do Breno |
| tabela | `feedback_semanal_responses` | `feedback_ciclos` + `feedback_respostas` |

O do app fecha o ciclo (ela lê a resposta ali mesmo e recebe push quando o Breno
responde). O do WhatsApp alcança quem ainda não tem acesso ao app. Se um dos
dois for aposentado, é só remover a rota — as tabelas são independentes.

## Fluxo de trabalho do time

**1. Biblioteca de exercícios** (`/alunas/app` → Exercícios)
Cadastre cada exercício uma vez com o link do YouTube. Aceita `watch?v=`,
`youtu.be`, `/shorts` e `/embed` — o ID e a thumbnail saem sozinhos.

Excluir faz *soft delete*: o exercício some da biblioteca mas continua aparecendo
para quem já está com ele numa fase liberada. Ninguém perde vídeo no meio do mês.

**2. Fases de treino** (aba Fases de treino)
Cada fase tem N treinos (Treino A, B, C…) e cada treino tem os exercícios com
séries, repetições, cadência, descanso, carga sugerida, método avançado e
observação. Exercícios com a mesma **letra de agrupamento** viram bi-set/tri-set
e aparecem juntos para a aluna.

Monte a Fase 1 e use **Duplicar** para as seguintes — copia dias e prescrição
inteiros, é só ajustar.

**3. Jogar as fases na aluna** (aba Alunas → aluna → Treino)
Marque as fases na ordem, escolha a data de início e o intervalo (30 dias = uma
fase nova por mês). A prévia mostra a data em que cada fase abre antes de você
confirmar.

A fase **não existe** para a aluna antes da data — isso é garantido no banco por
RLS, não só na interface. Dá para antecipar ou adiar qualquer fase depois pelo
campo de data na lista.

Atribuir um plano novo arquiva o anterior.

**4. Dieta** (aba Dieta)
PDF ou texto colado. O PDF fica em bucket privado e é servido por URL assinada de
1 hora. Use `vigencia_fim` para programar a troca mensal.

**5. Feedback** (aba Feedback)
Defina semanal, quinzenal ou mensal. As respostas chegam nessa aba e você responde
por ali — a aluna lê a resposta dentro do app.

**6. Acesso** (aba Acesso)
Cadastre o e-mail da aluna e mande o convite (o botão copia o texto pronto). No
primeiro login o vínculo é feito sozinho pelo e-mail. O switch "Acesso ativo"
corta o app na hora quando a consultoria encerra.

## O que a aluna vê

`/aluna` — mobile-first, tema escuro próprio, navegação inferior:

- **Treino** — fase atual, lista de treinos, e dentro de cada um: vídeo,
  séries × reps, cadência, descanso, carga, método avançado e observação.
  Marca o treino como concluído.
- **Dieta** — PDF embutido (com botão de download) ou o texto.
- **Feedback** — peso, notas de 0 a 10 (dieta, treino, energia, sono), intestino,
  dificuldades. Histórico com a resposta do Breno.
- **Evolução** — treinos nos últimos 30 dias, gráfico de peso e a trilha de fases.

## Segurança

Duas faixas de acesso, aplicadas por RLS no Postgres:

- **Time** (`profiles.approved = true`) — enxerga e edita tudo.
- **Aluna** (`auth.users` ligado em `aluna_acessos`) — só o que é dela, e só as
  fases cuja data de liberação já chegou.

Uma aluna não alcança dado de outra: as policies passam por
`aluna_do_usuario(auth.uid())`, e tentativa de gravar log ou feedback no nome de
outra pessoa é recusada pelo banco. Os caminhos no storage começam com o
`aluna_id`, que é o que a policy de `storage.objects` confere.

A aluna pode corrigir um feedback enquanto ele não foi respondido; depois disso
ele trava, e ela nunca consegue escrever no campo de resposta do time.

## Detalhes conhecidos

- As rotas `/aluna/*` ficam dentro do `AuthProvider` do time, então uma aluna
  logada dispara três consultas de perfil que não usa. É desperdício pequeno;
  reorganizar exigiria mexer na árvore inteira do `App.tsx`.
- Toasts (sonner) são montados na raiz do app, fora do escopo `dark` do app da
  aluna, então aparecem no tema claro.
- `parseYoutubeId` em `src/lib/appAluna/types.ts` espelha o trigger
  `exercicio_preenche_youtube` no banco. Mexeu num, mexa no outro — há teste em
  `src/test/appAluna.test.ts` cobrindo os formatos.
