-- IA do CRM passa a usar o Claude da Anthropic (crédito da conta do Breno), 18/10/2026.
--
-- 1) crm_ai_agents.modelo: o padrão vira claude-sonnet-5-5 e os valores antigos do gateway do Lovable
--    (google/*, openai/*) passam a Sonnet 5.5. O código já trata valor antigo como Sonnet (resolverModelo em
--    supabase/functions/_shared/anthropic.ts), então este UPDATE só deixa a tela coerente com o que roda.
-- 2) anthropic_pareamento_*: a VPS entrega UMA vez a ANTHROPIC_API_KEY (integracao_config 'anthropic_api_key'),
--    no mesmo molde do google_pareamento (nonces na mesma tabela live_pareamento_nonces).
-- Idempotente.

BEGIN;

-- 1) Modelo dos agentes -----------------------------------------------------------------------
ALTER TABLE public.crm_ai_agents ALTER COLUMN modelo SET DEFAULT 'claude-sonnet-5-5';
UPDATE public.crm_ai_agents
   SET modelo = 'claude-sonnet-5-5'
 WHERE modelo IS NULL
    OR modelo NOT IN ('claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5');

-- 2) Pareamento da chave da Anthropic (VPS -> CRM) --------------------------------------------
CREATE OR REPLACE FUNCTION public.anthropic_pareamento_aceita()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'anthropic_api_key')
      OR EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'anthropic_pareamento_rearmado');
$$;

CREATE OR REPLACE FUNCTION public.anthropic_pareamento_gravar(p_valor text, p_nonce text, p_ip text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n int;
  v_agora text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
BEGIN
  IF p_valor IS NULL OR length(p_valor) < 20 OR p_nonce IS NULL OR p_nonce !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RAISE EXCEPTION 'parâmetros inválidos';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('anthropic_pareamento'));
  DELETE FROM public.live_pareamento_nonces WHERE criado_em < now() - interval '1 day';
  INSERT INTO public.live_pareamento_nonces (nonce) VALUES (p_nonce) ON CONFLICT (nonce) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN 'replay';
  END IF;
  IF EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'anthropic_api_key')
     AND NOT EXISTS (SELECT 1 FROM public.integracao_config WHERE chave = 'anthropic_pareamento_rearmado') THEN
    RETURN 'ja_pareado';
  END IF;
  INSERT INTO public.integracao_config (chave, valor) VALUES ('anthropic_api_key', p_valor)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  DELETE FROM public.integracao_config WHERE chave = 'anthropic_pareamento_rearmado';
  INSERT INTO public.integracao_config (chave, valor) VALUES ('anthropic_pareado_em', v_agora)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  INSERT INTO public.integracao_config (chave, valor) VALUES ('anthropic_pareado_ip', left(coalesce(p_ip, '?'), 64))
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.anthropic_pareamento_reabrir()
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
  VALUES ('anthropic_pareamento_rearmado', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
  RETURN 'pareamento da Anthropic rearmado: a VPS pode gravar uma vez (sudo headturbo-anthropic-parear --executar)';
END;
$$;

REVOKE ALL ON FUNCTION public.anthropic_pareamento_aceita() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.anthropic_pareamento_gravar(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.anthropic_pareamento_reabrir() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anthropic_pareamento_aceita() TO service_role;
GRANT EXECUTE ON FUNCTION public.anthropic_pareamento_gravar(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.anthropic_pareamento_reabrir() TO authenticated, service_role;

COMMIT;

-- =============================================================
-- DEPOIS DE RODAR: publicar anthropic-pareamento, ai-agent-simular e feedback-semanal-resumo;
-- na VPS: sudo headturbo-anthropic-parear (seco) e --executar. Passo a passo em infra/anthropic/README.md.
-- =============================================================
