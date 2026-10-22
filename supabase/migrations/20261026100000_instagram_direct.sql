-- Instagram Direct no CRM (Instagram API with Instagram Login), 17/10/2026.
-- Tabelas próprias (ig_*), separadas das do WhatsApp de propósito: os gatilhos de automação e os
-- fluxos de whatsapp_contacts mandam WhatsApp, e conversa do Direct não pode disparar isso.
-- A tela Conversas junta as duas fontes; no Direct o "phone" do contato é 'ig:' + IGSID.
--
--   ig_contas        conta profissional conectada (token longo CIFRADO, coluna sem GRANT pro front)
--   ig_contatos      quem conversa no Direct (foto, @, etapa, tags) + última entrada (janela de 24 h)
--   ig_mensagens     mensagens (entrada, saída, eco do celular), mesmas colunas que a tela lê do WhatsApp
--   ig_oauth_estados state do login (uso único, 15 min), só service role
--   integracao_config 'instagram_verify_token' gerado AQUI, no banco (o dono lê pela função admin abaixo)
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.integracao_config (
  chave         text PRIMARY KEY,
  valor         text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.integracao_config ENABLE ROW LEVEL SECURITY;

-- token de verificação do webhook: 64 hex aleatórios, criado uma vez
INSERT INTO public.integracao_config (chave, valor)
VALUES ('instagram_verify_token', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (chave) DO NOTHING;

-- ------------------------------------------------------------------ contas

CREATE TABLE IF NOT EXISTS public.ig_contas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ig_user_id        text NOT NULL UNIQUE,      -- id da conta profissional (entry.id do webhook, /me user_id)
  ig_app_user_id    text,                      -- id do usuário no app (/me id, o do token)
  username          text NOT NULL DEFAULT '',
  nome              text NOT NULL DEFAULT '',
  foto_url          text,
  token_cifrado     text,                      -- AES-256-GCM (IG_TOKEN_SEGREDO); NUNCA vai pro front
  token_expira_em   timestamptz,
  permissoes        text[] NOT NULL DEFAULT '{}',
  status            text NOT NULL DEFAULT 'conectado' CHECK (status IN ('conectado', 'expirado', 'desconectado', 'erro')),
  webhook_assinado  boolean NOT NULL DEFAULT false,
  ultimo_erro       text,
  conectado_por     uuid,
  conectado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ig_contas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ig_contas FROM PUBLIC, anon, authenticated;
-- front lê só as colunas sem segredo
GRANT SELECT (id, ig_user_id, username, nome, foto_url, token_expira_em, permissoes, status, webhook_assinado,
              ultimo_erro, conectado_em, atualizado_em)
  ON public.ig_contas TO authenticated;
GRANT ALL ON TABLE public.ig_contas TO service_role;
DROP POLICY IF EXISTS "Aprovados leem ig_contas" ON public.ig_contas;
CREATE POLICY "Aprovados leem ig_contas" ON public.ig_contas FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

-- ------------------------------------------------------------------ contatos

CREATE TABLE IF NOT EXISTS public.ig_contatos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id             uuid NOT NULL REFERENCES public.ig_contas(id) ON DELETE CASCADE,
  igsid                text NOT NULL,
  phone                text NOT NULL UNIQUE,   -- 'ig:' || igsid (chave que a tela usa)
  username             text,
  name                 text NOT NULL DEFAULT '',
  avatar_url           text,
  avatar_atualizado_em timestamptz,
  stage                text NOT NULL DEFAULT 'leads',
  tags                 text[] NOT NULL DEFAULT '{}',
  notes                text DEFAULT '',
  ai_agent_slug        text,
  ai_pausado           boolean NOT NULL DEFAULT false,
  segue_voce           boolean,
  seguidores           integer,
  ultima_entrada_em    timestamptz,            -- última mensagem DA PESSOA: base da janela de 24 h / 7 dias
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ig_contatos_phone_ok CHECK (phone = 'ig:' || igsid),
  CONSTRAINT ig_contatos_conta_igsid UNIQUE (conta_id, igsid)
);
CREATE INDEX IF NOT EXISTS ig_contatos_updated_idx ON public.ig_contatos (updated_at DESC);
ALTER TABLE public.ig_contatos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ig_contatos FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON TABLE public.ig_contatos TO authenticated;
GRANT ALL ON TABLE public.ig_contatos TO service_role;
DROP POLICY IF EXISTS "Aprovados leem ig_contatos" ON public.ig_contatos;
CREATE POLICY "Aprovados leem ig_contatos" ON public.ig_contatos FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));
DROP POLICY IF EXISTS "Aprovados editam ig_contatos" ON public.ig_contatos;
CREATE POLICY "Aprovados editam ig_contatos" ON public.ig_contatos FOR UPDATE TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));

