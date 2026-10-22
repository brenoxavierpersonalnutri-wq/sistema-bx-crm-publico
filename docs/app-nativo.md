# App nativo — guia de integração

Como ligar um app React Native (ou Swift/Kotlin) ao backend da consultoria e
levá-lo à App Store e à Play Store.

- Contrato completo: [`docs/mobile-api.yaml`](./mobile-api.yaml) (OpenAPI 3.1)
- Cliente pronto: [`mobile-client/src/`](../mobile-client/src) — copie a pasta
- Painel do time: [`docs/app-alunas.md`](./app-alunas.md)

---

## Arquitetura

```
App nativo
   │  login  ──────────────►  Supabase Auth  (e-mail + senha)
   │                               │ access_token (JWT)
   │  dados  ──────────────►  Edge Function mobile-v1
   │                               │ usa o JWT da aluna
   │                               ▼
   │                          Postgres + RLS   ◄── quem decide o que ela vê
   │
   └─ push   ◄──────────────  Edge Function mobile-push (cron)
```

Duas escolhas que valem entender:

**Uma tela = uma requisição.** `/bootstrap` devolve perfil, config, fase de
treino inteira, dieta e feedback de uma vez. Em 4G, encadear quatro chamadas
vira dois segundos de tela branca.

**A RLS continua sendo a segurança.** A Edge Function usa o token *da aluna*,
nunca a `service_role`. Se um endpoint tiver a query errada, o banco ainda
segura. Você pode até falar direto com o Supabase pelo SDK e a proteção é a
mesma — a API só existe para agrupar chamadas e pré-formatar.

---

## Subir o backend

