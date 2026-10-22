-- =============================================================
-- OCULTAR NÚMERO EM /crm/conversas — 21/10/2026
-- Rodar no SQL editor do Lovable Cloud. Idempotente. NÃO apaga nem altera mensagem, contato ou conversa.
--
-- O Grupos 1 (sessão grupos-1) só cria/configura grupos do Disparo em grupo. Suas conversas duplicavam as do
-- Pessoal Breno (mesmo chip) em /crm/conversas. Com ocultar_em_conversas = true o número some do seletor
-- "Número", das listas (Tudo / Não lidas / Grupos / Sem conversa) e dos contadores. Disparo em grupo,
-- Conexão WhatsApp e robô de IA não olham essa coluna.
-- Sem rodar esta migration, o front já oculta pela sessão grupos-N (mesma regra do Disparo em grupo).
-- =============================================================
ALTER TABLE public.crm_numeros
  ADD COLUMN IF NOT EXISTS ocultar_em_conversas boolean NOT NULL DEFAULT false;

UPDATE public.crm_numeros
   SET ocultar_em_conversas = true
 WHERE sessao_openwa = 'grupos-1' AND ocultar_em_conversas IS DISTINCT FROM true;

-- conferência
SELECT chave, apelido, sessao_openwa, ocultar_em_conversas FROM public.crm_numeros ORDER BY ordem;
