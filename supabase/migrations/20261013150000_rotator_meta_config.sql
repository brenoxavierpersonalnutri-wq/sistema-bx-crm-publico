-- =============================================================
-- Link Master: liga um projeto do rotador às campanhas do Meta.
--
-- rotator_links.meta_config (jsonb, opcional):
--   { "ad_account_id": "act_…",
--     "campaign_ids": ["…"],                  -- campanha entra se o id estiver aqui
--     "campaign_name_contains": "…",           -- OU se o nome contiver este trecho
--     "since": "YYYY-MM-DD" }                  -- início do período (vazio = criação do projeto)
--
-- O painel lê os números pela edge function meta-ads que já está publicada
-- (action "campaigns"); nenhuma função nova. A coluna herda as políticas de
-- RLS de rotator_links (só usuário aprovado lê e grava).
--
-- Idempotente: pode rodar de novo sem efeito colateral.
-- =============================================================
ALTER TABLE public.rotator_links ADD COLUMN IF NOT EXISTS meta_config jsonb;

COMMENT ON COLUMN public.rotator_links.meta_config IS
  'Conta e campanhas do Meta que mandam tráfego para /r/:slug: {ad_account_id, campaign_ids[], campaign_name_contains, since}';

-- Desafio Magra e Definida (/r/desafio): campanhas [DMD] de reativação na conta BX FN.
DO $$
DECLARE
  v_linhas integer;
BEGIN
  UPDATE public.rotator_links
     SET meta_config = jsonb_build_object(
           'ad_account_id', 'act_000000000000001',
           'campaign_ids', jsonb_build_array('120000000000000001', '120000000000000002'),
           'campaign_name_contains', 'split /r/desafio',
           'since', '2026-10-12'
         )
   WHERE id = 'd3fbebfd-89c5-4d00-9a0f-ca0d13ec18c4'
     AND slug = 'desafio';
  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  IF v_linhas <> 1 THEN
    RAISE EXCEPTION 'rotator desafio (d3fbebfd-…) não encontrado: % linha(s) atualizada(s)', v_linhas;
  END IF;
END $$;

-- Conferência (rode depois e olhe o resultado):
-- SELECT id, slug, name, meta_config FROM public.rotator_links WHERE slug = 'desafio';
