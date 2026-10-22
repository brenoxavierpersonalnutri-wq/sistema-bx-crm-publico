-- Disparo em grupo — painel estilo SendFlow (21/10/2026).
-- 1) grupos_campanhas.projeto: pasta/cliente da campanha (filtro do painel).
-- 2) grupos_metricas_periodo(p_desde): cliques, entradas e saídas por campanha desde uma data (KPIs do período).
-- 3) grupos_serie_diaria(p_campanha, p_desde): mesma coisa dia a dia (gráficos da campanha; p_campanha nulo = todas).
-- Só leitura, SECURITY INVOKER: valem as políticas de RLS que já existem (is_approved). Idempotente.

ALTER TABLE public.grupos_campanhas ADD COLUMN IF NOT EXISTS projeto text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grupos_campanhas_projeto_ok') THEN
    ALTER TABLE public.grupos_campanhas
      ADD CONSTRAINT grupos_campanhas_projeto_ok CHECK (projeto IS NULL OR char_length(projeto) BETWEEN 1 AND 80);
  END IF;
END $$;

-- eventos de membros por campanha e data (o índice antigo é por grupo)
CREATE INDEX IF NOT EXISTS grupos_membros_eventos_campanha_idx ON public.grupos_membros_eventos (campanha_id, created_at);

CREATE OR REPLACE FUNCTION public.grupos_metricas_periodo(p_desde timestamptz)
RETURNS TABLE (campanha_id uuid, cliques bigint, cliques_grupo bigint, entradas bigint, saidas bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH c AS (
    SELECT gc.campanha_id, count(*) AS cliques, count(*) FILTER (WHERE gc.resultado = 'grupo') AS cliques_grupo
      FROM public.grupos_cliques gc
     WHERE gc.created_at >= p_desde
     GROUP BY gc.campanha_id
  ), e AS (
    SELECT me.campanha_id,
           coalesce(sum(me.quantidade) FILTER (WHERE me.tipo = 'entrada'), 0) AS entradas,
           coalesce(sum(me.quantidade) FILTER (WHERE me.tipo = 'saida'), 0)   AS saidas
      FROM public.grupos_membros_eventos me
     WHERE me.created_at >= p_desde
     GROUP BY me.campanha_id
  )
  SELECT coalesce(c.campanha_id, e.campanha_id),
         coalesce(c.cliques, 0)::bigint, coalesce(c.cliques_grupo, 0)::bigint,
         coalesce(e.entradas, 0)::bigint, coalesce(e.saidas, 0)::bigint
    FROM c FULL OUTER JOIN e ON e.campanha_id = c.campanha_id;
$$;

CREATE OR REPLACE FUNCTION public.grupos_serie_diaria(p_campanha uuid, p_desde timestamptz)
RETURNS TABLE (dia date, cliques bigint, entradas bigint, saidas bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH c AS (
    SELECT (gc.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia, count(*) AS cliques
      FROM public.grupos_cliques gc
     WHERE gc.created_at >= p_desde AND (p_campanha IS NULL OR gc.campanha_id = p_campanha)
     GROUP BY 1
  ), e AS (
    SELECT (me.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
           coalesce(sum(me.quantidade) FILTER (WHERE me.tipo = 'entrada'), 0) AS entradas,
           coalesce(sum(me.quantidade) FILTER (WHERE me.tipo = 'saida'), 0)   AS saidas
      FROM public.grupos_membros_eventos me
     WHERE me.created_at >= p_desde AND (p_campanha IS NULL OR me.campanha_id = p_campanha)
     GROUP BY 1
  )
  SELECT coalesce(c.dia, e.dia), coalesce(c.cliques, 0)::bigint,
         coalesce(e.entradas, 0)::bigint, coalesce(e.saidas, 0)::bigint
    FROM c FULL OUTER JOIN e ON e.dia = c.dia
   ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.grupos_metricas_periodo(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grupos_serie_diaria(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grupos_metricas_periodo(timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grupos_serie_diaria(uuid, timestamptz) TO authenticated, service_role;
