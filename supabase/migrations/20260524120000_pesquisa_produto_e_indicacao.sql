-- Adiciona colunas em pesquisa_responses pra suportar 2 produtos (MGMD/Elite)
-- e o programa de indicação remunerada.
-- IF NOT EXISTS em tudo: idempotente, seguro rodar mesmo se já existir.
-- Não recria policies — RLS atual (anon INSERT / authenticated SELECT) cobre
-- automaticamente as colunas novas.

ALTER TABLE public.pesquisa_responses
  ADD COLUMN IF NOT EXISTS produto text,
  ADD COLUMN IF NOT EXISTS programa_indicacao_interesse text,
  ADD COLUMN IF NOT EXISTS programa_indicacao_nomes text,
  ADD COLUMN IF NOT EXISTS programa_indicacao_quer_contato boolean;
