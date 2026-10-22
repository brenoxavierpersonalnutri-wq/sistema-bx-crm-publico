-- Pré-carga em lote das fotos de perfil do WhatsApp (18/10/2026).
-- pg_cron (1/min) -> whatsapp_avatars_tick() -> pg_net na edge function whatsapp-avatars-tick, que busca
-- até 35 fotos/min pelo proxy. Só chama a função quando há conversa recente sem foto / com foto velha.
-- Bucket continua PRIVADO (link assinado de 1 ano, estável = o navegador guarda em cache): trocar para
-- público exporia fotos de quem esconde a foto por privacidade, e o caminho é só um hash do telefone.
-- Idempotente.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net;

INSERT INTO public.integracao_config (chave, valor)
VALUES ('whatsapp_avatars_segredo', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (chave) DO NOTHING;
INSERT INTO public.integracao_config (chave, valor)
VALUES ('whatsapp_avatars_fn_url', 'https://SEU_PROJECT_REF.supabase.co/functions/v1/whatsapp-avatars-tick')
ON CONFLICT (chave) DO NOTHING;
INSERT INTO public.integracao_config (chave, valor) VALUES ('avatars_dias', '90') ON CONFLICT (chave) DO NOTHING;

-- Quem precisa de foto: conversa com mensagem nos últimos p_dias, sem avatar_atualizado_em ou com mais de
-- 7 dias ("sem foto" também grava avatar_atualizado_em, então não repete antes disso). Mais recentes primeiro.
-- Só contato com telefone válido (10-15 dígitos) ou grupo (…@g.us): Instagram e @lid não têm foto por aqui.
CREATE OR REPLACE FUNCTION public.whatsapp_avatars_pendentes(p_limite int DEFAULT 40, p_dias int DEFAULT 90)
RETURNS TABLE (phone text, numero_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rec AS (
    SELECT m.contact_phone, m.numero_id, max(m.created_at) AS ult
      FROM public.whatsapp_messages m
     WHERE m.created_at > now() - make_interval(days => greatest(p_dias, 1))
     GROUP BY m.contact_phone, m.numero_id
  )
  SELECT DISTINCT ON (c.phone) c.phone, c.numero_id
    FROM rec r
    JOIN public.whatsapp_contacts c ON c.phone = r.contact_phone AND c.numero_id = r.numero_id
   WHERE (c.avatar_atualizado_em IS NULL OR c.avatar_atualizado_em < now() - interval '7 days')
     AND (c.phone ~ '^[0-9]{10,15}$' OR c.phone ~ '^[0-9]{5,25}(-[0-9]{5,15})?@g\.us$')
   ORDER BY c.phone, r.ult DESC
$$;
REVOKE ALL ON FUNCTION public.whatsapp_avatars_pendentes(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_avatars_pendentes(int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_avatars_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text;
  v_segredo text;
  v_dias int;
BEGIN
  SELECT coalesce(nullif(valor, '')::int, 90) INTO v_dias FROM public.integracao_config WHERE chave = 'avatars_dias';
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_avatars_pendentes(1, coalesce(v_dias, 90))) THEN
    RETURN 'nada a fazer';
  END IF;
  SELECT valor INTO v_url FROM public.integracao_config WHERE chave = 'whatsapp_avatars_fn_url';
  SELECT valor INTO v_segredo FROM public.integracao_config WHERE chave = 'whatsapp_avatars_segredo';
  IF v_url IS NULL OR v_url !~ '^https://' OR v_segredo IS NULL THEN
    RETURN 'sem url/segredo';
  END IF;
  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('modo', 'tick'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avatars-segredo', v_segredo),
    timeout_milliseconds := 110000
  );
  RETURN 'chamado';
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_avatars_tick() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('whatsapp-avatars-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-avatars-tick');
SELECT cron.schedule('whatsapp-avatars-tick', '* * * * *', 'SELECT public.whatsapp_avatars_tick()');

-- Conferência / disparo manual (1ª carga logo após publicar a função):
--   SELECT public.whatsapp_avatars_tick();                      -- 'chamado' / 'nada a fazer'
--   SELECT count(*) FROM public.whatsapp_avatars_pendentes(100000, 90);   -- quantas faltam
