-- Multi-sessão do WhatsApp (Conexões /crm/conexoes) — 17/10/2026. Sem segredo.
-- 1) liga a ponte multi-sessão para as funções (lida por _shared/multisessaoWa.ts; secret WA_PROXY_MULTISESSAO, se existir, tem prioridade)
INSERT INTO public.integracao_config (chave, valor) VALUES ('wa_proxy_multisessao', '1')
ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
-- 2) sessões dos 4 números (idempotente; o seed já põe isso) (o telefone o whatsapp-qr grava sozinho quando o número conecta)
UPDATE public.crm_numeros SET sessao_openwa = chave
 WHERE chave IN ('closer','comercial-fit-2','suporte-consultoria-1','comercial-implementacao-1')
   AND tipo = 'openwa' AND sessao_openwa IS DISTINCT FROM chave;
-- conferência
SELECT chave, tipo, sessao_openwa, telefone, ativo FROM public.crm_numeros ORDER BY ordem;
SELECT chave, valor FROM public.integracao_config WHERE chave = 'wa_proxy_multisessao';