-- o front só muda etapa, tags, notas e agente; identidade e janela são do webhook
CREATE OR REPLACE FUNCTION public.ig_contatos_trava_colunas()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('role', true) = 'authenticated' THEN
    NEW.id := OLD.id; NEW.conta_id := OLD.conta_id; NEW.igsid := OLD.igsid; NEW.phone := OLD.phone;
    NEW.username := OLD.username; NEW.avatar_url := OLD.avatar_url; NEW.ultima_entrada_em := OLD.ultima_entrada_em;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ig_contatos_trava ON public.ig_contatos;
CREATE TRIGGER trg_ig_contatos_trava BEFORE UPDATE ON public.ig_contatos
  FOR EACH ROW EXECUTE FUNCTION public.ig_contatos_trava_colunas();

-- ------------------------------------------------------------------ mensagens

CREATE TABLE IF NOT EXISTS public.ig_mensagens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id      uuid NOT NULL REFERENCES public.ig_contas(id) ON DELETE CASCADE,
  contato_id    uuid REFERENCES public.ig_contatos(id) ON DELETE CASCADE,
  contact_phone text NOT NULL,                 -- 'ig:' || igsid
  direction     text NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  sender_type   text NOT NULL DEFAULT 'lead',  -- lead | human (CRM) | user (app do celular, eco)
  body          text NOT NULL DEFAULT '',
  caption       text,
  media_url     text,
  media_type    text,
  mime_type     text,
  file_name     text,
  message_id    text,                          -- mid da Meta
  status        text DEFAULT 'sent',
  erro          text,
  tag           text,                          -- HUMAN_AGENT quando foi fora das 24 h
  enviado_por   uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_mensagens_mid_uidx ON public.ig_mensagens (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ig_mensagens_phone_idx ON public.ig_mensagens (contact_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS ig_mensagens_created_idx ON public.ig_mensagens (created_at DESC);
ALTER TABLE public.ig_mensagens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ig_mensagens FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ig_mensagens TO authenticated;
GRANT ALL ON TABLE public.ig_mensagens TO service_role;
DROP POLICY IF EXISTS "Aprovados leem ig_mensagens" ON public.ig_mensagens;
CREATE POLICY "Aprovados leem ig_mensagens" ON public.ig_mensagens FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

-- ------------------------------------------------------------------ estados do login

CREATE TABLE IF NOT EXISTS public.ig_oauth_estados (
  state     text PRIMARY KEY,
  user_id   uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ig_oauth_estados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ig_oauth_estados FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ig_oauth_estados TO service_role;

-- ------------------------------------------------------------------ realtime

DO $rt$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.ig_mensagens; EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.ig_contatos; EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END;
END
$rt$;

-- ------------------------------------------------------------------ dados pra colar na Meta (só admin)

-- URLs e token de verificação que o dono cola no painel do app. Só admin (ou o SQL editor).
CREATE OR REPLACE FUNCTION public.instagram_dados_meta()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_base text := 'https://SEU_PROJECT_REF.supabase.co/functions/v1';
BEGIN
  IF NOT (
    current_setting('role', true) = 'service_role'
    OR session_user IN ('postgres', 'supabase_admin')
    OR (auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  SELECT valor INTO v_token FROM public.integracao_config WHERE chave = 'instagram_verify_token';
  RETURN jsonb_build_object(
    'webhook_url', v_base || '/instagram-webhook',
    'verify_token', v_token,
    'oauth_redirect_uri', v_base || '/instagram-oauth',
    'deauthorize_url', v_base || '/instagram-oauth?evento=desautorizar',
    'data_deletion_url', v_base || '/instagram-oauth?evento=excluir',
    'human_agent', coalesce((SELECT valor FROM public.integracao_config WHERE chave = 'instagram_human_agent'), 'nao')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.instagram_dados_meta() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.instagram_dados_meta() TO authenticated, service_role;
