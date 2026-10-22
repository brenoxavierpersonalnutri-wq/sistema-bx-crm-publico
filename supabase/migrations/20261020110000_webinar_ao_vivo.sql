-- =============================================================
-- WEBINÁRIO AO VIVO (Fase 2): inscrição /w/:slug, sala com HLS (Cloudflare Stream),
-- chat ao vivo (RPC com limite + Realtime broadcast), ofertas manuais e por tempo,
-- presença por ping e fila de lembretes no WhatsApp.
-- Rodar DEPOIS de 20261020100000_lives_estudio.sql. Idempotente.
--
-- Link mágico: token = "<registration_id>.<hmac>" com
--   hmac = base64url(HMAC-SHA256(integracao_config.webinar_token_segredo, 'wreg.' || id)).
-- Nada de token guardado: a edge function e as RPCs recalculam e comparam.
-- Espectador (anon) não lê tabela nenhuma: só RPCs SECURITY DEFINER que conferem o token.
-- =============================================================

BEGIN;

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
VALUES ('webinar_token_segredo', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (chave) DO NOTHING;

-- 1) Tabelas ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webinars (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL DEFAULT auth.uid(),
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  titulo           text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 160),
  descricao        text,
  capa_url         text CHECK (capa_url IS NULL OR capa_url ~* '^https://'),
  live_room_id     uuid REFERENCES public.live_rooms(id) ON DELETE SET NULL,
  hls_offset_seg   int NOT NULL DEFAULT 20 CHECK (hls_offset_seg BETWEEN 0 AND 600),
  chat_ativo       boolean NOT NULL DEFAULT true,
  mostrar_presentes boolean NOT NULL DEFAULT true,
  lembretes_ativos boolean NOT NULL DEFAULT false,
  lembretes        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'publicado', 'arquivado')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.webinar_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id   uuid NOT NULL REFERENCES public.webinars(id) ON DELETE CASCADE,
  inicia_em    timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'agendada' CHECK (status IN ('agendada', 'ao_vivo', 'encerrada')),
  iniciada_em  timestamptz,
  encerrada_em timestamptz,
  hls_url      text CHECK (hls_url IS NULL OR hls_url ~* '^https://'),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webinar_sessions_webinar_idx ON public.webinar_sessions (webinar_id, inicia_em);

