-- Agente de IA de follow-up (18/10/2026). Idempotente: pode rodar mais de uma vez.
--
-- crm_ai_agents.tipo:
--   'atendimento' (padrão, todos os agentes que já existem) = responde a lead (robô, ainda não plugado);
--   'followup' = só escreve a mensagem do passo "Mensagem da IA (follow-up)" dos fluxos (crm_fluxos).
-- O agente de follow-up nasce desligado (ativo = false) e continua assim: quem liga é o fluxo, que também nasce
-- como rascunho. Nada é enviado por esta migration.
--
-- O passo novo ({"tipo":"ia_followup", ...}) mora no jsonb crm_fluxos.passos / arvore e na ação da fila
-- (crm_automacao_fila.acoes): nenhuma das duas colunas tem CHECK por tipo, então não há mudança nelas.
-- O log usa canal 'crm' e tipo 'ia_followup' em crm_automacao_log (tipo é texto livre).

ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'atendimento';

ALTER TABLE public.crm_ai_agents DROP CONSTRAINT IF EXISTS crm_ai_agents_tipo_check;
ALTER TABLE public.crm_ai_agents ADD CONSTRAINT crm_ai_agents_tipo_check CHECK (tipo IN ('atendimento', 'followup'));

COMMENT ON COLUMN public.crm_ai_agents.tipo IS
  'atendimento = responde a lead; followup = escreve a mensagem do passo Mensagem da IA dos fluxos (18/10/2026)';

CREATE INDEX IF NOT EXISTS crm_ai_agents_tipo_idx ON public.crm_ai_agents (tipo);
