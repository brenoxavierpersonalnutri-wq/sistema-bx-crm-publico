# Checklist: aplicar as permissões do CRM em produção

Vale para as migrations `20261123100000` a `20261123140000`. O rollback de emergência fica em `supabase/rollback/20261123_permissoes_ROLLBACK.sql` e o teste dele em `bash supabase/tests/permissoes/rollback.sh`.

Tudo aqui roda no SQL editor do Lovable Cloud, que entra como `postgres`. As consultas de checagem só leem. As que simulam um usuário rodam dentro de `BEGIN ... ROLLBACK` e não deixam rastro.

## 0. Antes de começar

1. Escolha um horário com pouco uso e deixe o rollback aberto numa aba do SQL editor, pronto para rodar.
2. Escolha **um usuário comum aprovado que não seja admin** (alguém da equipe que usa Conversas todo dia). Pegue o id dele:

   ```sql
   SELECT p.id, p.full_name, public.has_role(p.id, 'admin') AS admin
     FROM public.profiles p WHERE p.approved ORDER BY p.full_name;
   ```

   Nas consultas abaixo, `<UID_COMUM>` é esse id.
3. Anote a **linha de base**, ainda sem nenhuma migration aplicada:

   ```sql
   -- contagens gerais (como postgres, sem RLS)
   SELECT (SELECT count(*) FROM whatsapp_contacts) AS contatos,
          (SELECT count(*) FROM whatsapp_messages) AS mensagens,
          (SELECT count(*) FROM profiles WHERE approved) AS aprovados,
          (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policies_public;

   -- o que o usuário comum enxerga HOJE
   BEGIN;
   SELECT set_config('request.jwt.claims', json_build_object('sub', '<UID_COMUM>', 'role', 'authenticated')::text, true);
   SET LOCAL ROLE authenticated;
   SELECT (SELECT count(*) FROM whatsapp_contacts) AS contatos_visiveis,
          (SELECT count(*) FROM crm_numeros) AS numeros_visiveis,
          (SELECT count(*) FROM storage.objects WHERE bucket_id = 'whatsapp-media') AS midias_visiveis;
   ROLLBACK;
   ```

## 1. Ordem de aplicação

Aplique uma por vez, na ordem, e só passe para a próxima depois de conferir a anterior.

| # | Migration | O que muda para quem usa |
|---|---|---|
| 1 | `20261123100000_crm_permissoes_estrutura.sql` | Nada visível. Cria as tabelas e funções, e dá acesso total a todo aprovado que já existe. |
| 2 | `20261123110000_crm_permissoes_rls.sql` | **A de maior risco.** Liga as policies restritivas em cerca de 60 tabelas. |
| 3 | `20261123120000_crm_departamentos_etapas_kanban.sql` | As etapas viram departamentos (só dado novo). |
| 4 | `20261123130000_crm_permissoes_correcoes.sql` | Trava a auto-aprovação, fecha o storage `whatsapp-media` e põe a trava de ações no UPDATE direto. |
| 5 | `20261123140000_seguranca_furos_restantes.sql` | Telas públicas `/feedback` e `/troca`, tira o token da Meta de `profiles` e trava `is_closer`/nome. |

Cada uma tem `BEGIN/COMMIT`: se der erro no meio, nada fica pela metade. Se uma migration der erro, **não rode a próxima**. Copie a mensagem de erro e pare.

## 2. Checagens depois de cada migration

### Depois da 1 (100000, estrutura)

```sql
-- todo aprovado ganhou linha de acesso (esperado: 0)
SELECT count(*) AS aprovados_sem_acesso FROM profiles p
 WHERE p.approved AND NOT EXISTS (SELECT 1 FROM crm_acessos a WHERE a.user_id = p.id);

-- o Breno continua admin (esperado: true)
SELECT u.email, public.has_role(u.id, 'admin') AS admin, public.crm_eh_admin(u.id) AS crm_admin
  FROM auth.users u WHERE u.email = 'exemplo@dominio.com';

-- o usuário comum tem acesso total (esperado: todos_numeros = true e as áreas em "editar")
SELECT todos_numeros, areas, so_minhas, so_departamentos FROM crm_acessos WHERE user_id = '<UID_COMUM>';
```

### Depois da 2 (110000, RLS): a que mais importa

```sql
-- policies restritivas criadas (esperado: ~4 por tabela, umas 230 no total)
SELECT count(*) AS restritivas, count(DISTINCT tablename) AS tabelas
  FROM pg_policies WHERE policyname LIKE 'crm_acesso:%';

-- "Service can ..." agora só service_role (esperado: 4 linhas com {service_role})
SELECT tablename, policyname, roles FROM pg_policies WHERE policyname ILIKE 'Service can %whatsapp%';

-- O TESTE QUE DECIDE: o usuário comum vê o MESMO que na linha de base
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '<UID_COMUM>', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT (SELECT count(*) FROM whatsapp_contacts) AS contatos_visiveis,   -- = linha de base
       (SELECT count(*) FROM crm_numeros) AS numeros_visiveis,          -- = linha de base
       public.crm_meu_acesso() AS meu_acesso;                           -- admin false, áreas "editar"
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM whatsapp_contacts ORDER BY updated_at DESC LIMIT 50;  -- tempo da lista
ROLLBACK;

-- o mesmo como admin (o Breno vê tudo)
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'exemplo@dominio.com'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT (SELECT count(*) FROM whatsapp_contacts) AS contatos_visiveis_admin;  -- = total de contatos
ROLLBACK;
```

