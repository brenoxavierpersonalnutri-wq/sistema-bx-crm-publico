-- Lives: segredo LIVE_CHAVES_SEGREDO gerado NO BANCO, sem ninguém colar nada em painel, 18/10/2026.
--  * 'live_chaves_segredo': 64 hex aleatórios (gen_random_bytes). Cifra as chaves RTMP (v1), o refresh_token
--    do YouTube (y1) e assina o token do render. Só service role lê (integracao_config não tem grant para
--    anon/authenticated).
--  * Criado uma vez; rodar de novo NÃO troca (ON CONFLICT DO NOTHING). Trocar invalida o que já foi cifrado:
--    aí é recadastrar as chaves RTMP e reconectar o YouTube.
--  * As funções (live-token, live-control, youtube-oauth) leem daqui via _shared/liveSegredo.ts quando
--    não há LIVE_CHAVES_SEGREDO no env. O env, se existir com 32+ caracteres, continua tendo prioridade.
-- Idempotente. Depende de integracao_config (20261026100000 / 20261026120000), recriada aqui por garantia.

CREATE TABLE IF NOT EXISTS public.integracao_config (
  chave         text PRIMARY KEY,
  valor         text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.integracao_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integracao_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.integracao_config TO service_role;

INSERT INTO public.integracao_config (chave, valor)
VALUES ('live_chaves_segredo', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (chave) DO NOTHING;
