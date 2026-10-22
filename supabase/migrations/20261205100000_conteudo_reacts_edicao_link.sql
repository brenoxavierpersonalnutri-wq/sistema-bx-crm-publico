-- Estúdio React: tela de edição, modelo de edição e vídeo original por link. Idempotente: pode rodar mais de uma vez.
-- Sem esta migration a tela funciona igual: a VPS guarda a edição (edicao.json) e o link (link.json) junto dos vídeos,
-- por 15 dias. Com ela o projeto lembra para sempre:
--   edicao         as escolhas da tela de edição: {"trechos": [...], "edicao": {volume_geral, ia_gancho, ia_titulo,
--                  cortes_ia_restaurados}, "salvo_em": epoch}. Cada trecho: tipo, ini, fim, orig e, opcionais,
--                  layout, volume, mudo, removido, congelar, pausa.
--   modelo_edicao  o modelo escolhido no seletor ("nativo" é o padrão; os modelos moram em infra/react/modelos)
--   origem_url     o link do Reels/post de onde veio o vídeo original (para dar crédito ao autor)
--   origem_autor   o @ do autor, como o Instagram informou
ALTER TABLE public.conteudo_reacts ADD COLUMN IF NOT EXISTS edicao jsonb;
ALTER TABLE public.conteudo_reacts ADD COLUMN IF NOT EXISTS modelo_edicao text;
ALTER TABLE public.conteudo_reacts ADD COLUMN IF NOT EXISTS origem_url text;
ALTER TABLE public.conteudo_reacts ADD COLUMN IF NOT EXISTS origem_autor text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conteudo_reacts_edicao_check') THEN
    ALTER TABLE public.conteudo_reacts ADD CONSTRAINT conteudo_reacts_edicao_check
      CHECK (edicao IS NULL OR (jsonb_typeof(edicao) = 'object'
                                AND coalesce(jsonb_typeof(edicao -> 'trechos'), '') = 'array'
                                AND jsonb_array_length(edicao -> 'trechos') <= 1000
                                AND pg_column_size(edicao) <= 524288));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conteudo_reacts_modelo_edicao_check') THEN
    ALTER TABLE public.conteudo_reacts ADD CONSTRAINT conteudo_reacts_modelo_edicao_check
      CHECK (modelo_edicao IS NULL OR modelo_edicao ~ '^[a-z0-9_-]{1,40}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conteudo_reacts_origem_url_check') THEN
    ALTER TABLE public.conteudo_reacts ADD CONSTRAINT conteudo_reacts_origem_url_check
      CHECK (origem_url IS NULL OR (length(origem_url) <= 500 AND origem_url ~ '^https://'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conteudo_reacts_origem_autor_check') THEN
    ALTER TABLE public.conteudo_reacts ADD CONSTRAINT conteudo_reacts_origem_autor_check
      CHECK (origem_autor IS NULL OR length(origem_autor) <= 80);
  END IF;
END $$;

COMMENT ON COLUMN public.conteudo_reacts.edicao IS
  'Escolhas da tela de edição do Estúdio React (trechos com layout/volume/mudo/removido/congelar/pausa + ajustes gerais).';
COMMENT ON COLUMN public.conteudo_reacts.origem_url IS 'Link do Reels/post de onde veio o vídeo original (crédito ao autor).';