Depois disso, abra o CRM no navegador com um usuário comum, de verdade. Abra a lista de Conversas, uma conversa e o Kanban, e mande uma mensagem de teste para um número seu.

### Depois da 3 (120000, departamentos)

```sql
SELECT nome, etapa_origem, regra, fixo FROM crm_departamentos ORDER BY ordem;   -- uma por etapa + "Em atendimento com IA"
SELECT count(*) FILTER (WHERE departamento_id IS NOT NULL) AS com_dep, count(*) AS total
  FROM whatsapp_contacts WHERE NOT is_group;
```

### Depois da 4 (130000, correções)

```sql
-- storage novo (esperado: 3 "whatsapp-media: ..." e nenhuma "Authenticated can ... whatsapp media")
SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND policyname ILIKE '%whatsapp%media%';
SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_profiles_guarda_aprovacao', 'trg_crm_contato_zz_acoes_guarda');  -- 2

-- usuário comum ainda vê a mídia (esperado: = linha de base de midias_visiveis)
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '<UID_COMUM>', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT count(*) AS midias_visiveis FROM storage.objects WHERE bucket_id = 'whatsapp-media';
ROLLBACK;
```

No navegador, abra uma conversa com foto ou áudio e confira se a mídia carrega. Mude a etapa de um card no Kanban.

### Depois da 5 (140000, furos restantes)

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'meta_access_token';  -- 0 linhas
SELECT count(*) FROM profiles_meta_credenciais;                                -- = quantos tinham token
SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_feedback_resolver_aluna', 'trg_profiles_guarda_campos');  -- 2
SELECT * FROM identificar_aluna_por_whatsapp('<telefone de uma aluna>');       -- id NULL, primeiro nome, produto
```

No navegador, abra `/feedback` com o telefone de uma aluna e confira a saudação. Abra `/troca` e veja se carrega. Na tela de Disponibilidade, os closers continuam aparecendo.

## 3. Quando acionar o rollback

**Acione na hora**, sem esperar diagnóstico, se acontecer qualquer um destes:

- O usuário comum aprovado vê **menos conversas** que na linha de base, ou a lista de Conversas ou o Kanban fica vazio ou dá erro para a equipe.
- A equipe recebe "new row violates row-level security", "sem permissão" ou erro 42501 ao responder, mudar etapa, assumir da IA ou subir mídia.
- A lista de Conversas fica lenta a ponto de dar timeout (erro 57014, `canceling statement due to statement timeout`), ou o `EXPLAIN` da seção 2 passa de alguns segundos.
- Mídia (foto ou áudio) parou de abrir depois da 130000.

**Não precisa de rollback** quando só o webhook ou o robô está com problema: eles rodam como `service_role`, que ignora RLS. Procure a causa em outro lugar, como o log da edge.

### Como acionar

1. Rode `20261123_permissoes_ROLLBACK.sql` inteiro. Só a seção 1 executa, porque as outras estão comentadas. Ele pode ser rodado de novo sem problema.
2. Refaça o "TESTE QUE DECIDE" da seção 2 deste checklist. O usuário comum tem que voltar à linha de base.
3. Se o usuário continua sem menu ou botão na tela, ou se uma edge function recusa com "sem permissão", descomente e rode a **seção 3**. Ela faz a tela e as edges darem acesso total a quem é aprovado.
4. Use a **seção 2** só se a causa for a trava de aprovação ou a falta de `profiles.meta_access_token`. Ela reabre os dois furos.
5. Use a **seção 4** só se `/feedback` ou `/troca` quebrarem. Ela reabre o furo do telefone da aluna.

### O que o rollback NÃO desfaz

- Nenhum dado é apagado: `crm_acessos`, `crm_departamentos`, `atendente_id`, `departamento_id` e `profiles_meta_credenciais` ficam.
- A trava de auto-aprovação e o token da Meta fora de `profiles` continuam. Só saem com a seção 2.
- A reescrita InitPlan das policies antigas também fica. É a mesma regra, só mais rápida.

### Para religar depois de achar a causa

Rode de novo `20261123110000`, `20261123130000` e `20261123140000`. Se a seção 3 foi usada, rode antes a `20261123100000`. Todas são idempotentes. O `rollback.sh` testa esse caminho: depois de religar, as policies e os gatilhos voltam, e um novo rollback volta ao mesmo ponto.
