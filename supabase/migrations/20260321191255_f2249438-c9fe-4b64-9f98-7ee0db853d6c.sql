
-- WhatsApp contacts / CRM leads
CREATE TABLE public.whatsapp_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  avatar_url text,
  stage text NOT NULL DEFAULT 'leads',
  source text DEFAULT 'whatsapp',
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can read whatsapp_contacts"
  ON public.whatsapp_contacts FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

CREATE POLICY "Approved users can insert whatsapp_contacts"
  ON public.whatsapp_contacts FOR INSERT TO authenticated
  WITH CHECK (public.is_approved(auth.uid()));

CREATE POLICY "Approved users can update whatsapp_contacts"
  ON public.whatsapp_contacts FOR UPDATE TO authenticated
  USING (public.is_approved(auth.uid()));

CREATE POLICY "Approved users can delete whatsapp_contacts"
  ON public.whatsapp_contacts FOR DELETE TO authenticated
  USING (public.is_approved(auth.uid()));

CREATE POLICY "Service can insert whatsapp_contacts"
  ON public.whatsapp_contacts FOR INSERT TO public
  WITH CHECK (true);

CREATE POLICY "Service can update whatsapp_contacts"
  ON public.whatsapp_contacts FOR UPDATE TO public
  USING (true);

-- WhatsApp messages
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_phone text NOT NULL,
  direction text NOT NULL DEFAULT 'inbound',
  sender_type text NOT NULL DEFAULT 'lead',
  body text NOT NULL DEFAULT '',
  media_url text,
  message_id text,
  status text DEFAULT 'sent',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_messages_phone ON public.whatsapp_messages(contact_phone);
CREATE INDEX idx_whatsapp_messages_created ON public.whatsapp_messages(created_at);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can read whatsapp_messages"
  ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

CREATE POLICY "Approved users can insert whatsapp_messages"
  ON public.whatsapp_messages FOR INSERT TO authenticated
  WITH CHECK (public.is_approved(auth.uid()));

CREATE POLICY "Service can insert whatsapp_messages"
  ON public.whatsapp_messages FOR INSERT TO public
  WITH CHECK (true);

CREATE POLICY "Service can update whatsapp_messages"
  ON public.whatsapp_messages FOR UPDATE TO public
  USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_contacts;

-- AI Agent settings
CREATE TABLE public.ai_agent_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model text NOT NULL DEFAULT 'gpt-4o-mini',
  prompt text NOT NULL DEFAULT '',
  temperature numeric NOT NULL DEFAULT 0.7,
  context_enabled boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_agent_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can manage ai_agent_settings"
  ON public.ai_agent_settings FOR ALL TO authenticated
  USING (public.is_approved(auth.uid()))
  WITH CHECK (public.is_approved(auth.uid()));

CREATE POLICY "Service can read ai_agent_settings"
  ON public.ai_agent_settings FOR SELECT TO public
  USING (true);
