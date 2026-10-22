-- CRM WhatsApp: fotos de perfil, grupos e pareamento automático com a VPS (17/10/2026).
-- Idempotente: pode rodar de novo sem estragar nada (segredos existentes NÃO são trocados).

-- 1) Contatos: foto e grupo ------------------------------------------------------------------
-- avatar_url já existia (20260321191255); só garante.
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS avatar_atualizado_em timestamptz;
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false;
-- grupo é gravado com phone = JID do grupo (…@g.us); marca o que já estiver assim
UPDATE public.whatsapp_contacts SET is_group = true WHERE phone LIKE '%@g.us' AND NOT is_group;
CREATE INDEX IF NOT EXISTS whatsapp_contacts_is_group_idx ON public.whatsapp_contacts (is_group) WHERE is_group;

-- 2) Mensagens: autor em grupo --------------------------------------------------------------
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS author_name text;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS author_phone text;
-- WID do autor (…@c.us ou …@lid): em grupo o WhatsApp quase sempre manda @lid, sem telefone
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS author_id text;

-- 3) Grupo nunca entra em automação/campanha: o gatilho de eventos pula grupo -----------------
CREATE OR REPLACE FUNCTION public.crm_registrar_eventos_contato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
BEGIN
  IF coalesce(NEW.is_group, false) OR NEW.phone LIKE '%@g.us' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.crm_contato_eventos (contact_phone, tipo, valor) VALUES (NEW.phone, 'etapa', NEW.stage);
  END IF;
  FOR t IN
    SELECT unnest(coalesce(NEW.tags, '{}'))
    EXCEPT
    SELECT unnest(CASE WHEN TG_OP = 'UPDATE' THEN coalesce(OLD.tags, '{}') ELSE '{}'::text[] END)
  LOOP
    INSERT INTO public.crm_contato_eventos (contact_phone, tipo, valor) VALUES (NEW.phone, 'tag', t);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'crm_registrar_eventos_contato: %', SQLERRM; -- nunca derruba a gravação do contato
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_registrar_eventos_contato() FROM PUBLIC, anon, authenticated;

-- 4) Bucket PRIVADO das fotos (link assinado; a URL do CDN do WhatsApp expira em horas) -------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('whatsapp-avatars', 'whatsapp-avatars', false, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
-- sem policy para anon/authenticated: só a service role (edge functions) grava e assina.

-- 5) Segredos da integração com a VPS, gerados AQUI (ninguém digita valor) ---------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.integracao_config (
  chave         text PRIMARY KEY,
  valor         text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.integracao_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integracao_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.integracao_config TO service_role;

INSERT INTO public.integracao_config (chave, valor)
VALUES ('wa_proxy_secret', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (chave) DO NOTHING;
INSERT INTO public.integracao_config (chave, valor)
VALUES ('openwa_webhook_secret', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (chave) DO NOTHING;
-- janela de pareamento: 30 min a partir de agora (só abre se ainda não houve pareamento)
INSERT INTO public.integracao_config (chave, valor)
SELECT 'wa_pareamento_aberto_ate', to_char((now() + interval '30 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
WHERE NOT EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'wa_pareado_em')
ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();

-- estado (sem os valores dos segredos)
CREATE OR REPLACE FUNCTION public.wa_pareamento_estado()
RETURNS TABLE (aberto_ate text, pareado_em text, pareado_ip text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT valor FROM public.integracao_config WHERE chave = 'wa_pareamento_aberto_ate'),
    (SELECT valor FROM public.integracao_config WHERE chave = 'wa_pareado_em'),
    (SELECT valor FROM public.integracao_config WHERE chave = 'wa_pareado_ip');
$$;

-- consome o uso único de forma atômica: true só para UMA chamada, dentro da janela
CREATE OR REPLACE FUNCTION public.wa_pareamento_consumir(p_ip text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ate timestamptz;
  v_n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wa_pareamento'));
  IF EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'wa_pareado_em') THEN
    RETURN false;
  END IF;
  SELECT valor::timestamptz INTO v_ate FROM public.integracao_config WHERE chave = 'wa_pareamento_aberto_ate';
  IF v_ate IS NULL OR now() > v_ate THEN
    RETURN false;
  END IF;
  INSERT INTO public.integracao_config (chave, valor) VALUES ('wa_pareado_em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  ON CONFLICT (chave) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN false;
  END IF;
  INSERT INTO public.integracao_config (chave, valor) VALUES ('wa_pareado_ip', left(coalesce(p_ip, '?'), 64))
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  -- fecha a janela
  UPDATE public.integracao_config SET valor = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), atualizado_em = now()
  WHERE chave = 'wa_pareamento_aberto_ate';
  RETURN true;
END;
$$;

-- o DONO reabre (no SQL), se a janela passou sem parear ou se precisar parear de novo
CREATE OR REPLACE FUNCTION public.wa_pareamento_reabrir(p_minutos int DEFAULT 30)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ate text := to_char((now() + make_interval(mins => least(greatest(p_minutos, 5), 120))) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
BEGIN
  DELETE FROM public.integracao_config WHERE chave IN ('wa_pareado_em', 'wa_pareado_ip');
  INSERT INTO public.integracao_config (chave, valor) VALUES ('wa_pareamento_aberto_ate', v_ate)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  RETURN 'pareamento aberto até ' || v_ate;
END;
$$;

REVOKE ALL ON FUNCTION public.wa_pareamento_estado() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wa_pareamento_consumir(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wa_pareamento_reabrir(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_pareamento_estado() TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_pareamento_consumir(text) TO service_role;
-- wa_pareamento_reabrir: sem GRANT de propósito (só o dono, no SQL editor, como postgres)
