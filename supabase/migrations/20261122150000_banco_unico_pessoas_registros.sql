-- =============================================================
-- CRM > Banco de dados com 3 abas (Pessoas · Registros · Importar CSV). "Base de leads" sai do menu.
-- Rodar inteiro no SQL editor do Lovable Cloud, DEPOIS da 20261122140000. Idempotente. NÃO apaga dado de lead.
-- NÃO envia mensagem. A tela nova funciona sem esta migration (só sem Produto e sem o resumo por origem).
--
--   1. public.base_leads_unificada ganha a coluna produto (o mais recente da pessoa), no fim da visão.
--   2. public.base_leads_unificada_mat é refeita com a coluna nova (DROP + CREATE: a cópia não tem dado próprio,
--      é sempre recalculada da visão) + índice em produto.
--   3. public.crm_segmento_listar devolve produto e aceita p_filtros.produto (exato) e p_filtros.tagVariantes
--      (grafias da tag escolhida, a mesma troca que a 20261030100000 fazia por remendo e a 20261031100000 perdeu).
--   4. public.base_leads_resumo_origens(): linhas, último import e última entrada por origem (aba Registros e
--      aba Importar). public.base_leads_produtos(): produtos com contagem (filtro de Produto).
--      Os dois são SECURITY INVOKER: a RLS de base_leads (com o (SELECT ...) da 20261112100000) vale igual.
-- =============================================================
BEGIN;
SET LOCAL statement_timeout = '10min';

-- 1. Visão unificada com produto -------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.base_leads_unificada
WITH (security_invoker = true) AS
WITH linhas AS (
  SELECT b.*, lower(b.email) AS email_n FROM public.base_leads b
),
fone_por_email AS (
  SELECT email_n, min(telefone_e164) AS tel
  FROM linhas WHERE email_n IS NOT NULL AND telefone_e164 IS NOT NULL
  GROUP BY email_n
),
chaveadas AS (
  SELECT l.*,
         coalesce(l.telefone_e164, f.tel, 'email:' || l.email_n) AS chave
  FROM linhas l LEFT JOIN fone_por_email f ON f.email_n = l.email_n AND l.telefone_e164 IS NULL
  WHERE coalesce(l.telefone_e164, l.email_n) IS NOT NULL
),
fones_cliente AS (
  SELECT DISTINCT public.base_leads_tel_e164(r.telefone) AS tel
  FROM public.lead_form_responses r
  WHERE public.base_leads_form_de_cliente(r) AND public.base_leads_tel_e164(r.telefone) IS NOT NULL
),
pessoas AS (
  SELECT
    chave,
    CASE WHEN chave LIKE '+%' THEN chave END                                   AS telefone_e164,
    (array_agg(email_n ORDER BY criado_origem NULLS LAST) FILTER (WHERE email_n IS NOT NULL))[1] AS email,
    (array_agg(nome ORDER BY criado_origem DESC NULLS LAST) FILTER (WHERE nome IS NOT NULL))[1]  AS nome,
    min(criado_origem)                                                          AS primeira_entrada,
    max(criado_origem)                                                          AS ultima_entrada,
    array_agg(DISTINCT origem ORDER BY origem)                                  AS origens,
    (array_agg(nivel ORDER BY CASE nivel WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3
                                         WHEN 'D' THEN 4 WHEN 'DQ' THEN 5 ELSE 6 END)
       FILTER (WHERE nivel IS NOT NULL))[1]                                      AS nivel,
    max(score)                                                                  AS score,
    bool_or(origem IN ('compra', 'aluna') OR (origem = 'pagtrust' AND status = 'comprador')
            OR tags && ARRAY['comprou', 'compra-realizada', 'comprador-pagtrust'])            AS comprador,
    bool_or(origem <> 'sellflux' OR tags && ARRAY['comprou', 'compra-realizada', 'abandonou-carrinho', 'aguardando-pagamento']) AS tem_fonte_breno,
    count(*)                                                                    AS registros,
    (array_agg(produto ORDER BY criado_origem DESC NULLS LAST) FILTER (WHERE nullif(btrim(produto), '') IS NOT NULL))[1] AS produto
  FROM chaveadas
  GROUP BY chave
),
tags_por_chave AS (
  SELECT chave, array_agg(DISTINCT t ORDER BY t) AS tags
  FROM chaveadas, unnest(tags) AS t
  GROUP BY chave
)
SELECT p.chave, p.telefone_e164, p.email, p.nome, p.primeira_entrada, p.ultima_entrada,
       p.origens, coalesce(tg.tags, '{}') AS tags, p.nivel, p.score, p.comprador, p.registros, p.produto
FROM pessoas p
LEFT JOIN tags_por_chave tg ON tg.chave = p.chave
WHERE NOT (p.telefone_e164 IN (SELECT tel FROM fones_cliente) AND NOT p.tem_fonte_breno);

