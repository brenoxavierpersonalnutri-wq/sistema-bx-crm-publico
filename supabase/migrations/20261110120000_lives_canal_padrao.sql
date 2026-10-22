-- =============================================================
-- LIVES: mais de um canal do YouTube + canal PADRÃO (21/10/2026).
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente.
--
-- yt_contas.padrao: o canal que o destino automático usa (criar live, abrir o estúdio, reprise e semana sem canal
-- escolhido). No máximo um padrão (índice único parcial). Sem padrão marcado, vale o primeiro conectado.
-- Quem marca é a edge youtube-oauth (ação definir-padrao); a tela só lê.
-- live_reprise_series.config ganha yt_conta_id (jsonb, sem migração) e live_semanas.yt_conta_id já existe.
-- =============================================================

ALTER TABLE public.yt_contas ADD COLUMN IF NOT EXISTS padrao boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS yt_contas_um_padrao_uidx ON public.yt_contas (padrao) WHERE padrao;
GRANT SELECT (padrao) ON public.yt_contas TO authenticated;

-- Conferir: SELECT titulo, status, padrao FROM public.yt_contas ORDER BY criado_em;
