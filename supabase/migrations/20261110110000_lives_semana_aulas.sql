-- =============================================================
-- LIVES: semana de aulas (6 lives numa playlist do YouTube) — 21/10/2026.
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente. Rodar DEPOIS da 20261110100100_lives_reprises.sql.
--
-- live_semanas: uma semana = uma playlist (criada pelo CRM ou escolhida) + as lives dela. A live de cada aula é
-- uma sala nova (cena, banners e canal da live de onde a semana foi programada) com semana_id/semana_ordem.
-- O índice único (semana, ordem) torna a criação de cada aula idempotente (repetir não duplica).
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.live_semanas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid,
  room_origem_id   uuid NOT NULL REFERENCES public.live_rooms(id) ON DELETE CASCADE,
  nome             text NOT NULL CHECK (length(nome) BETWEEN 1 AND 150),
  privacidade      text NOT NULL DEFAULT 'unlisted' CHECK (privacidade IN ('public', 'unlisted', 'private')),
  yt_conta_id      uuid,
  playlist_id      text,
  playlist_criada  boolean NOT NULL DEFAULT false,  -- true = o CRM criou (pode apagar ao cancelar)
  cancelada_em     timestamptz,
  criada_em        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_semanas_origem_idx ON public.live_semanas (room_origem_id, criada_em DESC);

ALTER TABLE public.live_semanas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.live_semanas FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.live_semanas TO service_role;
GRANT SELECT ON TABLE public.live_semanas TO authenticated;
DROP POLICY IF EXISTS "Lives le semanas" ON public.live_semanas;
CREATE POLICY "Lives le semanas" ON public.live_semanas FOR SELECT TO authenticated USING (public.pode_lives(auth.uid()));

ALTER TABLE public.live_rooms
  ADD COLUMN IF NOT EXISTS semana_id    uuid REFERENCES public.live_semanas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS semana_ordem int CHECK (semana_ordem IS NULL OR semana_ordem BETWEEN 1 AND 7);

CREATE UNIQUE INDEX IF NOT EXISTS live_rooms_semana_ordem_uidx
  ON public.live_rooms (semana_id, semana_ordem)
  WHERE semana_id IS NOT NULL AND reprise_cancelada_em IS NULL;

COMMIT;

-- Conferir:
--   SELECT count(*) FROM public.live_semanas;                                                          -> 0
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'live_rooms' AND column_name LIKE 'semana_%'; -> 2