CREATE TABLE IF NOT EXISTS public.webinar_registrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id    uuid NOT NULL REFERENCES public.webinars(id) ON DELETE CASCADE,
  session_id    uuid NOT NULL REFERENCES public.webinar_sessions(id) ON DELETE CASCADE,
  nome          text NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  email         text NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  whatsapp      text CHECK (whatsapp IS NULL OR whatsapp ~ '^\d{10,15}$'),
  utm           jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash       text,          -- sha256(ip + segredo): limite de inscrições por IP, sem guardar o IP
  ultimo_acesso timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, email)
);
CREATE INDEX IF NOT EXISTS webinar_registrations_webinar_idx ON public.webinar_registrations (webinar_id);
CREATE INDEX IF NOT EXISTS webinar_registrations_ip_idx ON public.webinar_registrations (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS public.webinar_offers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id          uuid NOT NULL REFERENCES public.webinars(id) ON DELETE CASCADE,
  titulo              text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 120),
  descricao           text,
  preco_texto         text,
  cta_texto           text NOT NULL DEFAULT 'Quero garantir minha vaga',
  checkout_link_id    text,
  url                 text CHECK (url IS NULL OR url ~* '^https://'),
  modo                text NOT NULL DEFAULT 'manual' CHECK (modo IN ('manual', 'tempo')),
  aparece_em_seg      int CHECK (aparece_em_seg IS NULL OR aparece_em_seg >= 0),
  dura_seg            int CHECK (dura_seg IS NULL OR dura_seg >= 0),
  liberada_em         timestamptz,
  liberada_session_id uuid REFERENCES public.webinar_sessions(id) ON DELETE SET NULL,
  encerrada_em        timestamptz,
  ativo               boolean NOT NULL DEFAULT true,
  ordem               int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (checkout_link_id IS NOT NULL OR url IS NOT NULL),
  CHECK (modo = 'manual' OR aparece_em_seg IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS webinar_offers_webinar_idx ON public.webinar_offers (webinar_id);

CREATE TABLE IF NOT EXISTS public.webinar_chat_messages (
  id              bigserial PRIMARY KEY,
  session_id      uuid NOT NULL REFERENCES public.webinar_sessions(id) ON DELETE CASCADE,
  registration_id uuid REFERENCES public.webinar_registrations(id) ON DELETE SET NULL,
  autor_nome      text NOT NULL CHECK (length(autor_nome) BETWEEN 1 AND 80),
  texto           text NOT NULL CHECK (length(texto) BETWEEN 1 AND 500),
  papel           text NOT NULL DEFAULT 'participante' CHECK (papel IN ('participante', 'produtor')),
  oculta          boolean NOT NULL DEFAULT false,
  fixada          boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webinar_chat_session_idx ON public.webinar_chat_messages (session_id, id);
CREATE INDEX IF NOT EXISTS webinar_chat_reg_idx ON public.webinar_chat_messages (registration_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.webinar_chat_script (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id uuid NOT NULL REFERENCES public.webinars(id) ON DELETE CASCADE,
  aos_seg    int NOT NULL CHECK (aos_seg >= 0),
  autor_nome text NOT NULL CHECK (length(autor_nome) BETWEEN 1 AND 80),
  texto      text NOT NULL CHECK (length(texto) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webinar_chat_script_idx ON public.webinar_chat_script (webinar_id, aos_seg);

CREATE TABLE IF NOT EXISTS public.webinar_attendance (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL REFERENCES public.webinar_sessions(id) ON DELETE CASCADE,
  registration_id    uuid NOT NULL REFERENCES public.webinar_registrations(id) ON DELETE CASCADE,
  entrou_em          timestamptz NOT NULL DEFAULT now(),
  ultimo_ping        timestamptz NOT NULL DEFAULT now(),
  segundos_assistidos int NOT NULL DEFAULT 0,
  clicou_oferta      boolean NOT NULL DEFAULT false,
  UNIQUE (session_id, registration_id)
);
CREATE INDEX IF NOT EXISTS webinar_attendance_ping_idx ON public.webinar_attendance (session_id, ultimo_ping);

CREATE TABLE IF NOT EXISTS public.webinar_reminders_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.webinar_registrations(id) ON DELETE CASCADE,
  session_id      uuid NOT NULL REFERENCES public.webinar_sessions(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('confirmacao', '24h', '1h', '15min', 'ao_vivo')),
  enviar_em       timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'enviando', 'enviado', 'falhou', 'cancelado', 'expirado')),
  tentativas      int NOT NULL DEFAULT 0,
  erro            text,
  enviado_em      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_id, tipo)
);
CREATE INDEX IF NOT EXISTS webinar_reminders_due_idx ON public.webinar_reminders_queue (status, enviar_em);

-- 2) Lembretes: enfileira na inscrição e reagenda quando a sessão muda de horário --------------
CREATE OR REPLACE FUNCTION public.webinar_lembrete_quando(p_tipo text, p_inicio timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tipo
    WHEN '24h'     THEN p_inicio - interval '24 hours'
    WHEN '1h'      THEN p_inicio - interval '1 hour'
    WHEN '15min'   THEN p_inicio - interval '15 minutes'
    WHEN 'ao_vivo' THEN p_inicio
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.webinar_enfileirar_lembretes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inicio timestamptz;
  v_tipo   text;
  v_quando timestamptz;
BEGIN
  IF NEW.whatsapp IS NULL THEN RETURN NEW; END IF;
  SELECT inicia_em INTO v_inicio FROM public.webinar_sessions WHERE id = NEW.session_id;
  INSERT INTO public.webinar_reminders_queue (registration_id, session_id, tipo, enviar_em)
  VALUES (NEW.id, NEW.session_id, 'confirmacao', now())
  ON CONFLICT (registration_id, tipo) DO NOTHING;
  FOREACH v_tipo IN ARRAY ARRAY['24h', '1h', '15min', 'ao_vivo'] LOOP
    v_quando := public.webinar_lembrete_quando(v_tipo, v_inicio);
    -- só agenda o que ainda vai acontecer (inscrição 30 min antes não recebe o de 24h/1h)
    IF v_quando > now() + interval '2 minutes' OR (v_tipo = 'ao_vivo' AND v_quando > now()) THEN
      INSERT INTO public.webinar_reminders_queue (registration_id, session_id, tipo, enviar_em)
      VALUES (NEW.id, NEW.session_id, v_tipo, v_quando)
      ON CONFLICT (registration_id, tipo) DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS webinar_registrations_lembretes ON public.webinar_registrations;
CREATE TRIGGER webinar_registrations_lembretes AFTER INSERT ON public.webinar_registrations
  FOR EACH ROW EXECUTE FUNCTION public.webinar_enfileirar_lembretes();

CREATE OR REPLACE FUNCTION public.webinar_reagendar_lembretes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.inicia_em IS DISTINCT FROM OLD.inicia_em THEN
    UPDATE public.webinar_reminders_queue
       SET enviar_em = public.webinar_lembrete_quando(tipo, NEW.inicia_em)
     WHERE session_id = NEW.id AND status = 'pendente' AND tipo <> 'confirmacao';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS webinar_sessions_reagendar ON public.webinar_sessions;
CREATE TRIGGER webinar_sessions_reagendar AFTER UPDATE OF inicia_em ON public.webinar_sessions
  FOR EACH ROW EXECUTE FUNCTION public.webinar_reagendar_lembretes();

-- 3) Token do link mágico -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.webinar_token_de(p_reg uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT p_reg::text || '.' || rtrim(translate(encode(extensions.hmac('wreg.' || p_reg::text,
           (SELECT valor FROM public.integracao_config WHERE chave = 'webinar_token_segredo'), 'sha256'),
           'base64'), '+/', '-_'), '=')
$$;

CREATE OR REPLACE FUNCTION public.webinar_reg_do_token(p_token text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$' THEN RETURN NULL; END IF;
  v_id := split_part(p_token, '.', 1)::uuid;
  IF public.webinar_token_de(v_id) = p_token THEN RETURN v_id; END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.webinar_token_de(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webinar_reg_do_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webinar_token_de(uuid), public.webinar_reg_do_token(text) TO service_role;

-- 4) Página pública de inscrição -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.webinar_publico(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', w.id, 'slug', w.slug, 'titulo', w.titulo, 'descricao', w.descricao, 'capa_url', w.capa_url,
    'sessoes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'inicia_em', s.inicia_em, 'status', s.status) ORDER BY s.inicia_em)
        FROM public.webinar_sessions s
       WHERE s.webinar_id = w.id AND s.status <> 'encerrada'
    ), '[]'::jsonb))
  FROM public.webinars w
  WHERE w.slug = lower(p_slug) AND w.status = 'publicado'
