-- =============================================================
-- LIVES: a agenda continua chamando o tick enquanto houver live PROGRAMADA no ar (revisão 20/10/2026).
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente (só CREATE OR REPLACE da função).
--
-- Antes: live_agenda_tick só chamava a edge function live-aula nos 15 min depois de processar a sala, ou com
-- aula_encerrar_ao_fim ligado. Se o vídeo não tocava (ou o webhook do fim limpava o estado e o encerrar falhava),
-- a live ficava no ar sem vídeo e ninguém mais olhava. Agora também chama enquanto houver sala ao vivo que o
-- próprio tick iniciou (auto_iniciar, entrou no ar até 5 min depois de processada): o tick encerra a que ficar
-- 10 min no ar sem vídeo e sem ninguém no estúdio (regra conferir-orfa em _shared/aulaVideo.ts).
-- =============================================================

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
                             -- live programada que o tick pôs no ar: segue vigiando até encerrar
                             OR (auto_iniciar AND agenda_processada_em IS NOT NULL AND iniciada_em IS NOT NULL
                                 AND iniciada_em BETWEEN agenda_processada_em - interval '1 minute'
                                                     AND agenda_processada_em + interval '5 minutes'))) THEN
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

-- Conferir: SELECT public.live_agenda_tick();  -> 'nada a fazer' (sem live programada no ar) ou 'chamado'.
