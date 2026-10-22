-- Lives: pareamento automático dos segredos do LiveKit (VPS -> CRM), 17/10/2026.
-- A VPS manda UMA vez LIVEKIT_URL/API_KEY/API_SECRET pela edge function live-pareamento
-- (IP da VPS + HMAC com o wa_proxy_secret + nonce único). O valor fica em integracao_config
-- chave 'livekit' (JSON {url, api_key, api_secret}), lido só pelo service role.
-- Idempotente: rodar de novo não apaga valor nem nonce.

CREATE TABLE IF NOT EXISTS public.integracao_config (
  chave         text PRIMARY KEY,
  valor         text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.integracao_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integracao_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.integracao_config TO service_role;

-- nonces já usados (replay): só as funções abaixo escrevem
CREATE TABLE IF NOT EXISTS public.live_pareamento_nonces (
  nonce     text PRIMARY KEY,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.live_pareamento_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.live_pareamento_nonces FROM PUBLIC, anon, authenticated, service_role;

-- aceita gravação? (sem valor ainda, ou rearmado pelo dono). Não expõe valor.
CREATE OR REPLACE FUNCTION public.live_pareamento_aceita()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'livekit')
      OR EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'livekit_pareamento_rearmado');
$$;

-- grava de forma atômica: 'ok' | 'replay' (nonce repetido) | 'ja_pareado'
CREATE OR REPLACE FUNCTION public.live_pareamento_gravar(p_valor text, p_nonce text, p_ip text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
  v_agora text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
BEGIN
  IF p_valor IS NULL OR length(p_valor) < 20 OR p_nonce IS NULL OR p_nonce !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RAISE EXCEPTION 'parâmetros inválidos';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('live_pareamento'));
  DELETE FROM public.live_pareamento_nonces WHERE criado_em < now() - interval '1 day';
  INSERT INTO public.live_pareamento_nonces (nonce) VALUES (p_nonce) ON CONFLICT (nonce) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN 'replay';
  END IF;
  IF EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'livekit')
     AND NOT EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'livekit_pareamento_rearmado') THEN
    RETURN 'ja_pareado';
  END IF;
  INSERT INTO public.integracao_config (chave, valor) VALUES ('livekit', p_valor)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  DELETE FROM public.integracao_config WHERE chave = 'livekit_pareamento_rearmado';
  INSERT INTO public.integracao_config (chave, valor) VALUES ('livekit_pareado_em', v_agora)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  INSERT INTO public.integracao_config (chave, valor) VALUES ('livekit_pareado_ip', left(coalesce(p_ip, '?'), 64))
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  RETURN 'ok';
END;
$$;

-- rearma para UMA nova gravação (o valor atual continua valendo até a VPS mandar o novo).
-- Só service role, o dono no SQL editor (postgres) ou usuário com papel admin.
CREATE OR REPLACE FUNCTION public.live_pareamento_reabrir()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    coalesce(auth.role(), '') = 'service_role'
    OR current_setting('role', true) = 'service_role'   -- PostgREST faz SET LOCAL ROLE
    OR session_user IN ('postgres', 'supabase_admin')
    OR (auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.integracao_config (chave, valor)
  VALUES ('livekit_pareamento_rearmado', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  RETURN 'pareamento das lives rearmado: a VPS pode gravar uma vez (sudo headturbo-live-parear --executar)';
END;
$$;

REVOKE ALL ON FUNCTION public.live_pareamento_aceita() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_pareamento_gravar(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_pareamento_reabrir() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_pareamento_aceita() TO service_role;
GRANT EXECUTE ON FUNCTION public.live_pareamento_gravar(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.live_pareamento_reabrir() TO authenticated, service_role;