$$;
REVOKE ALL ON FUNCTION public.webinar_publico(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.webinar_publico(text) TO anon, authenticated, service_role;

-- 5) Chat: envio com limite (3 s entre mensagens, 6 por minuto, 500 caracteres) ------------------
CREATE OR REPLACE FUNCTION public.webinar_chat_enviar(p_token text, p_texto text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_reg     public.webinar_registrations%ROWTYPE;
  v_sessao  public.webinar_sessions%ROWTYPE;
  v_texto   text := btrim(coalesce(p_texto, ''));
  v_ultima  timestamptz;
  v_minuto  int;
  v_msg     public.webinar_chat_messages%ROWTYPE;
  v_reg_id  uuid := public.webinar_reg_do_token(p_token);
BEGIN
  IF v_reg_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'motivo', 'token'); END IF;
  SELECT * INTO v_reg FROM public.webinar_registrations WHERE id = v_reg_id;
  SELECT * INTO v_sessao FROM public.webinar_sessions WHERE id = v_reg.session_id;
  IF v_sessao.status <> 'ao_vivo' THEN RETURN jsonb_build_object('ok', false, 'motivo', 'fora_do_ar'); END IF;
  IF NOT (SELECT chat_ativo FROM public.webinars WHERE id = v_reg.webinar_id) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'chat_fechado');
  END IF;
  IF v_texto = '' THEN RETURN jsonb_build_object('ok', false, 'motivo', 'vazia'); END IF;
  IF length(v_texto) > 500 THEN RETURN jsonb_build_object('ok', false, 'motivo', 'longa'); END IF;

  -- serializa por inscrição: duas abas não furam o limite
  PERFORM pg_advisory_xact_lock(hashtextextended('wchat:' || v_reg_id::text, 0));
  SELECT max(created_at), count(*) FILTER (WHERE created_at > now() - interval '60 seconds')
    INTO v_ultima, v_minuto
    FROM public.webinar_chat_messages
   WHERE registration_id = v_reg_id AND created_at > now() - interval '60 seconds';
  IF v_ultima IS NOT NULL AND v_ultima > now() - interval '3 seconds' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'rapido');
  END IF;
  IF v_minuto >= 6 THEN RETURN jsonb_build_object('ok', false, 'motivo', 'limite'); END IF;

  INSERT INTO public.webinar_chat_messages (session_id, registration_id, autor_nome, texto)
  VALUES (v_sessao.id, v_reg_id, left(split_part(v_reg.nome, ' ', 1), 80), v_texto)
  RETURNING * INTO v_msg;
  RETURN jsonb_build_object('ok', true, 'id', v_msg.id);
