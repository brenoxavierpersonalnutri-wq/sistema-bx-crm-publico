-- Estúdio React: "Edição com IA" (Claude da assinatura, na VPS). Idempotente: pode rodar mais de uma vez.
-- Sem esta migration a tela funciona igual (o pedido da montagem leva as opções direto para a VPS); com ela o CRM
-- lembra a escolha de cada react e guarda o que a IA fez e quanto usou da cota (tokens) por vídeo.
ALTER TABLE public.conteudo_reacts ADD COLUMN IF NOT EXISTS edicao_ia boolean NOT NULL DEFAULT true;
ALTER TABLE public.conteudo_reacts ADD COLUMN IF NOT EXISTS duracao_max_seg numeric(6, 1);
ALTER TABLE public.conteudo_reacts ADD COLUMN IF NOT EXISTS ia_uso jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conteudo_reacts_duracao_max_seg_check') THEN
    ALTER TABLE public.conteudo_reacts ADD CONSTRAINT conteudo_reacts_duracao_max_seg_check
      CHECK (duracao_max_seg IS NULL OR duracao_max_seg BETWEEN 15 AND 600);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conteudo_reacts_ia_uso_check') THEN
    ALTER TABLE public.conteudo_reacts ADD CONSTRAINT conteudo_reacts_ia_uso_check
      CHECK (ia_uso IS NULL OR (jsonb_typeof(ia_uso) = 'object' AND pg_column_size(ia_uso) <= 8192));
  END IF;
END $$;

COMMENT ON COLUMN public.conteudo_reacts.ia_uso IS
  'Resumo da Edição com IA: título, gancho, cortes, zooms, duração e uso da cota do Claude (tokens).';
