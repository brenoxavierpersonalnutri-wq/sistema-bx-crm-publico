CREATE TABLE public.gateway_api_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  nome TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  ultimo_uso TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

ALTER TABLE public.gateway_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manage api keys" ON public.gateway_api_keys
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_gateway_api_keys_user ON public.gateway_api_keys(user_id);
CREATE INDEX idx_gateway_api_keys_hash ON public.gateway_api_keys(key_hash);