# Proxy da VPS: Fluxo de Grupo (campanha que cria grupos sozinha), 19/10/2026

Não foi aplicado. Quem aplica é o Breno, ou o Paulo com o OK dele.

## O que muda no `headturbo-wa-proxy`

O código está em `lib.mjs` e `server.mjs`. Os testes estão em `src/test/grupoFluxo.test.ts`.

| Rota | O que faz | Endpoint do OpenWA v0.24.0 |
|---|---|---|
| `group-create` | `{ name, participants: [telefone] (1 a 10), sessao? }` → `{ chatId, name }` | `POST /sessions/:id/groups` |
| `group-settings` | `{ chatId, announce?, locked? }`: só admins enviam / só admins editam | `PUT .../groups/:g/settings` |
| `group-description` | `{ chatId, description }` (vazio limpa) | `PUT .../groups/:g/description` |
| `group-picture` | `{ chatId, url (https) }` | `PUT .../groups/:g/picture` |
| `group-promote` | `{ chatId, participants: [telefone] (1 a 10) }` | `POST .../groups/:g/participants/promote` |
| `send-group-poll` | `{ chatId, name, options (2 a 12), multiple? }` | `POST .../messages/send-poll` |
| `send-group-text` / `-media` | novos campos: `mentionAll`, `mentions` e `ptt` (este só em áudio) | `send-text` / `send-*` com `mentions` |

Travas:
- Todas as escritas, menos `group-create`, só valem para grupo da allowlist. A allowlist é a lista que o CRM grava com os grupos das campanhas. Grupo fora dela recebe 403.
- Limites próprios por sessão:
  - criação: 1 a cada 2 min e 10 por dia (`/data/limites-criacao-grupo.json`);
  - demais escritas de admin: 20/min e 300/dia (`/data/limites-escrita-grupo.json`).
- O disparo continua em 6/min, 200/dia e 8 s entre envios.
- `mentionAll`: o proxy lê os participantes do grupo no OpenWA e manda os ids em `mentions`, sem pôr @ no texto. A lista de participantes nunca sai do proxy.
- `send-bulk`, logout, sair do grupo e remover participante continuam sem existir.

## Aplicar

Do Mac, na pasta do repo:

```bash
scp infra/wa-proxy/lib.mjs infra/wa-proxy/server.mjs infra/wa-proxy/headturbo-openwa-webhook-crm head-turbo-vps:/tmp/
```

Na VPS (`ssh head-turbo-vps`):

```bash
B=/opt/headturbo-wa-proxy/backup-$(date +%Y%m%d-%H%M%S)-fluxo-grupo
sudo mkdir -p "$B" && sudo cp -a /opt/headturbo-wa-proxy/lib.mjs /opt/headturbo-wa-proxy/server.mjs "$B"/
sudo cp -a "$(command -v headturbo-openwa-webhook-crm)" "$B"/
sudo install -m 0644 /tmp/lib.mjs /tmp/server.mjs /opt/headturbo-wa-proxy/
sudo install -m 0755 /tmp/headturbo-openwa-webhook-crm "$(command -v headturbo-openwa-webhook-crm)"
cd /opt/headturbo-wa-proxy
sudo docker compose build wa-proxy
sudo docker compose up -d --force-recreate --no-deps wa-proxy
```

Entradas, saídas e boas-vindas dependem dos eventos de grupo no webhook de cada sessão que administra
grupos. Rode primeiro no modo seco e depois com `--executar`:

```bash
sudo headturbo-openwa-webhook-crm --sessao <NOME> --com-eventos-grupo
sudo headturbo-openwa-webhook-crm --sessao <NOME> --com-eventos-grupo --executar
```

## Conferir

```bash
sudo docker logs --tail 3 headturbo-wa-proxy        # linha "inicio"
for r in group-create group-settings send-group-poll; do
  curl -s -o /dev/null -w "$r %{http_code}\n" -X POST http://127.0.0.1:2786/v1/$r   # 401 = rota existe
done
```

Depois, faça o teste com um grupo descartável, nunca com grupo de aluna:
1. Crie uma campanha de teste, com o link pausado.
2. Na aba "Fluxo automático", ponha 1 admin (outro número seu) e um prefixo "TESTE".
3. Clique em "Criar o próximo grupo agora".
4. Confira no celular o nome, a descrição, a foto, se o grupo está fechado e se o admin foi promovido.
5. Agende uma mensagem "mencionar todos" e veja se a notificação chega no outro número.

## Voltar atrás

```bash
B=$(ls -d /opt/headturbo-wa-proxy/backup-*-fluxo-grupo | tail -1)
sudo install -m 0644 "$B/lib.mjs" "$B/server.mjs" /opt/headturbo-wa-proxy/
sudo install -m 0755 "$B/headturbo-openwa-webhook-crm" "$(command -v headturbo-openwa-webhook-crm)"
cd /opt/headturbo-wa-proxy && sudo docker compose build wa-proxy && sudo docker compose up -d --force-recreate --no-deps wa-proxy
```

Se o proxy antigo continuar no ar:
- a criação automática fica em erro (`proxy 404` em `grupos_criacoes`) e para depois de 3 tentativas;
- enquete e fechar/abrir saem como "falhou: proxy 404";
- texto e mídia comuns continuam funcionando, mas "mencionar todos" e nota de voz são recusados com 400 pelo proxy antigo, porque são campos que ele não conhece.