REVOKE ALL ON public.base_leads_unificada FROM PUBLIC, anon;
GRANT SELECT ON public.base_leads_unificada TO authenticated;

-- 2. Cópia materializada com a coluna nova ---------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.base_leads_unificada_mat;
CREATE MATERIALIZED VIEW public.base_leads_unificada_mat AS
  SELECT * FROM public.base_leads_unificada
WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS base_leads_unificada_mat_chave_uidx ON public.base_leads_unificada_mat (chave);
CREATE INDEX IF NOT EXISTS base_leads_unificada_mat_tel_idx     ON public.base_leads_unificada_mat (telefone_e164);
CREATE INDEX IF NOT EXISTS base_leads_unificada_mat_origens_idx ON public.base_leads_unificada_mat USING gin (origens);
CREATE INDEX IF NOT EXISTS base_leads_unificada_mat_tags_idx    ON public.base_leads_unificada_mat USING gin (tags);
CREATE INDEX IF NOT EXISTS base_leads_unificada_mat_nivel_idx   ON public.base_leads_unificada_mat (nivel);
CREATE INDEX IF NOT EXISTS base_leads_unificada_mat_ultima_idx  ON public.base_leads_unificada_mat (ultima_entrada DESC NULLS LAST, chave);
CREATE INDEX IF NOT EXISTS base_leads_unificada_mat_produto_idx ON public.base_leads_unificada_mat (produto);
REVOKE ALL ON public.base_leads_unificada_mat FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.base_leads_unificada_mat TO service_role;
UPDATE public.base_leads_unificada_estado
   SET atualizado_em = now(), linhas = (SELECT count(*) FROM public.base_leads_unificada_mat)
 WHERE id = 1;

-- 3. Lista/contagem da aba Pessoas -----------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.crm_segmento_listar(text, jsonb, integer, integer);
CREATE FUNCTION public.crm_segmento_listar(p_slug text, p_filtros jsonb DEFAULT '{}'::jsonb,
                                           p_pagina integer DEFAULT 0, p_por_pagina integer DEFAULT 50)
