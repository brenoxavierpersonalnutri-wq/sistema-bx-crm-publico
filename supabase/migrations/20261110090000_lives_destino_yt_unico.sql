-- =============================================================
-- LIVES: destino YouTube automático sem duplicar (21/10/2026).
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente.
--
-- O estúdio, o "Criar live" e o "conectar conta" agora criam sozinhos o destino YouTube (canal conectado) nas lives
-- que não têm (edge live-control, ação garantir-youtube; _shared/destinoYtAuto.ts). O código confere antes de
-- criar; este índice fecha a corrida de duas abas abrindo a mesma sala no mesmo segundo: a mesma conta do YouTube
-- só entra uma vez por sala. Outro canal (outra conta) continua podendo ser adicionado à mão na aba Destinos.
--
-- Se já existir sala com a MESMA conta duas vezes, o índice não é criado (aviso no resultado) e nada é apagado:
-- confira com a consulta do fim, apague o repetido na aba Destinos e rode de novo.
-- =============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.live_destinations
     WHERE modo = 'youtube_api' AND yt_conta_id IS NOT NULL
     GROUP BY room_id, yt_conta_id HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'há destino YouTube repetido (mesma conta na mesma sala): índice NÃO criado; veja a consulta no fim do arquivo';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS live_destinations_yt_conta_sala_uidx
      ON public.live_destinations (room_id, yt_conta_id)
      WHERE modo = 'youtube_api' AND yt_conta_id IS NOT NULL;
  END IF;
END $$;

-- Conferir:
--   SELECT indexname FROM pg_indexes WHERE indexname = 'live_destinations_yt_conta_sala_uidx';   -> 1 linha
-- Repetidos (se o índice não foi criado):
--   SELECT room_id, yt_conta_id, count(*) FROM public.live_destinations
--    WHERE modo = 'youtube_api' AND yt_conta_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
