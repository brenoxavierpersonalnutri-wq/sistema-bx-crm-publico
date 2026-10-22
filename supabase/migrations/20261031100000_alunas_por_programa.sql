-- =============================================================
-- CRM > Banco de dados (/crm/banco) e gatilho "Segmento / base de dados" dos fluxos:
-- ALUNAS ATIVAS SEPARADAS POR PROGRAMA (MGMD, ELITE, PLATAFORMA) + "Alunas ativas — Todas".
--
-- Fonte: Gestão de Alunas (public.alunas, coluna programa). Valores gravados pelo app
-- (src/lib/alunaTypes.ts, ProgramType) e como cada um cai num dos 3 programas vendidos:
--   menos_gordura     -> mgmd        (rótulo "MGMD" no app; import "mgmd"/"menos gordura"/"desafio")
--   elite             -> elite       (rótulo "Elite")
--   plataforma_magra  -> plataforma  (rótulo "Plataforma Magra e Definida"; card "Magra na Plataforma")
--   consultoria_slim  -> (nenhum)    rótulo "Consultoria Slim"; é o DEFAULT da coluna. Fica só em "Todas".
--   slim_definida     -> (nenhum)    rótulo "Slim Definida". Fica só em "Todas".
-- O de-para mora na tabela public.crm_alunas_programa_mapa: se o Breno decidir que slim_definida (ou
-- consultoria_slim) é MGMD, basta um INSERT nela, sem migration nova:
--   INSERT INTO public.crm_alunas_programa_mapa (programa, segmento) VALUES ('slim_definida', 'mgmd')
--     ON CONFLICT (programa) DO UPDATE SET segmento = EXCLUDED.segmento;
--
-- Regra de ATIVA (igual à 20261029110000): linha de alunas com is_teste = false e
-- data_vencimento >= hoje (America/Sao_Paulo). Status não entra.
-- NOVO: uma linha por PESSOA nas ativas (antes era uma por cadastro). Mesma pessoa = mesmo telefone E.164;
-- sem telefone, mesmo nome normalizado (o mesmo critério do recorte "ex"). Fica o cadastro com o vencimento
-- mais distante. No recorte por programa, o filtro de programa vem ANTES da dedup: quem tem MGMD e ELITE
-- vigentes aparece nos dois segmentos e uma vez só em "Todas".
--
-- O QUE FAZ (idempotente; NÃO apaga dado; NÃO envia mensagem):
--   1. public.crm_alunas_programa_mapa (de-para) + public.crm_alunas_programa_segmento(programa).
--   2. public.crm_alunas_recorte(situacao, programa) — nova sobrecarga; a de 1 argumento passa a chamá-la.
--   3. public.crm_segmento_listar lê filtro.programa ('mgmd'|'elite'|'plataforma') junto de alunas='ativas'.
--   4. public.crm_alunas_telefones(situacao, programa): telefones (dígitos) para o motor dos fluxos
--      (edge function crm-automacoes, service_role). authenticated/anon não executam.
--   5. Segmentos: 'alunas-ativas' vira "Alunas ativas — Todas"; novos 'alunas-ativas-mgmd',
--      'alunas-ativas-elite', 'alunas-ativas-plataforma'.
--
-- Depende de: 20261029110000_banco_segmentos_rapido.sql (aplicar antes). Rodar inteiro no SQL editor.
-- =============================================================
BEGIN;

