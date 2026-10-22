-- Fluxos: a coluna gatilho_tipo recebe o tipo do 1º gatilho do construtor. Os gatilhos novos
-- "webhook" (Webhook/API) e "banco" (Novo lead no banco) não estavam na CHECK e o fluxo não salvava
-- ("violates check constraint crm_fluxos_gatilho_tipo_check", 18/10/2026). Idempotente; não toca em dado.
ALTER TABLE public.crm_fluxos DROP CONSTRAINT IF EXISTS crm_fluxos_gatilho_tipo_check;
ALTER TABLE public.crm_fluxos ADD CONSTRAINT crm_fluxos_gatilho_tipo_check
  CHECK (gatilho_tipo IN ('tag', 'etapa', 'evento', 'segmento', 'sem_resposta', 'data', 'webhook', 'banco'));
