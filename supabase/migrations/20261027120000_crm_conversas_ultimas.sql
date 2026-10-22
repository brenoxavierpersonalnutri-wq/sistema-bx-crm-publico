-- =============================================================
-- Lista de Conversas ordenada pela ÚLTIMA MENSAGEM real (17/10/2026)
-- =============================================================
-- Problema: a lista ordenava por whatsapp_contacts.updated_at e a prévia vinha das últimas 2000
-- mensagens de todo mundo. O backfill cria contato com updated_at = agora e as mensagens dele são
-- antigas (fora das 2000): a conversa velha subia pro topo com "19:59" e "Sem mensagens".
--
-- 1) crm_conversas_ultimas(p_base, p_leituras): uma linha por contato do WhatsApp QUE TEM mensagem,
--    com a última mensagem (jsonb, mesmas colunas que o front lê), o horário dela e as não lidas
--    (entrada depois do corte = maior entre a última leitura do contato e p_base, igual ao front).
--    SECURITY INVOKER: a RLS de whatsapp_messages/whatsapp_contacts vale (só aprovado lê).
--    Usa o índice (contact_phone, created_at DESC): 1 busca por contato, sem varrer a tabela.
-- 2) integracao_config 'backfill_dias' = 90 (janela do whatsapp-backfill; "0" = sem limite).
-- =============================================================

BEGIN;

-- já existe desde 20260817025744; IF NOT EXISTS garante em banco que não tenha
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone_created
  ON public.whatsapp_messages (contact_phone, created_at DESC);

CREATE OR REPLACE FUNCTION public.crm_conversas_ultimas(
  p_base     timestamptz DEFAULT NULL,
  p_leituras jsonb       DEFAULT '{}'::jsonb
)
RETURNS TABLE (contact_phone text, ultima_em timestamptz, ultima jsonb, nao_lidas int)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.phone,
         m.created_at,
         to_jsonb(m),
         CASE WHEN k.corte IS NULL THEN 0 ELSE (
           SELECT count(*)::int FROM public.whatsapp_messages n
            WHERE n.contact_phone = c.phone AND n.created_at > k.corte AND n.direction IS DISTINCT FROM 'outbound'
         ) END
    FROM public.whatsapp_contacts c
    CROSS JOIN LATERAL (
      SELECT w.id, w.contact_phone, w.body, w.caption, w.created_at, w.direction, w.sender_type, w.status,
             w.media_url, w.media_type, w.mime_type, w.file_name, w.message_id,
             w.author_name, w.author_phone, w.author_id, w.media_path, w.media_status
        FROM public.whatsapp_messages w
       WHERE w.contact_phone = c.phone
       ORDER BY w.created_at DESC
       LIMIT 1
    ) m
    CROSS JOIN LATERAL (
      SELECT greatest(
               CASE WHEN coalesce(p_leituras ->> c.phone, '') ~ '^\d{4}-\d{2}-\d{2}T'
                    THEN (p_leituras ->> c.phone)::timestamptz END,
               p_base) AS corte
    ) k
   ORDER BY m.created_at DESC, c.phone;
$$;

REVOKE ALL ON FUNCTION public.crm_conversas_ultimas(timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_conversas_ultimas(timestamptz, jsonb) TO authenticated, service_role;

INSERT INTO public.integracao_config (chave, valor)
VALUES ('backfill_dias', '90')
ON CONFLICT (chave) DO NOTHING;

COMMIT;

-- Conferir:
--   SELECT contact_phone, ultima_em, nao_lidas FROM crm_conversas_ultimas(now() - interval '1 day', '{}') LIMIT 10;