END;
$$;
REVOKE ALL ON FUNCTION public.webinar_chat_enviar(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.webinar_chat_enviar(text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.webinar_chat_recentes(p_token text, p_depois_de bigint DEFAULT 0)
RETURNS TABLE (id bigint, autor_nome text, texto text, papel text, fixada boolean, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.autor_nome, m.texto, m.papel, m.fixada, m.created_at
    FROM public.webinar_chat_messages m
    JOIN public.webinar_registrations r ON r.id = public.webinar_reg_do_token(p_token)
   WHERE m.session_id = r.session_id AND NOT m.oculta AND m.id > coalesce(p_depois_de, 0)
   ORDER BY m.id DESC
   LIMIT 100
$$;
REVOKE ALL ON FUNCTION public.webinar_chat_recentes(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.webinar_chat_recentes(text, bigint) TO anon, authenticated, service_role;

-- Realtime broadcast: cada mensagem/moderação/oferta vira evento no tópico "webinar:<session_id>".
-- realtime.send existe no Supabase atual; se não existir, o front cai no polling (5 s) e nada quebra.
CREATE OR REPLACE FUNCTION public.webinar_broadcast(p_sessao uuid, p_evento text, p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    EXECUTE 'SELECT realtime.send($1, $2, $3, false)' USING p_payload, p_evento, 'webinar:' || p_sessao::text;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.webinar_broadcast(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.webinar_chat_aviso()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.oculta THEN
      PERFORM public.webinar_broadcast(NEW.session_id, 'chat', jsonb_build_object(
        'id', NEW.id, 'autor_nome', NEW.autor_nome, 'texto', NEW.texto, 'papel', NEW.papel,
        'fixada', NEW.fixada, 'created_at', NEW.created_at));
    END IF;
  ELSIF NEW.oculta IS DISTINCT FROM OLD.oculta OR NEW.fixada IS DISTINCT FROM OLD.fixada THEN
    PERFORM public.webinar_broadcast(NEW.session_id, 'moderacao', jsonb_build_object(
      'id', NEW.id, 'oculta', NEW.oculta, 'fixada', NEW.fixada));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS webinar_chat_aviso ON public.webinar_chat_messages;
CREATE TRIGGER webinar_chat_aviso AFTER INSERT OR UPDATE ON public.webinar_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.webinar_chat_aviso();

CREATE OR REPLACE FUNCTION public.webinar_oferta_aviso()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.liberada_session_id IS NOT NULL AND (NEW.liberada_em IS DISTINCT FROM OLD.liberada_em
     OR NEW.encerrada_em IS DISTINCT FROM OLD.encerrada_em) THEN
    PERFORM public.webinar_broadcast(NEW.liberada_session_id, 'oferta', jsonb_build_object('id', NEW.id));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS webinar_oferta_aviso ON public.webinar_offers;
CREATE TRIGGER webinar_oferta_aviso AFTER UPDATE ON public.webinar_offers
  FOR EACH ROW EXECUTE FUNCTION public.webinar_oferta_aviso();

-- 6) RLS do produtor (módulo "lives") -------------------------------------------------------------
ALTER TABLE public.webinars                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_registrations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_offers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_chat_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_chat_script     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_attendance      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_reminders_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.webinars, public.webinar_sessions, public.webinar_registrations, public.webinar_offers,
  public.webinar_chat_messages, public.webinar_chat_script, public.webinar_attendance, public.webinar_reminders_queue
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.webinars, public.webinar_sessions, public.webinar_registrations, public.webinar_offers,
  public.webinar_chat_messages, public.webinar_chat_script, public.webinar_attendance, public.webinar_reminders_queue
  TO service_role;
GRANT USAGE ON SEQUENCE public.webinar_chat_messages_id_seq TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webinars, public.webinar_sessions, public.webinar_offers,
  public.webinar_chat_script TO authenticated;
GRANT SELECT, DELETE ON public.webinar_registrations TO authenticated;
GRANT SELECT, INSERT ON public.webinar_chat_messages TO authenticated;
GRANT UPDATE (oculta, fixada) ON public.webinar_chat_messages TO authenticated;
GRANT SELECT ON public.webinar_attendance TO authenticated;
GRANT SELECT ON public.webinar_reminders_queue TO authenticated;
GRANT UPDATE (status) ON public.webinar_reminders_queue TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['webinars', 'webinar_sessions', 'webinar_offers', 'webinar_chat_script',
                           'webinar_registrations', 'webinar_attendance', 'webinar_reminders_queue'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Lives produtor" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Lives produtor" ON public.%I FOR ALL TO authenticated
                    USING (public.pode_lives(auth.uid())) WITH CHECK (public.pode_lives(auth.uid()))', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Lives le chat" ON public.webinar_chat_messages;
CREATE POLICY "Lives le chat" ON public.webinar_chat_messages FOR SELECT TO authenticated
  USING (public.pode_lives(auth.uid()));
DROP POLICY IF EXISTS "Lives modera chat" ON public.webinar_chat_messages;
CREATE POLICY "Lives modera chat" ON public.webinar_chat_messages FOR UPDATE TO authenticated
  USING (public.pode_lives(auth.uid())) WITH CHECK (public.pode_lives(auth.uid()));
DROP POLICY IF EXISTS "Lives produtor fala no chat" ON public.webinar_chat_messages;
CREATE POLICY "Lives produtor fala no chat" ON public.webinar_chat_messages FOR INSERT TO authenticated
  WITH CHECK (public.pode_lives(auth.uid()) AND papel = 'produtor' AND registration_id IS NULL);

COMMIT;
