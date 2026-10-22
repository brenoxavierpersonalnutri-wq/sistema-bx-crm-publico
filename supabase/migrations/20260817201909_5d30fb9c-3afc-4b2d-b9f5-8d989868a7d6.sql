DELETE FROM public.whatsapp_messages a
USING public.whatsapp_messages b
WHERE a.message_id IS NOT NULL
  AND a.message_id = b.message_id
  AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_message_id_key
  ON public.whatsapp_messages (message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_messages_phone_created_idx
  ON public.whatsapp_messages (contact_phone, created_at DESC);