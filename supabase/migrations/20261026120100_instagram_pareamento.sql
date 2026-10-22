-- Instagram: credenciais sem ninguém colar segredo no painel, 17/10/2026.
--  * 'instagram_token_segredo': 64 hex aleatórios gerados AQUI (gen_random_bytes), cifram o token longo
--    das contas (AES-GCM). Só service role lê. Criado uma vez; rodar de novo não troca (trocar invalida
--    os tokens já gravados: aí é reconectar o Instagram).
--  * 'instagram_app' (JSON {app_id, app_secret}): gravado UMA vez pela VPS via instagram-oauth
--    POST ?evento=parear (IP da VPS + HMAC com o wa_proxy_secret + nonce único), molde do live-pareamento.
--  As funções instagram-* leem daqui quando não há secret no env (Deno.env tem prioridade).
-- Idempotente. Depende de 20261026100000_instagram_direct.sql (integracao_config).

CREATE TABLE IF NOT EXISTS public.integracao_config (
  chave         text PRIMARY KEY,
  valor         text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.integracao_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integracao_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.integracao_config TO service_role;

INSERT INTO public.integracao_config (chave, valor)
VALUES ('instagram_token_segredo', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (chave) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ig_pareamento_nonces (
  nonce     text PRIMARY KEY,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ig_pareamento_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ig_pareamento_nonces FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.instagram_pareamento_aceita()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'instagram_app')
      OR EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'instagram_pareamento_rearmado');
$$;

-- 'ok' | 'replay' | 'ja_pareado'
CREATE OR REPLACE FUNCTION public.instagram_pareamento_gravar(p_valor text, p_nonce text, p_ip text)
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
  PERFORM pg_advisory_xact_lock(hashtext('instagram_pareamento'));
  DELETE FROM public.ig_pareamento_nonces WHERE criado_em < now() - interval '1 day';
  INSERT INTO public.ig_pareamento_nonces (nonce) VALUES (p_nonce) ON CONFLICT (nonce) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN 'replay';
  END IF;
  IF EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'instagram_app')
     AND NOT EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'instagram_pareamento_rearmado') THEN
    RETURN 'ja_pareado';
  END IF;
  INSERT INTO public.integracao_config (chave, valor) VALUES ('instagram_app', p_valor)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  DELETE FROM public.integracao_config WHERE chave = 'instagram_pareamento_rearmado';
  INSERT INTO public.integracao_config (chave, valor) VALUES ('instagram_pareado_em', v_agora)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  INSERT INTO public.integracao_config (chave, valor) VALUES ('instagram_pareado_ip', left(coalesce(p_ip, '?'), 64))
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.instagram_pareamento_reabrir()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  VALUES ('instagram_pareamento_rearmado', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  RETURN 'pareamento do Instagram rearmado: a VPS pode gravar IG_APP_ID/IG_APP_SECRET uma vez';
END;
$$;

REVOKE ALL ON FUNCTION public.instagram_pareamento_aceita() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.instagram_pareamento_gravar(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.instagram_pareamento_reabrir() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.instagram_pareamento_aceita() TO service_role;
GRANT EXECUTE ON FUNCTION public.instagram_pareamento_gravar(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.instagram_pareamento_reabrir() TO authenticated, service_role;
