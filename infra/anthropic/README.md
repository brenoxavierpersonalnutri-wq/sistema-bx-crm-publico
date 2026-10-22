# IA do CRM no Claude (Anthropic)

Toda chamada de IA do CRM vai para o Claude, pela Messages API da Anthropic, pagando com o crédito da conta
Anthropic do Breno. O gateway do Lovable (Gemini, `LOVABLE_API_KEY`) saiu do CRM.

| Onde | Modelo |
|---|---|
| Agente IA: simulador (`ai-agent-simular`) e o robô do WhatsApp, quando ligado | o escolhido na aba **Configuração** do agente; padrão **Claude Sonnet 5.5** (`claude-sonnet-5-5`). Opções: Haiku 5.5 (mais barato), Opus 5.5 (mais caro) |
| Resumo do feedback semanal (`feedback-semanal-resumo`) | **Claude Haiku 5.5** (`claude-haiku-5-5`) |

Valor antigo no banco (`google/gemini-*`, `openai/*`) é tratado como Sonnet 5.5 no código (`resolverModelo`), e a
migration `20261101120000_ia_claude_anthropic.sql` grava Sonnet 5.5 nesses agentes.

A geração 5.5 recusa `temperature` fora do padrão: o campo temperatura do agente continua no banco, mas não vai
para a API. O tom sai do prompt.

## Peças

| Peça | O que faz |
|---|---|
| `supabase/functions/_shared/anthropic.ts` | conversor chat -> Messages API, leitura da resposta (pula `thinking`, trata `refusal`), erros 401/403/429/529/crédito em português, modelos, validação da chave. Testado em `src/test/anthropic.test.ts` |
| `supabase/functions/_shared/iaCRM.ts` | ponto único de IA das functions: pega a chave (env `ANTHROPIC_API_KEY` ou `integracao_config.anthropic_api_key`) e chama |
| `supabase/functions/anthropic-pareamento` | a VPS entrega UMA vez a chave (IP da VPS + HMAC + nonce, igual ao `google-pareamento`) |
| `infra/anthropic/headturbo-anthropic-parear` | script root da VPS que faz o pareamento, sem imprimir a chave |
| `src/lib/crm/iaClaude.ts` | lista de modelos para as telas e a mensagem de erro da função na tela |

## Passo a passo da chave (uma vez)

1. **Breno:** entrar em https://console.anthropic.com com a conta que tem o crédito → **API Keys** → **Create Key**
   (nome sugerido: `crm-bx`) → copiar. Não colar em chat, Telegram nem painel.
2. **Paulo, no terminal do Mac** (lê a chave da área de transferência, guarda no cofre do Mac e leva pro cofre da VPS):
   ```bash
   bash ~/.claude/head-turbo/bin/guardar-chave.sh ANTHROPIC_API_KEY --da-area --levar-vps
   ```
   Depois, limpar a área de transferência (`pbcopy < /dev/null`).
3. **Paulo:** rodar a migration `20261101120000_ia_claude_anthropic.sql` no SQL do Supabase e publicar as functions
   `anthropic-pareamento`, `ai-agent-simular` e `feedback-semanal-resumo`.
4. **Paulo, na VPS** (`ssh head-turbo-vps`, a partir do repositório atualizado):
   ```bash
   sudo install -o root -g root -m 0700 infra/anthropic/headturbo-anthropic-parear /usr/local/sbin/
   sudo headturbo-anthropic-parear             # seco: cofre ok, chave válida na Anthropic (GET /v1/models), função publicada
   sudo headturbo-anthropic-parear --executar  # grava em integracao_config.anthropic_api_key; mostra só o hash
   ```
   Sucesso = `HTTP 200 hash=xxxxxxxxxxxx (confere)`.
5. **Conferir:** abrir `/crm/agente-ia`, mandar uma mensagem no simulador. Erro de chave, crédito ou limite aparece em
   português no aviso vermelho.

Trocar a chave (vazou, foi revogada): gerar outra no console, repetir o passo 2, rodar no SQL
`SELECT public.anthropic_pareamento_reabrir();` e repetir o passo 4 (`--executar`). As functions guardam a chave em
memória por até 5 min; erro 401 limpa esse cache na hora.

## Custo

Pensamento adaptativo sempre ligado nos modelos 5.5: os tokens de pensamento são cobrados como saída. O perfil de
conversa usa `effort: medium` e teto de 8192 tokens; o de resumo, `effort: low` e 4096. Ajuste em `PERFIS`
(`_shared/anthropic.ts`). Um teto de gasto mensal no console da Anthropic (Settings → Limits) protege o crédito.
