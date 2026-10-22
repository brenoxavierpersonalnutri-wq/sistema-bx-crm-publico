-- =============================================================
-- LIVES: reprises em lote, recorrência e rolamento (21/10/2026).
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente.
--
-- 1) live_rooms ganha de onde veio a reprise (reprise_de), a série (reprise_serie_id) e o cancelamento individual
--    (reprise_cancelada_em). Reprise cancelada some do painel /lives e fica na lista "Reprises programadas".
-- 2) live_reprise_series: recorrência CONTÍNUA (sem data final). A tela cria só as próximas N (janela, padrão 4);
--    o tick da agenda cria a seguinte quando uma acontece ou é cancelada. Idempotente: a edge reivindica a data com
--    compare-and-set em proxima_em, e o índice único (série, data) barra repetida mesmo se dois ticks cruzarem.
-- 3) live_agenda_tick passa a chamar a edge também quando uma série contínua está com menos reprises à frente que
--    a janela (e não está em espera por cota do YouTube: tentar_depois).
-- =============================================================

BEGIN;

-- 2) séries contínuas (antes das colunas de live_rooms, que apontam pra cá) ------------------------
CREATE TABLE IF NOT EXISTS public.live_reprise_series (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid,
  room_origem_id  uuid NOT NULL REFERENCES public.live_rooms(id) ON DELETE CASCADE,
  frequencia_dias int  NOT NULL CHECK (frequencia_dias IN (1, 7, 14, 21, 30)),
  proxima_em      timestamptz NOT NULL,
  janela          int  NOT NULL DEFAULT 4 CHECK (janela BETWEEN 1 AND 10),
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- título, descrição, privacidade, playlist, vídeo, iniciar sozinho, sufixo
  ativa           boolean NOT NULL DEFAULT true,
  tentar_depois   timestamptz,
  ultimo_erro     text,
  criada_em       timestamptz NOT NULL DEFAULT now(),
  atualizada_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_reprise_series_origem_idx ON public.live_reprise_series (room_origem_id);
CREATE INDEX IF NOT EXISTS live_reprise_series_ativa_idx ON public.live_reprise_series (ativa) WHERE ativa;

ALTER TABLE public.live_reprise_series ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.live_reprise_series FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.live_reprise_series TO service_role;
GRANT SELECT ON TABLE public.live_reprise_series TO authenticated;
DROP POLICY IF EXISTS "Lives le series de reprise" ON public.live_reprise_series;
CREATE POLICY "Lives le series de reprise" ON public.live_reprise_series FOR SELECT TO authenticated USING (public.pode_lives(auth.uid()));

-- 1) colunas da reprise na sala ------------------------------------------------------------------
ALTER TABLE public.live_rooms
  ADD COLUMN IF NOT EXISTS reprise_de           uuid REFERENCES public.live_rooms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reprise_serie_id     uuid REFERENCES public.live_reprise_series(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reprise_cancelada_em timestamptz;

CREATE INDEX IF NOT EXISTS live_rooms_reprise_de_idx ON public.live_rooms (reprise_de) WHERE reprise_de IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS live_rooms_reprise_serie_data_uidx
  ON public.live_rooms (reprise_serie_id, agendada_em)
  WHERE reprise_serie_id IS NOT NULL AND agendada_em IS NOT NULL;

-- 3) tick: também quando uma série contínua precisa de reprise nova --------------------------------
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
                      WHERE status = 'ao_vivo'
                        AND (aula_encerrar_ao_fim
                             OR agenda_processada_em > now() - interval '15 minutes'
                             OR (auto_iniciar AND agenda_processada_em IS NOT NULL AND iniciada_em IS NOT NULL
                                 AND iniciada_em BETWEEN agenda_processada_em - interval '1 minute'
                                                     AND agenda_processada_em + interval '5 minutes')))
     -- série contínua com menos reprises à frente que a janela (rolamento)
     AND NOT EXISTS (SELECT 1 FROM public.live_reprise_series s
                      WHERE s.ativa
                        AND (s.tentar_depois IS NULL OR s.tentar_depois <= now())
                        AND (SELECT count(*) FROM public.live_rooms r
                              WHERE r.reprise_serie_id = s.id AND r.reprise_cancelada_em IS NULL
                                AND r.agendada_em > now()) < s.janela) THEN
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

-- Conferir:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'live_rooms' AND column_name LIKE 'reprise_%';  -> 3
--   SELECT count(*) FROM public.live_reprise_series;                                                                    -> 0
--   SELECT public.live_agenda_tick();                                                                                   -> 'nada a fazer' ou 'chamado'
-- Parar todas as recorrências contínuas: UPDATE public.live_reprise_series SET ativa = false;