RETURNS TABLE (chave text, telefone_e164 text, email text, nome text, primeira_entrada timestamptz,
               ultima_entrada timestamptz, origens text[], tags text[], nivel text, comprador boolean,
               programa text, vencimento date, produto text, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  f        jsonb;
  t        jsonb := CASE WHEN jsonb_typeof(p_filtros) = 'object' THEN p_filtros ELSE '{}'::jsonb END;
  v_lim    integer := least(greatest(coalesce(p_por_pagina, 50), 1), 1000);
  v_off    integer := greatest(coalesce(p_pagina, 0), 0) * least(greatest(coalesce(p_por_pagina, 50), 1), 1000);
  v_origens text[]; v_niveis text[]; v_tags text[]; v_comprador boolean; v_alunas text; v_programa text;
  v_busca  text; v_dig text; v_de date; v_ate date; v_com_tel boolean; v_tag text; v_tag_var text[]; v_produto text;
BEGIN
  IF NOT public.crm_banco_pode() THEN
    RAISE EXCEPTION 'sem permissão para o Banco de dados do CRM' USING ERRCODE = '42501';
  END IF;
  SELECT s.filtro INTO f FROM public.crm_segmentos s WHERE s.slug = p_slug AND s.ativo;
  IF f IS NULL THEN
    RAISE EXCEPTION 'segmento % não existe ou está desativado', p_slug USING ERRCODE = 'P0002';
  END IF;

  v_origens := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(f->'origens') = 'array' THEN f->'origens' ELSE '[]' END));
  v_niveis  := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(f->'niveis')  = 'array' THEN f->'niveis'  ELSE '[]' END));
  v_tags    := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(f->'tags')    = 'array' THEN f->'tags'    ELSE '[]' END));
  v_comprador := CASE WHEN jsonb_typeof(f->'comprador') = 'boolean' THEN (f->>'comprador')::boolean END;
  v_alunas  := CASE WHEN f->>'alunas' IN ('ativas', 'ex') THEN f->>'alunas' END;
  v_programa := nullif(btrim(coalesce(f->>'programa', '')), '');
  IF v_programa IS NOT NULL AND (v_alunas IS NULL OR v_programa NOT IN ('mgmd', 'elite', 'plataforma')) THEN
    RAISE EXCEPTION 'segmento %: programa "%" inválido (use mgmd, elite ou plataforma, junto de alunas)', p_slug, v_programa
      USING ERRCODE = '22023';
  END IF;

  -- Filtros da tela (mesmo contrato de FiltrosTela em segmentoFiltro.ts)
  v_busca := left(btrim(regexp_replace(coalesce(t->>'busca', ''), '[,()"''*%\\_]', ' ', 'g')), 60);
  v_dig   := regexp_replace(v_busca, '[^0-9]', '', 'g');
  v_de    := CASE WHEN coalesce(t->>'de', '')  ~ '^\d{4}-\d{2}-\d{2}$' THEN (t->>'de')::date END;
  v_ate   := CASE WHEN coalesce(t->>'ate', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (t->>'ate')::date END;
  v_com_tel := coalesce(jsonb_typeof(t->'comTelefone') = 'boolean' AND (t->>'comTelefone')::boolean, false);
  v_tag   := nullif(btrim(coalesce(t->>'tag', '')), '');
  v_tag_var := ARRAY[v_tag] || ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(t->'tagVariantes') = 'array' THEN t->'tagVariantes' ELSE '[]' END));
  v_produto := nullif(btrim(coalesce(t->>'produto', '')), '');

  IF v_alunas IS NOT NULL THEN
    RETURN QUERY
    SELECT r.chave, r.telefone_e164, NULL::text, r.nome, r.desde, r.ultima, r.fontes, '{}'::text[], NULL::text,
           true, r.programa, r.vencimento, NULL::text, count(*) OVER ()
    FROM public.crm_alunas_recorte(v_alunas, v_programa) r
    WHERE (NOT v_com_tel OR r.telefone_e164 IS NOT NULL)
      AND (v_busca = '' OR r.nome ILIKE '%' || v_busca || '%'
           OR (length(v_dig) >= 4 AND r.telefone_e164 LIKE '%' || v_dig || '%'))
    ORDER BY CASE WHEN v_alunas = 'ativas' THEN r.vencimento END ASC NULLS LAST,
             CASE WHEN v_alunas = 'ex' THEN coalesce(r.vencimento::timestamptz, r.ultima) END DESC NULLS LAST,
             r.chave
    LIMIT v_lim OFFSET v_off;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.chave, m.telefone_e164, m.email, m.nome, m.primeira_entrada, m.ultima_entrada, m.origens, m.tags,
         m.nivel, m.comprador, NULL::text, NULL::date, m.produto, count(*) OVER ()
  FROM public.base_leads_unificada_mat m
  WHERE (cardinality(v_origens) = 0 OR m.origens && v_origens)
    AND (cardinality(v_niveis)  = 0 OR m.nivel = ANY (v_niveis))
    AND (cardinality(v_tags)    = 0 OR m.tags && v_tags)
    AND (v_comprador IS NULL OR m.comprador = v_comprador)
    AND (NOT v_com_tel OR m.telefone_e164 IS NOT NULL)
    AND (v_tag IS NULL OR m.tags && v_tag_var)
    AND (v_produto IS NULL OR m.produto = v_produto)
    AND (v_de  IS NULL OR m.ultima_entrada >= (v_de::timestamp AT TIME ZONE 'America/Sao_Paulo'))
    AND (v_ate IS NULL OR m.ultima_entrada <  ((v_ate + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
    AND (v_busca = '' OR m.nome ILIKE '%' || v_busca || '%' OR m.email ILIKE '%' || v_busca || '%'
         OR (length(v_dig) >= 4 AND m.telefone_e164 LIKE '%' || v_dig || '%'))
  ORDER BY m.ultima_entrada DESC NULLS LAST, m.chave
  LIMIT v_lim OFFSET v_off;
END $$;
REVOKE ALL ON FUNCTION public.crm_segmento_listar(text, jsonb, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_segmento_listar(text, jsonb, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_segmento_contar(p_slug text)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT l.total FROM public.crm_segmento_listar(p_slug, '{}'::jsonb, 0, 1) l LIMIT 1), 0)
$$;
REVOKE ALL ON FUNCTION public.crm_segmento_contar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_segmento_contar(text) TO authenticated;

-- 4. Resumo por origem e lista de produtos (abas Registros e Importar) -------------------------------------
CREATE OR REPLACE FUNCTION public.base_leads_resumo_origens()
RETURNS TABLE (origem text, linhas bigint, ultimo_importado timestamptz, ultima_entrada timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT b.origem, count(*), max(b.importado_em), max(b.criado_origem)
  FROM public.base_leads b
  GROUP BY b.origem
  ORDER BY count(*) DESC
$$;
REVOKE ALL ON FUNCTION public.base_leads_resumo_origens() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.base_leads_resumo_origens() TO authenticated;

CREATE OR REPLACE FUNCTION public.base_leads_produtos()
RETURNS TABLE (produto text, linhas bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT b.produto, count(*)
  FROM public.base_leads b
  WHERE nullif(btrim(b.produto), '') IS NOT NULL
  GROUP BY b.produto
  ORDER BY count(*) DESC, b.produto
  LIMIT 500
$$;
REVOKE ALL ON FUNCTION public.base_leads_produtos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.base_leads_produtos() TO authenticated;

-- Filtro por origem na aba Registros
CREATE INDEX IF NOT EXISTS base_leads_origem_criado_idx ON public.base_leads (origem, criado_origem DESC, id DESC);

COMMIT;

-- Conferir:
--   SELECT count(*), count(produto) FROM public.base_leads_unificada_mat;
--   SELECT * FROM public.base_leads_resumo_origens();