-- 1. De-para programa -> segmento -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_alunas_programa_mapa (
  programa      text PRIMARY KEY CHECK (programa = lower(btrim(programa)) AND programa <> ''),
  segmento      text NOT NULL CHECK (segmento IN ('mgmd', 'elite', 'plataforma')),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_alunas_programa_mapa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_alunas_programa_mapa FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.crm_alunas_programa_mapa TO service_role;

INSERT INTO public.crm_alunas_programa_mapa (programa, segmento) VALUES
  ('menos_gordura', 'mgmd'),
  ('elite', 'elite'),
  ('plataforma_magra', 'plataforma')
ON CONFLICT (programa) DO NOTHING;

CREATE OR REPLACE FUNCTION public.crm_alunas_programa_segmento(p_programa text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.segmento FROM public.crm_alunas_programa_mapa m WHERE m.programa = lower(btrim(coalesce(p_programa, '')))
$$;
REVOKE ALL ON FUNCTION public.crm_alunas_programa_segmento(text) FROM PUBLIC, anon, authenticated;

-- 2. Recorte com programa -------------------------------------------------------------------------
-- p_programa: NULL = todos os programas; 'mgmd' | 'elite' | 'plataforma' = só quem cai nele pelo de-para.
CREATE OR REPLACE FUNCTION public.crm_alunas_recorte(p_situacao text, p_programa text)
RETURNS TABLE (chave text, telefone_e164 text, nome text, programa text, vencimento date,
               desde timestamptz, ultima timestamptz, fontes text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH al AS (
    SELECT a.id, nullif(btrim(a.nome_completo), '') AS nome, public.base_leads_tel_e164(a.telefone) AS tel,
           public.crm_nome_chave(a.nome_completo) AS nk, a.programa, a.data_vencimento AS venc,
           coalesce(a.data_compra::timestamptz, a.created_at) AS compra,
           a.data_vencimento >= public.crm_hoje_brt() AS vigente
    FROM public.alunas a
    WHERE coalesce(a.is_teste, false) = false
  ),
  -- ATIVAS: filtra o programa, depois uma linha por pessoa (telefone; sem telefone, nome)
  at_prog AS (
    SELECT al.* FROM al
    WHERE p_situacao = 'ativas' AND al.vigente
      AND (p_programa IS NULL OR public.crm_alunas_programa_segmento(al.programa) = p_programa)
  ),
  at_tel_nome AS (SELECT nk, min(tel) AS tel FROM at_prog WHERE tel IS NOT NULL AND nk IS NOT NULL GROUP BY nk),
  at_k AS (
    SELECT p.*, coalesce(p.tel, tn.tel, 'nome:' || p.nk, 'id:' || p.id::text) AS k
    FROM at_prog p LEFT JOIN at_tel_nome tn ON tn.nk = p.nk AND p.tel IS NULL
  ),
  at_rank AS (
    SELECT k.*,
           row_number() OVER (PARTITION BY k.k ORDER BY k.venc DESC, k.compra DESC NULLS LAST, k.id) AS rn,
           min(k.compra) OVER (PARTITION BY k.k) AS desde_k,
           max(k.compra) OVER (PARTITION BY k.k) AS ultima_k,
           max(k.tel)    OVER (PARTITION BY k.k) AS tel_k
    FROM at_k k
  ),
  -- EX: igual à 20261029110000
  at_tel  AS (SELECT DISTINCT tel FROM al WHERE vigente AND tel IS NOT NULL),
  at_nome AS (SELECT DISTINCT nk  FROM al WHERE vigente AND nk  IS NOT NULL),
  cand AS (
    SELECT tel, nk, nome, programa, venc, compra AS data, 'gestao-alunas' AS fonte FROM al
    WHERE NOT vigente AND p_situacao = 'ex'
    UNION ALL
    SELECT public.base_leads_tel_e164(c.client_phone), public.crm_nome_chave(c.client_name),
           nullif(btrim(c.client_name), ''), nullif(btrim(c.program_value), ''), NULL::date,
           coalesce(c.converted_at, c.date::timestamptz), 'consulta-fechou'
    FROM public.consultations c
    WHERE p_situacao = 'ex' AND c.converted IS TRUE AND c.refunded IS NOT TRUE
      AND coalesce(c.client_name, '') NOT ILIKE 'teste – treinamento%'
  ),
  fora_ativas AS (
    SELECT c.* FROM cand c
    WHERE coalesce(c.tel, c.nk) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM at_tel t WHERE t.tel = c.tel)
      AND NOT EXISTS (SELECT 1 FROM at_nome n WHERE n.nk = c.nk)
  ),
  tel_por_nome AS (SELECT nk, min(tel) AS tel FROM fora_ativas WHERE tel IS NOT NULL AND nk IS NOT NULL GROUP BY nk),
  chaveadas AS (
    SELECT f.*, coalesce(f.tel, tn.tel, 'nome:' || f.nk) AS k
    FROM fora_ativas f LEFT JOIN tel_por_nome tn ON tn.nk = f.nk AND f.tel IS NULL
  ),
  ex AS (
    SELECT k,
           CASE WHEN k LIKE '+%' THEN k END AS tel,
           (array_agg(nome ORDER BY data DESC NULLS LAST) FILTER (WHERE nome IS NOT NULL))[1] AS nome,
           (array_agg(programa ORDER BY (fonte = 'gestao-alunas') DESC, data DESC NULLS LAST) FILTER (WHERE programa IS NOT NULL))[1] AS programa,
           max(venc) AS venc, min(data) AS desde, max(data) AS ultima,
           array_agg(DISTINCT fonte ORDER BY fonte) AS fontes
    FROM chaveadas GROUP BY k
  )
  SELECT r.id::text, r.tel_k, r.nome, r.programa, r.venc, r.desde_k, r.ultima_k, ARRAY['gestao-alunas']
  FROM at_rank r WHERE r.rn = 1
  UNION ALL
  SELECT e.k, e.tel, e.nome, e.programa, e.venc, e.desde, e.ultima, e.fontes
  FROM ex e
  WHERE p_situacao = 'ex'
    AND (p_programa IS NULL OR public.crm_alunas_programa_segmento(e.programa) = p_programa)
$$;
REVOKE ALL ON FUNCTION public.crm_alunas_recorte(text, text) FROM PUBLIC, anon, authenticated;

-- A de 1 argumento (usada pela 20261029110000) passa a ser a de 2 com programa NULL.
CREATE OR REPLACE FUNCTION public.crm_alunas_recorte(p_situacao text)
RETURNS TABLE (chave text, telefone_e164 text, nome text, programa text, vencimento date,
               desde timestamptz, ultima timestamptz, fontes text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.crm_alunas_recorte(p_situacao, NULL::text)
$$;
REVOKE ALL ON FUNCTION public.crm_alunas_recorte(text) FROM PUBLIC, anon, authenticated;

-- 3. Lista/contagem da tela lendo filtro.programa -------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_segmento_listar(p_slug text, p_filtros jsonb DEFAULT '{}'::jsonb,
                                                      p_pagina integer DEFAULT 0, p_por_pagina integer DEFAULT 50)
RETURNS TABLE (chave text, telefone_e164 text, email text, nome text, primeira_entrada timestamptz,
               ultima_entrada timestamptz, origens text[], tags text[], nivel text, comprador boolean,
               programa text, vencimento date, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  f        jsonb;
  t        jsonb := CASE WHEN jsonb_typeof(p_filtros) = 'object' THEN p_filtros ELSE '{}'::jsonb END;
  v_lim    integer := least(greatest(coalesce(p_por_pagina, 50), 1), 1000);
  v_off    integer := greatest(coalesce(p_pagina, 0), 0) * least(greatest(coalesce(p_por_pagina, 50), 1), 1000);
  v_origens text[]; v_niveis text[]; v_tags text[]; v_comprador boolean; v_alunas text; v_programa text;
  v_busca  text; v_dig text; v_de date; v_ate date; v_com_tel boolean; v_tag text;
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
    -- programa inválido não pode virar "todos" em silêncio
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

  IF v_alunas IS NOT NULL THEN
    RETURN QUERY
    SELECT r.chave, r.telefone_e164, NULL::text, r.nome, r.desde, r.ultima, r.fontes, '{}'::text[], NULL::text,
           true, r.programa, r.vencimento, count(*) OVER ()
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
         m.nivel, m.comprador, NULL::text, NULL::date, count(*) OVER ()
  FROM public.base_leads_unificada_mat m
  WHERE (cardinality(v_origens) = 0 OR m.origens && v_origens)
    AND (cardinality(v_niveis)  = 0 OR m.nivel = ANY (v_niveis))
    AND (cardinality(v_tags)    = 0 OR m.tags && v_tags)
    AND (v_comprador IS NULL OR m.comprador = v_comprador)
    AND (NOT v_com_tel OR m.telefone_e164 IS NOT NULL)
    AND (v_tag IS NULL OR m.tags && ARRAY[v_tag])
    AND (v_de  IS NULL OR m.ultima_entrada >= (v_de::timestamp AT TIME ZONE 'America/Sao_Paulo'))
    AND (v_ate IS NULL OR m.ultima_entrada <  ((v_ate + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
    AND (v_busca = '' OR m.nome ILIKE '%' || v_busca || '%' OR m.email ILIKE '%' || v_busca || '%'
         OR (length(v_dig) >= 4 AND m.telefone_e164 LIKE '%' || v_dig || '%'))
  ORDER BY m.ultima_entrada DESC NULLS LAST, m.chave
  LIMIT v_lim OFFSET v_off;
END $$;
REVOKE ALL ON FUNCTION public.crm_segmento_listar(text, jsonb, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_segmento_listar(text, jsonb, integer, integer) TO authenticated;
-- crm_segmento_contar(slug) não muda: conta pela crm_segmento_listar.

-- 4. Telefones para o motor dos fluxos (crm-automacoes roda como service_role) -----------------------
CREATE OR REPLACE FUNCTION public.crm_alunas_telefones(p_situacao text, p_programa text DEFAULT NULL)
RETURNS TABLE (telefone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  -- Só o motor (service_role, sem usuário) ou quem pode ver o Banco de dados. anon/authenticated nem têm EXECUTE.
  IF auth.uid() IS NOT NULL AND NOT public.crm_banco_pode() THEN
    RAISE EXCEPTION 'sem permissão para o Banco de dados do CRM' USING ERRCODE = '42501';
  END IF;
  IF p_situacao IS NULL OR p_situacao NOT IN ('ativas', 'ex') THEN
    RAISE EXCEPTION 'situação "%" inválida (ativas ou ex)', p_situacao USING ERRCODE = '22023';
  END IF;
  IF p_programa IS NOT NULL AND p_programa NOT IN ('mgmd', 'elite', 'plataforma') THEN
    RAISE EXCEPTION 'programa "%" inválido (mgmd, elite ou plataforma)', p_programa USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT DISTINCT regexp_replace(r.telefone_e164, '[^0-9]', '', 'g')
  FROM public.crm_alunas_recorte(p_situacao, p_programa) r
  WHERE r.telefone_e164 IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.crm_alunas_telefones(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_alunas_telefones(text, text) TO service_role;

-- 5. Segmentos ------------------------------------------------------------------------------------
UPDATE public.crm_segmentos SET nome = 'Alunas ativas — Todas',
  descricao = 'Gestão de Alunas (sem as de teste) com vencimento do plano hoje ou depois (horário de Brasília), todos os programas. Uma linha por pessoa (telefone).'
WHERE slug = 'alunas-ativas' AND nome IN ('Alunas ativas', 'Alunas ativas — Todas');

INSERT INTO public.crm_segmentos (slug, nome, descricao, filtro, gatilhos, ordem) VALUES
('alunas-ativas-mgmd', 'MGMD', 'Alunas ativas do programa MGMD (Gestão de Alunas, programa menos_gordura).',
  '{"alunas":"ativas","programa":"mgmd"}', '[]', 61),
('alunas-ativas-elite', 'ELITE', 'Alunas ativas do programa ELITE (Gestão de Alunas, programa elite).',
  '{"alunas":"ativas","programa":"elite"}', '[]', 62),
('alunas-ativas-plataforma', 'PLATAFORMA', 'Alunas ativas da PLATAFORMA (Gestão de Alunas, programa plataforma_magra).',
  '{"alunas":"ativas","programa":"plataforma"}', '[]', 63)
ON CONFLICT (slug) DO UPDATE SET filtro = EXCLUDED.filtro;

COMMIT;
