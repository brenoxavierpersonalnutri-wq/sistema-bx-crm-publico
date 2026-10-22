-- =============================================================
-- Vídeo da aula: status "convertendo" (21/10/2026)
-- O headturbo-aulas (VPS) converte para H.264 720p / 30 fps constantes o vídeo que o Ingress do LiveKit não toca
-- direito (gravação de tela do iPhone: HEVC, taxa de quadros variável, 1320x2868). Enquanto converte, o vídeo fica
-- "convertendo": não aparece para tocar nem para programar (as duas telas e a edge function só aceitam "pronto").
-- Idempotente.
-- =============================================================
BEGIN;

-- o CHECK nasceu sem nome (live_videos_status_check pelo padrão do Postgres); remove qualquer CHECK de status
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.live_videos'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.live_videos DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.live_videos
  ADD CONSTRAINT live_videos_status_check CHECK (status IN ('enviando', 'convertendo', 'pronto', 'erro'));

COMMIT;
