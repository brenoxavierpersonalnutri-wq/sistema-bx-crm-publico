-- Lives: "Conectar conta do YouTube" (OAuth 2.0 do Google + YouTube Data API v3), 17/10/2026.
--
-- yt_contas         canal conectado; refresh_token cifrado (AES-256-GCM "y1." feito na edge function com
--                   LIVE_CHAVES_SEGREDO). O authenticated NÃO tem SELECT na coluna do token.
-- yt_oauth_estados  state anti-CSRF do login (uso único, 15 min). Só service role.
-- live_destinations ganha modo 'youtube_api': a chave nasce no "Ir ao vivo" (liveStream do canal), então
--                   chave_cifrada passa a poder ser NULL só nesse modo.
-- google_pareamento_*  a VPS entrega UMA vez o client ID/secret do app Google (integracao_config 'google_oauth'),
--                   no mesmo molde do live_pareamento (nonces na mesma tabela).
-- Idempotente.

BEGIN;

-- 1) Contas do YouTube ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.yt_contas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canal_id              text NOT NULL UNIQUE CHECK (length(canal_id) BETWEEN 3 AND 64),
  titulo                text NOT NULL DEFAULT '',
  foto_url              text,
  refresh_token_cifrado text CHECK (refresh_token_cifrado IS NULL OR refresh_token_cifrado LIKE 'y1.%'),
  escopos               text[] NOT NULL DEFAULT '{}',
  stream_id             text,
  status                text NOT NULL DEFAULT 'conectado' CHECK (status IN ('conectado', 'desconectado')),
  ultimo_erro           text,
  conectado_por         uuid,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.yt_oauth_estados (
  state     text PRIMARY KEY CHECK (state ~ '^[A-Za-z0-9_-]{20,64}$'),
  user_id   uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.yt_contas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yt_oauth_estados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.yt_contas, public.yt_oauth_estados FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.yt_contas, public.yt_oauth_estados TO service_role;

-- a tela lê o canal (sem o token); conectar/desconectar = youtube-oauth
GRANT SELECT (id, canal_id, titulo, foto_url, status, ultimo_erro, criado_em, atualizado_em)
  ON public.yt_contas TO authenticated;
DROP POLICY IF EXISTS "Lives le contas YouTube" ON public.yt_contas;
CREATE POLICY "Lives le contas YouTube" ON public.yt_contas FOR SELECT TO authenticated
  USING (public.pode_lives(auth.uid()));

-- 2) Destino YouTube conectado ----------------------------------------------------------------
ALTER TABLE public.live_destinations
  ADD COLUMN IF NOT EXISTS modo            text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS yt_conta_id     uuid REFERENCES public.yt_contas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS yt_titulo       text,
  ADD COLUMN IF NOT EXISTS yt_descricao    text,
  ADD COLUMN IF NOT EXISTS yt_privacidade  text,
  ADD COLUMN IF NOT EXISTS yt_broadcast_id text,
  ADD COLUMN IF NOT EXISTS yt_stream_id    text,
  ADD COLUMN IF NOT EXISTS yt_video_id     text,
  ADD COLUMN IF NOT EXISTS yt_estado       text,
  ADD COLUMN IF NOT EXISTS yt_erro         text;

ALTER TABLE public.live_destinations ALTER COLUMN chave_cifrada DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'live_destinations_modo_chk') THEN
    ALTER TABLE public.live_destinations ADD CONSTRAINT live_destinations_modo_chk CHECK (
      modo IN ('manual', 'youtube_api')
      AND (modo <> 'manual' OR chave_cifrada IS NOT NULL)
      AND (modo <> 'youtube_api' OR (tipo = 'youtube' AND yt_privacidade IN ('public', 'unlisted', 'private')))
      AND (yt_titulo IS NULL OR length(yt_titulo) BETWEEN 1 AND 100)
      AND (yt_descricao IS NULL OR length(yt_descricao) <= 5000)
    );
  END IF;
END $$;

-- a tela lê as colunas novas (nenhuma é segredo: id do broadcast/vídeo é público pra quem tem o link)
GRANT SELECT (modo, yt_conta_id, yt_titulo, yt_descricao, yt_privacidade, yt_video_id, yt_estado, yt_erro)
  ON public.live_destinations TO authenticated;

-- 3) Pareamento das credenciais do app Google (VPS -> CRM) ------------------------------------
CREATE OR REPLACE FUNCTION public.google_pareamento_aceita()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'google_oauth')
      OR EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'google_pareamento_rearmado');
$$;

CREATE OR REPLACE FUNCTION public.google_pareamento_gravar(p_valor text, p_nonce text, p_ip text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n int;
  v_agora text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
BEGIN
  IF p_valor IS NULL OR length(p_valor) < 20 OR p_nonce IS NULL OR p_nonce !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RAISE EXCEPTION 'parâmetros inválidos';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('google_pareamento'));
  DELETE FROM public.live_pareamento_nonces WHERE criado_em < now() - interval '1 day';
  INSERT INTO public.live_pareamento_nonces (nonce) VALUES (p_nonce) ON CONFLICT (nonce) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN 'replay';
  END IF;
  IF EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'google_oauth')
     AND NOT EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'google_pareamento_rearmado') THEN
    RETURN 'ja_pareado';
  END IF;
  INSERT INTO public.integracao_config (chave, valor) VALUES ('google_oauth', p_valor)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  DELETE FROM public.integracao_config WHERE chave = 'google_pareamento_rearmado';
  INSERT INTO public.integracao_config (chave, valor) VALUES ('google_pareado_em', v_agora)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  INSERT INTO public.integracao_config (chave, valor) VALUES ('google_pareado_ip', left(coalesce(p_ip, '?'), 64))
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.google_pareamento_reabrir()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    coalesce(auth.role(), '') = 'service_role'
    OR current_setting('role', true) = 'service_role'
    OR session_user IN ('postgres', 'supabase_admin')
    OR (auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.integracao_config (chave, valor)
  VALUES ('google_pareamento_rearmado', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  RETURN 'pareamento do Google rearmado: a VPS pode gravar uma vez (sudo headturbo-google-parear --executar)';
END;
$$;

REVOKE ALL ON FUNCTION public.google_pareamento_aceita() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.google_pareamento_gravar(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.google_pareamento_reabrir() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.google_pareamento_aceita() TO service_role;
GRANT EXECUTE ON FUNCTION public.google_pareamento_gravar(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.google_pareamento_reabrir() TO authenticated, service_role;

COMMIT;

-- =============================================================
-- DEPOIS DE RODAR: checklist do Google Cloud em infra/google/README.md; publicar youtube-oauth,
-- google-pareamento e live-control; na VPS: sudo headturbo-google-parear (seco) e --executar.
-- =============================================================
