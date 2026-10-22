-- Adiciona suporte a sub-funis (hierarquia 1 nível) e armazena a URL completa com tracking
-- O usuário cola direto a URL com UTMs prontas (ex: https://site.com/page?utm_source=...)
-- O sistema extrai os UTMs e armazena também o tracked_url original.

ALTER TABLE public.funnels
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.funnels(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tracked_url text;

CREATE INDEX IF NOT EXISTS idx_funnels_parent_id ON public.funnels(parent_id);

-- Backfill tracked_url para funis existentes (caso já tenha algum criado antes desta migration)
UPDATE public.funnels
SET tracked_url = destination_url
WHERE tracked_url IS NULL AND destination_url IS NOT NULL;
