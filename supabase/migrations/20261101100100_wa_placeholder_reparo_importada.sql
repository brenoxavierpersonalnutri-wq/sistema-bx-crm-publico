-- =============================================================
-- WhatsApp: reparo do "[mensagem]" do comercial-fit-2 e não lidas sem importação (18/10/2026)
-- =============================================================
-- Causa (conferida no código do OpenWA v0.24.0, src/engine/adapters/message-mapper.ts): ao parear um
-- aparelho novo o WhatsApp Web cria um aviso de sistema em CADA conversa (criptografia de ponta a ponta,
-- gp2, número de segurança). O OpenWA manda isso no webhook message.received como type "unknown" com body
-- vazio e o horário do pareamento; o openwa-webhook gravava a bolha "[mensagem]" (1 por conversa, 19:0x,
-- 1 não lida). O código novo (_shared/openwa.ts, semConteudo) ignora esses eventos.
--
-- 1) Apaga SÓ as linhas-placeholder do número comercial-fit-2: body exatamente '[mensagem]', sem mídia,
--    sem legenda, sem arquivo. Nenhuma mensagem real tem esse corpo (era o texto de "não sei o que é").
--    Contatos NÃO são tocados (nem updated_at, nem etapa): quem ficou sem mensagem vai para "Sem conversa"
--    até a importação da lista trazer as mensagens reais (botão "Trazer conversas" na tela Conexões).
-- 2) whatsapp_messages.importada: true em tudo que entra pela importação (whatsapp_inserir_mensagens,
--    usada só por backfill/histórico). Default constante false: não reescreve a tabela.
-- 3) crm_conversas_ultimas: não lidas contam só mensagem que CHEGOU (webhook), nunca a importada.
-- Idempotente. Rodar DEPOIS de 20261028100000_wa_numero_por_conversa.sql.
-- =============================================================

BEGIN;

-- 0) conferência antes (aparece no resultado do SQL Editor) ----------------------------------------
DO $$
DECLARE
  v_num uuid;
  v_n int;
BEGIN
  SELECT id INTO v_num FROM public.crm_numeros WHERE sessao_openwa = 'comercial-fit-2' ORDER BY ordem LIMIT 1;
  IF v_num IS NULL THEN
    RAISE NOTICE 'comercial-fit-2 não está em crm_numeros: nada a reparar';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM public.whatsapp_messages
   WHERE numero_id = v_num AND body = '[mensagem]' AND media_type IS NULL
     AND coalesce(caption, '') = '' AND coalesce(file_name, '') = '' AND media_path IS NULL;
  RAISE NOTICE 'placeholders [mensagem] do comercial-fit-2 a apagar: %', v_n;

  -- 1) reparo
  DELETE FROM public.whatsapp_messages
   WHERE numero_id = v_num AND body = '[mensagem]' AND media_type IS NULL
     AND coalesce(caption, '') = '' AND coalesce(file_name, '') = '' AND media_path IS NULL;
END $$;

-- 2) marca de importação ------------------------------------------------------------------------
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS importada boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.whatsapp_inserir_mensagens(p_linhas jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
  v_padrao uuid := public.crm_numero_padrao_id();
BEGIN
  INSERT INTO public.whatsapp_messages (
    numero_id, contact_phone, direction, sender_type, body, media_type, mime_type, file_name, caption,
    message_id, created_at, author_name, author_phone, author_id, media_status, importada
  )
  SELECT coalesce(x.numero_id, v_padrao), x.contact_phone, coalesce(x.direction, 'inbound'), coalesce(x.sender_type, 'lead'),
         coalesce(x.body, ''), x.media_type, x.mime_type, x.file_name, x.caption, x.message_id, coalesce(x.created_at, now()),
         x.author_name, x.author_phone, x.author_id, x.media_status, true
    FROM jsonb_to_recordset(p_linhas) AS x(
      numero_id uuid, contact_phone text, direction text, sender_type text, body text, media_type text, mime_type text,
      file_name text, caption text, message_id text, created_at timestamptz, author_name text,
      author_phone text, author_id text, media_status text)
   WHERE x.contact_phone IS NOT NULL AND x.message_id IS NOT NULL AND x.created_at IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.whatsapp_inserir_mensagens(jsonb) FROM PUBLIC, anon, authenticated;

-- 3) resumo da lista: não lida = chegou pelo webhook depois do corte (importada nunca conta) ------------
CREATE OR REPLACE FUNCTION public.crm_conversas_ultimas(
  p_base     timestamptz DEFAULT NULL,
  p_leituras jsonb       DEFAULT '{}'::jsonb
)
RETURNS TABLE (contact_phone text, numero_id uuid, ultima_em timestamptz, ultima jsonb, nao_lidas int)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.phone,
         c.numero_id,
         m.created_at,
         to_jsonb(m),
         CASE WHEN k.corte IS NULL THEN 0 ELSE (
           SELECT count(*)::int FROM public.whatsapp_messages n
            WHERE n.numero_id = c.numero_id AND n.contact_phone = c.phone
              AND n.created_at > k.corte AND n.direction IS DISTINCT FROM 'outbound'
              AND NOT n.importada
         ) END
    FROM public.whatsapp_contacts c
    CROSS JOIN LATERAL (
      SELECT w.id, w.numero_id, w.contact_phone, w.body, w.caption, w.created_at, w.direction, w.sender_type, w.status,
             w.media_url, w.media_type, w.mime_type, w.file_name, w.message_id,
             w.author_name, w.author_phone, w.author_id, w.media_path, w.media_status, w.importada
        FROM public.whatsapp_messages w
       WHERE w.numero_id = c.numero_id AND w.contact_phone = c.phone
       ORDER BY w.created_at DESC
       LIMIT 1
    ) m
    CROSS JOIN LATERAL (
      SELECT coalesce(p_leituras ->> (c.numero_id::text || '|' || c.phone), p_leituras ->> c.phone) AS lida
    ) l
    CROSS JOIN LATERAL (
      SELECT greatest(
               CASE WHEN coalesce(l.lida, '') ~ '^\d{4}-\d{2}-\d{2}T' THEN l.lida::timestamptz END,
               p_base) AS corte
    ) k
   ORDER BY m.created_at DESC, c.phone;
$$;
REVOKE ALL ON FUNCTION public.crm_conversas_ultimas(timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_conversas_ultimas(timestamptz, jsonb) TO authenticated, service_role;

COMMIT;

-- Conferir depois:
--   SELECT count(*) FROM whatsapp_messages m JOIN crm_numeros n ON n.id = m.numero_id
--    WHERE n.sessao_openwa = 'comercial-fit-2' AND m.body = '[mensagem]';                    -- 0
--   SELECT contact_phone, ultima_em, nao_lidas FROM crm_conversas_ultimas(now() - interval '1 day', '{}') LIMIT 10;
-- Outros números com o mesmo lixo (pareados antes da correção) — conferir e, se quiser, apagar igual:
--   SELECT n.sessao_openwa, count(*) FROM whatsapp_messages m JOIN crm_numeros n ON n.id = m.numero_id
--    WHERE m.body = '[mensagem]' AND m.media_type IS NULL GROUP BY 1;