As migrations podem ir pelo SQL Editor (do Lovable ou do Supabase) — veja
[`docs/app-alunas.md`](./app-alunas.md#como-subir) para a ordem e o aviso
esperado sobre policies de storage. As Edge Functions e os secrets, não: só
CLI ou painel.

Sem terminal, dá para publicar tudo pelo painel do Supabase — passo a passo em
[`docs/deploy/README.md`](./deploy/README.md). Com CLI:

```bash
supabase db push          # as duas migrations
supabase functions deploy mobile-v1
supabase functions deploy mobile-push
supabase secrets set CRON_SECRET="$(openssl rand -hex 32)"
```

Depois, agende o worker de push (a cada 15 min dá conta):

```sql
select cron.schedule(
  'mobile-push', '*/15 * * * *',
  $$select net.http_post(
      url     := 'https://<projeto>.supabase.co/functions/v1/mobile-push',
      headers := '{"x-cron-secret":"<o mesmo CRON_SECRET>"}'::jsonb
  )$$
);
```

Sem esse agendamento a fila em `public.notificacoes` só enche e nada é entregue.

---

## Autenticação

O login é do SDK do Supabase, que funciona em React Native trocando o storage:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { criarSupabase, entrar, tokenAtual, ClienteApi } from "./mobile-client/src";

const sb = criarSupabase({
  supabaseUrl: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
  storage: AsyncStorage,
});

const api = new ClienteApi({
  supabaseUrl: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
  obterToken: tokenAtual(sb),   // renova sozinho quando está perto de expirar
  appVersao: "1.0.0",
  plataforma: Platform.OS === "ios" ? "ios" : "android",
});

await entrar(sb, email, senha);
const dados = await api.bootstrap();
```

A `anonKey` é pública por natureza — pode ir no bundle. Quem protege é a RLS.

**O vínculo é automático.** O time cadastra o e-mail da aluna no painel
(aba Acesso). No primeiro acesso a API casa o e-mail do JWT com esse cadastro.
Se não houver cadastro, a resposta é `403 sem_acesso` — mostre a tela
"fale com a equipe", não a de login.

---

## Tratamento de erro

Todo erro vem como `{ "erro": { "codigo": "...", "mensagem": "..." } }`, com a
mensagem em pt-BR pronta para exibir. O que exige tratamento próprio:

| código | o que fazer |
|---|---|
| `sem_token`, `token_invalido` | mandar para o login |
| `sem_acesso` | tela "acesso ainda não liberado" |
| `manutencao` | tela de manutenção com o texto do `/bootstrap` |
| `valor_invalido` | mostrar a mensagem no campo |
| `timeout`, `sem_rede` | oferecer "tentar de novo" |

O cliente já expõe isso:

```ts
try {
  await api.bootstrap();
} catch (e) {
  if (e instanceof ErroApi && e.precisaRelogar) navegar("Login");
  else if (e instanceof ErroApi && e.semAcesso) navegar("SemAcesso");
  else mostrarToast(e.message);
}
```

---

## Atualização obrigatória

Todo request manda `x-app-versao` e `x-app-plataforma`. Quando a versão
instalada é menor que a mínima configurada, `/bootstrap` volta com:

```json
{ "config": { "atualizacao_obrigatoria": true, "url_loja": "https://apps.apple.com/..." } }
```

Bloqueie a navegação e mostre o botão para a loja. Isso permite mudar a API sem
quebrar quem está com build antigo.

Para configurar, no SQL Editor:

```sql
update app_config set
  versao_minima_ios = '1.2.0',
  versao_minima_android = '1.2.0',
  url_loja_ios = 'https://apps.apple.com/app/id...',
  url_loja_android = 'https://play.google.com/store/apps/details?id=...'
where id = 1;
```

`manutencao = true` derruba todos os endpoints com `503` — menos o `/bootstrap`,
que é como o app descobre que está em manutenção.

---

## Push notifications

O backend enfileira sozinho em três situações: **fase nova liberada** (agendada
para as 12h do dia da liberação), **feedback respondido** e **dieta nova**.

No app, depois do login:

```ts
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { registrarPush, rotaDaNotificacao } from "./mobile-client/src";

await registrarPush({
  notificacoes: Notifications,
  cliente: api,
  plataforma: Platform.OS as "ios" | "android",
  projectId: Constants.expoConfig?.extra?.eas?.projectId,
  ehDispositivoFisico: Device.isDevice,
});

// deep link ao tocar na notificação
Notifications.addNotificationResponseReceivedListener((r) => {
  const rota = rotaDaNotificacao(r.notification.request.content.data);
  if (rota) navegar(rota);   // "treino" | "dieta" | "feedback"
});
```

`registrarPush` nunca lança: push é um extra e não pode travar a abertura do app.

**No logout, chame `api.removerDispositivo(token)`** — senão o aparelho continua
recebendo notificação da conta anterior.

O worker desativa sozinho os tokens que voltam `DeviceNotRegistered` (app
desinstalado) e desiste depois de 3 tentativas.

---

## Exigências das lojas

### Exclusão de conta — bloqueia a publicação na Apple

App Store Review **5.1.1(v)**: app que deixa criar conta *precisa* deixar
excluir dentro do app. Sem isso a revisão é recusada.

```ts
await api.excluirMinhaConta(motivo);
await sb.auth.signOut();   // o token deixa de valer na hora
```

Coloque em Ajustes, com confirmação em duas etapas. O que a chamada faz:

| sai | fica |
|---|---|
| login, dispositivos, notificações | cadastro comercial (contrato, pagamento, vencimento) |
| treinos registrados, feedbacks | registro do pedido em `exclusoes_conta` |
| arquivos no storage | |

O cadastro comercial fica retido como registro de negócio, com base legal
própria, e deixa de apontar para qualquer conta logada. Se o Breno preferir
apagar também essa linha, é editar `excluir_minha_conta()` na migration.

### Privacidade

- **Apple Privacy Nutrition Label / Play Data Safety** — o app coleta: e-mail
  (login), nome, peso e medidas, fotos de acompanhamento e token de push.
  Nada vai para terceiros; nada é usado para rastreamento entre apps.
- **Sem IDFA** — não há SDK de anúncio, então não precisa do App Tracking
  Transparency.
- **URL de política de privacidade** — obrigatória nas duas lojas.
- **LGPD art. 18** — `api.exportarMeusDados()` entrega o JSON com tudo que é
  dela. Exponha em Ajustes.

### Conteúdo

- Os vídeos são embeds do YouTube. Use `react-native-youtube-iframe` ou uma
  `WebView` com o `embed_url` que a API já devolve — não baixe o vídeo, isso
  viola os termos do YouTube.
- O app dá orientação de treino e alimentação prescrita por profissional
  habilitado. Não é app médico e não deve prometer diagnóstico ou cura, senão
  cai na categoria de saúde regulada.
- Faixa etária sugerida: 12+ nas duas lojas.

### Antes de enviar

- [ ] `versao_minima_ios` / `versao_minima_android` e URLs de loja preenchidas
- [ ] Exclusão de conta acessível em Ajustes
- [ ] Exportar dados acessível em Ajustes
- [ ] Política de privacidade publicada e apontada nas duas lojas
- [ ] Conta de teste para a revisão (peça ao Breno um acesso de demonstração
      com uma fase e uma dieta prontas — sem isso a Apple recusa por não
      conseguir ver o conteúdo)
- [ ] Push testado em aparelho físico (simulador não recebe)
- [ ] Comportamento offline: a última resposta do `/bootstrap` guardada em
      cache, com aviso de "sem conexão"
- [ ] Cron do `mobile-push` agendado em produção

---

## Referência rápida

| método | rota | para quê |
|---|---|---|
| GET | `/bootstrap` | abertura do app — tudo de uma vez |
| GET | `/treino` | fase liberada no momento |
| GET | `/dieta` | plano alimentar vigente |
| GET | `/feedback` | ciclo + histórico |
| GET | `/evolucao` | treinos no período e série de peso |
| GET | `/notificacoes` | notificações entregues |
| GET | `/exportar` | LGPD |
| POST | `/treino/concluir` | marcar treino feito |
| POST | `/treino/desfazer` | desmarcar |
| POST | `/feedback` | enviar feedback |
| POST | `/dispositivo` | registrar push |
| POST | `/notificacoes/lida` | marcar como lida |
| DELETE | `/dispositivo` | remover push (logout) |
| DELETE | `/conta` | excluir conta |

Teste rápido com curl:

```bash
TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"aluna@exemplo.com","password":"senha"}' | jq -r .access_token)

curl -s "$SUPABASE_URL/functions/v1/mobile-v1/bootstrap" \
  -H "Authorization: Bearer $TOKEN" \
  -H "apikey: $ANON_KEY" \
  -H "x-app-versao: 1.0.0" -H "x-app-plataforma: ios" | jq
```

---

## Mantendo o contrato honesto

`src/test/contratoApi.test.ts` compara, a cada `npm test`, os endpoints do
OpenAPI, os da Edge Function e os métodos do cliente TypeScript. Mexer num sem
mexer nos outros quebra o teste antes de quebrar o app em produção.
