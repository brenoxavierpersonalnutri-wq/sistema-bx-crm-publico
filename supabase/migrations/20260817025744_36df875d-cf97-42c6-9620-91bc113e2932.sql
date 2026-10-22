ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS caption text;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone_created
  ON public.whatsapp_messages (contact_phone, created_at DESC);