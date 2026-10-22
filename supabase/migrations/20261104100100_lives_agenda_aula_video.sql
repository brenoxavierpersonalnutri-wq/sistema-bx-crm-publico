-- =============================================================
-- LIVES: live PROGRAMADA (agenda + YouTube agendado) e VÍDEO DA AULA (arquivo pré-gravado tocado no palco).
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente.
--
-- 1) live_rooms ganha descricao/agendada_em (o painel /lives já mandava e avisava "falta a migração")
--    e os campos da agenda/vídeo, que só a edge function (service role) escreve.
-- 2) live_videos: biblioteca de vídeos de aula (o arquivo mora na VPS, em headturbo-aulas; aqui só os dados).
-- 3) live_destinations: data da live programada no YouTube, playlist e miniatura.
-- 4) Tick da agenda: pg_cron 1/min -> edge function live-aula (só chama quando há trabalho).
-- =============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- 1) Vídeos de aula ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.live_videos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid DEFAULT auth.uid(),
  room_id     uuid REFERENCES public.live_rooms(id) ON DELETE SET NULL,  -- onde foi enviado (a biblioteca é comum)
  nome        text NOT NULL CHECK (length(nome) BETWEEN 1 AND 200),
  bytes       bigint CHECK (bytes IS NULL OR bytes BETWEEN 0 AND 8589934592),
  duracao_seg numeric(10, 2) CHECK (duracao_seg IS NULL OR duracao_seg >= 0),
  largura     int,
  altura      int,
  tem_audio   boolean,
  status      text NOT NULL DEFAULT 'enviando' CHECK (status IN ('enviando', 'pronto', 'erro')),
  erro        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_videos_created_idx ON public.live_videos (created_at DESC);

ALTER TABLE public.live_videos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.live_videos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.live_videos TO service_role;
GRANT SELECT ON TABLE public.live_videos TO authenticated;
DROP POLICY IF EXISTS "Lives le videos" ON public.live_videos;
CREATE POLICY "Lives le videos" ON public.live_videos FOR SELECT TO authenticated USING (public.pode_lives(auth.uid()));

-- 2) Agenda e vídeo da aula na sala -------------------------------------------------------------
ALTER TABLE public.live_rooms
  ADD COLUMN IF NOT EXISTS descricao            text,
  ADD COLUMN IF NOT EXISTS agendada_em          timestamptz,
  ADD COLUMN IF NOT EXISTS auto_iniciar         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aula_video_id        uuid REFERENCES public.live_videos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aula_ingress_id      text,
  ADD COLUMN IF NOT EXISTS aula_identity        text,
  ADD COLUMN IF NOT EXISTS aula_tocando_video   uuid,
  ADD COLUMN IF NOT EXISTS aula_tocando_desde   timestamptz,
  ADD COLUMN IF NOT EXISTS aula_palco_auto      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aula_encerrar_ao_fim boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agenda_processada_em timestamptz,
  ADD COLUMN IF NOT EXISTS agenda_aviso_em      timestamptz,
  ADD COLUMN IF NOT EXISTS agenda_erro          text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'live_rooms_descricao_chk') THEN
    ALTER TABLE public.live_rooms ADD CONSTRAINT live_rooms_descricao_chk CHECK (descricao IS NULL OR length(descricao) <= 5000);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS live_rooms_agenda_idx ON public.live_rooms (agendada_em) WHERE agenda_processada_em IS NULL;

-- o painel cria/edita título, descrição e data; o resto da agenda é da função
GRANT INSERT (titulo, layout, cor, descricao, agendada_em) ON public.live_rooms TO authenticated;
GRANT UPDATE (titulo, layout, cor, descricao, agendada_em) ON public.live_rooms TO authenticated;

-- mudou a data: a agenda volta a valer (o tick processa de novo na hora nova)
CREATE OR REPLACE FUNCTION public.live_rooms_agenda()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.agendada_em IS DISTINCT FROM OLD.agendada_em THEN
    NEW.agenda_processada_em := NULL;
    NEW.agenda_aviso_em := NULL;
    NEW.agenda_erro := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS live_rooms_agenda ON public.live_rooms;
CREATE TRIGGER live_rooms_agenda BEFORE UPDATE ON public.live_rooms
  FOR EACH ROW EXECUTE FUNCTION public.live_rooms_agenda();

-- 3) YouTube programado --------------------------------------------------------------------------
ALTER TABLE public.live_destinations
  ADD COLUMN IF NOT EXISTS yt_agendado_para timestamptz,
  ADD COLUMN IF NOT EXISTS yt_playlist_id   text,
  ADD COLUMN IF NOT EXISTS yt_miniatura_ok  boolean NOT NULL DEFAULT false;
GRANT SELECT (yt_agendado_para, yt_playlist_id, yt_miniatura_ok) ON public.live_destinations TO authenticated;

-- 4) Segredo/URL do tick (gerados aqui; ninguém digita valor) ----------------------------------
INSERT INTO public.integracao_config (chave, valor)
VALUES ('live_agenda_segredo', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (chave) DO NOTHING;
INSERT INTO public.integracao_config (chave, valor)
VALUES ('live_agenda_fn_url', 'https://SEU_PROJECT_REF.supabase.co/functions/v1/live-aula')
ON CONFLICT (chave) DO NOTHING;

CREATE OR REPLACE FUNCTION public.live_agenda_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url     text;
  v_segredo text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.live_rooms
                  WHERE agendada_em IS NOT NULL AND agenda_processada_em IS NULL
                    AND agendada_em <= now() + interval '1 minute')
     AND NOT EXISTS (SELECT 1 FROM public.live_rooms
                      WHERE status = 'ao_vivo' AND (aula_encerrar_ao_fim OR agenda_processada_em > now() - interval '15 minutes')) THEN
    RETURN 'nada a fazer';
  END IF;

  SELECT valor INTO v_url FROM public.integracao_config WHERE chave = 'live_agenda_fn_url';
  SELECT valor INTO v_segredo FROM public.integracao_config WHERE chave = 'live_agenda_segredo';
  IF v_url IS NULL OR v_url !~ '^https://' OR v_segredo IS NULL THEN
    RETURN 'sem url/segredo';
  END IF;

  PERFORM net.http_post(
    url                  := v_url,
    body                 := jsonb_build_object('acao', 'tick'),
    headers              := jsonb_build_object('Content-Type', 'application/json', 'x-live-segredo', v_segredo),
    timeout_milliseconds := 150000
  );
  RETURN 'chamado';
END;
$$;
REVOKE ALL ON FUNCTION public.live_agenda_tick() FROM PUBLIC, anon, authenticated;

COMMIT;

-- 5) Agenda (fora da transação). Reagendar com o mesmo nome substitui. ------------------------
SELECT cron.schedule('live-agenda-tick', '* * * * *', 'SELECT public.live_agenda_tick()');

-- =============================================================
-- DEPOIS DE RODAR:
--  1) Publicar as edge functions live-aula (nova, verify_jwt = false), live-control e livekit-webhook.
--  2) Conferir: SELECT public.live_agenda_tick();  -> 'nada a fazer' (sem live programada) ou 'chamado'.
--  Parar a agenda automática: SELECT cron.unschedule('live-agenda-tick');
-- =============================================================
