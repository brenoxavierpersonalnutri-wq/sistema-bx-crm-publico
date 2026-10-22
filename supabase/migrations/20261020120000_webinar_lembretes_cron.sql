-- =============================================================
-- Lembretes do webinário: pg_cron (1/min) -> webinar_lembretes_tick() -> pg_net POST na edge
-- function webinar-reminders-tick com o segredo integracao_config.webinar_lembretes_segredo.
-- Mesmo padrão de crm_automacoes_tick. Rodar DEPOIS de 20261020110000_webinar_ao_vivo.sql.
--
-- NASCE DESLIGADO: só chama a função se existir lembrete pendente vencido de webinário com
-- lembretes_ativos = true, e só depois que a URL da função for gravada (passo abaixo).
-- =============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

INSERT INTO public.integracao_config (chave, valor)
VALUES ('webinar_lembretes_segredo', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (chave) DO NOTHING;

CREATE OR REPLACE FUNCTION public.webinar_lembretes_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url     text;
  v_segredo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.webinar_reminders_queue q
      JOIN public.webinar_registrations r ON r.id = q.registration_id
      JOIN public.webinars w ON w.id = r.webinar_id
     WHERE q.status = 'pendente' AND q.enviar_em <= now() AND w.lembretes_ativos
  ) THEN
    RETURN 'nada a fazer';
  END IF;

  SELECT valor INTO v_url FROM public.integracao_config WHERE chave = 'webinar_lembretes_fn_url';
  SELECT valor INTO v_segredo FROM public.integracao_config WHERE chave = 'webinar_lembretes_segredo';
  IF v_url IS NULL OR v_url !~ '^https://' OR v_segredo IS NULL THEN
    RETURN 'sem url/segredo';
  END IF;

  PERFORM net.http_post(
    url                  := v_url,
    body                 := jsonb_build_object('modo', 'tick'),
    headers              := jsonb_build_object('Content-Type', 'application/json', 'x-lembretes-segredo', v_segredo),
    timeout_milliseconds := 120000
  );
  RETURN 'chamado';
END;
$$;
REVOKE ALL ON FUNCTION public.webinar_lembretes_tick() FROM PUBLIC, anon, authenticated;

COMMIT;

SELECT cron.schedule('webinar-lembretes-tick', '* * * * *', 'SELECT public.webinar_lembretes_tick()');

-- =============================================================
-- DEPOIS DE RODAR:
--  1) Publicar a edge function webinar-reminders-tick (verify_jwt = false).
--  2) Gravar a URL dela:
--     INSERT INTO public.integracao_config (chave, valor)
--     VALUES ('webinar_lembretes_fn_url', 'https://<projeto>.supabase.co/functions/v1/webinar-reminders-tick')
--     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
--  3) Ligar por webinário: webinars.lembretes_ativos = true (tela de edição).
-- =============================================================
