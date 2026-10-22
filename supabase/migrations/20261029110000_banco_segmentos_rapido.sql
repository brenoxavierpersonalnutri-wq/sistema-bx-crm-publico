-- =============================================================
-- CRM > Banco de dados (/crm/banco): contagens e listas dos segmentos sem estourar o tempo.
--
-- PROBLEMA (18/10/2026): a tela lia direto a visão public.base_leads_unificada, que deduplica em tempo real
-- ~42 mil linhas de base_leads + respostas de formulário. Contagem saía "—" e "Avaliação qualificados" dava
-- "canceling statement due to statement timeout" (teto de 8 s do papel authenticated).
--
-- O QUE ESTA MIGRATION FAZ (idempotente; NÃO apaga dado; NÃO envia mensagem):
--   1. public.base_leads_unificada_mat: cópia materializada da visão, com índice único em chave (permite
--      REFRESH CONCURRENTLY, a tela continua lendo durante a atualização) e índices em telefone, origens,
--      tags, nível e última entrada.
--   2. public.base_leads_unificada_atualizar(): refaz a cópia e anota a hora em base_leads_unificada_estado.
--      pg_cron 'base-leads-unificada-mat' roda a cada 10 min.
--   3. Alunas ativas / Ex-alunas saem do SISTEMA DO FITNESS (Gestão de Alunas + Monitoramento das Consultas),
--      não da base de leads — public.crm_alunas_recorte('ativas'|'ex'). Regra exata:
--        ATIVA    = linha da tabela alunas (Gestão de Alunas), fora as de teste (is_teste), com
--                   data_vencimento >= hoje no horário de Brasília. O status (ativa/inativa) NÃO entra:
--                   é a mesma regra da aba "Ativos" do painel da Gestão de Alunas
--                   (src/components/alunas/AlunaDashboard.tsx, dataVencimento >= agora).
--        EX-ALUNA = pessoa que já teve cadastro real na Gestão de Alunas OU tem consulta com converted = true
--                   ("convertido"/fechou) e sem reembolso no Monitoramento das Consultas (consultations),
--                   e que hoje NÃO é ativa. Mesma pessoa = mesmo telefone (E.164) ou mesmo nome normalizado
--                   (nome é a chave de negócio que o Monitoramento usa para criar/achar a aluna,
--                   src/hooks/useConsultations.ts). Uma linha por pessoa.
--   4. RPCs para a tela (SECURITY DEFINER, só aprovado com admin ou módulo "crm-banco"):
--        crm_segmento_contar(slug)                              -> bigint
--        crm_segmento_listar(slug, filtros jsonb, pagina, por_pagina) -> linhas + total
--        crm_banco_atualizado_em()                             -> quando a cópia foi refeita
--   5. Segmento "ex-alunas" passa a ter filtro {"alunas":"ex"} e as descrições trazem a regra.
--
-- Rodar inteiro no SQL editor (como postgres). A 1ª carga da cópia roda a visão pesada uma vez (segundos).
-- Depende de: 20261021100000_base_leads_unificada.sql e 20261026120000_crm_segmentos.sql.
-- Desligar a atualização automática: SELECT cron.unschedule('base-leads-unificada-mat');
-- =============================================================
BEGIN;
SET LOCAL statement_timeout = '10min';

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- 1. Cópia materializada --------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS public.base_leads_unificada_mat AS
  SELECT * FROM public.base_leads_unificada
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS base_leads_unificada_mat_chave_uidx ON public.base_leads_unificada_mat (chave);
CREATE INDEX IF NOT EXISTS base_leads_unificada_mat_tel_idx     ON public.base_leads_unificada_mat (telefone_e164);
CREATE INDEX IF NOT EXISTS base_leads_unificada_mat_origens_idx ON public.base_leads_unificada_mat USING gin (origens);
CREATE INDEX IF NOT EXISTS base_leads_unificada_mat_tags_idx    ON public.base_leads_unificada_mat USING gin (tags);
CREATE INDEX IF NOT EXISTS base_leads_unificada_mat_nivel_idx   ON public.base_leads_unificada_mat (nivel);
CREATE INDEX IF NOT EXISTS base_leads_unificada_mat_ultima_idx  ON public.base_leads_unificada_mat (ultima_entrada DESC NULLS LAST, chave);

-- Ninguém lê a cópia direto: a tela passa pelas RPCs (que conferem a permissão).
REVOKE ALL ON public.base_leads_unificada_mat FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.base_leads_unificada_mat TO service_role;

-- 2. Atualização ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.base_leads_unificada_estado (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  linhas        bigint
);
ALTER TABLE public.base_leads_unificada_estado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.base_leads_unificada_estado FROM PUBLIC, anon, authenticated;
INSERT INTO public.base_leads_unificada_estado (id, atualizado_em, linhas)
  VALUES (1, now(), (SELECT count(*) FROM public.base_leads_unificada_mat))
  ON CONFLICT (id) DO UPDATE SET atualizado_em = EXCLUDED.atualizado_em, linhas = EXCLUDED.linhas;

CREATE OR REPLACE FUNCTION public.base_leads_unificada_atualizar()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.base_leads_unificada_mat;
  UPDATE public.base_leads_unificada_estado
     SET atualizado_em = now(), linhas = (SELECT count(*) FROM public.base_leads_unificada_mat)
   WHERE id = 1;
END $$;
REVOKE ALL ON FUNCTION public.base_leads_unificada_atualizar() FROM PUBLIC, anon, authenticated;

-- Cada comando do texto tem o próprio relógio: o SET vale para o REFRESH que vem depois.
SELECT cron.schedule('base-leads-unificada-mat', '*/10 * * * *',
  $c$SET statement_timeout = '10min'; SELECT public.base_leads_unificada_atualizar();$c$);

-- 3. Alunas (sistema do fitness) -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_hoje_brt()
RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;

CREATE OR REPLACE FUNCTION public.crm_nome_chave(bruto text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(lower(regexp_replace(btrim(coalesce(bruto, '')), '\s+', ' ', 'g')), '')
$$;

-- Uma linha por aluna ativa (como o painel conta) ou por pessoa ex-aluna.
-- fontes: 'gestao-alunas' (tabela alunas) e/ou 'consulta-fechou' (consultations convertida, sem reembolso).
CREATE OR REPLACE FUNCTION public.crm_alunas_recorte(p_situacao text)
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
  at_tel  AS (SELECT DISTINCT tel FROM al WHERE vigente AND tel IS NOT NULL),
  at_nome AS (SELECT DISTINCT nk  FROM al WHERE vigente AND nk  IS NOT NULL),
  cand AS (
    SELECT tel, nk, nome, programa, venc, compra AS data, 'gestao-alunas' AS fonte FROM al WHERE NOT vigente
    UNION ALL
    SELECT public.base_leads_tel_e164(c.client_phone), public.crm_nome_chave(c.client_name),
           nullif(btrim(c.client_name), ''), nullif(btrim(c.program_value), ''), NULL::date,
           coalesce(c.converted_at, c.date::timestamptz), 'consulta-fechou'
    FROM public.consultations c
    WHERE c.converted IS TRUE AND c.refunded IS NOT TRUE
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
  )
  SELECT al.id::text, al.tel, al.nome, al.programa, al.venc, al.compra, al.compra, ARRAY['gestao-alunas']
  FROM al WHERE p_situacao = 'ativas' AND al.vigente
  UNION ALL
  SELECT k,
         CASE WHEN k LIKE '+%' THEN k END,
         (array_agg(nome ORDER BY data DESC NULLS LAST) FILTER (WHERE nome IS NOT NULL))[1],
         (array_agg(programa ORDER BY (fonte = 'gestao-alunas') DESC, data DESC NULLS LAST) FILTER (WHERE programa IS NOT NULL))[1],
         max(venc), min(data), max(data),
         array_agg(DISTINCT fonte ORDER BY fonte)
  FROM chaveadas WHERE p_situacao = 'ex'
  GROUP BY k
$$;
REVOKE ALL ON FUNCTION public.crm_alunas_recorte(text) FROM PUBLIC, anon, authenticated;

-- 4. RPCs da tela ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_banco_pode()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.is_approved(auth.uid())
     AND (public.has_role(auth.uid(), 'admin') OR public.has_module(auth.uid(), 'crm-banco'))
$$;
REVOKE ALL ON FUNCTION public.crm_banco_pode() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_banco_pode() TO authenticated;

DROP FUNCTION IF EXISTS public.crm_segmento_listar(text, jsonb, integer, integer);
CREATE FUNCTION public.crm_segmento_listar(p_slug text, p_filtros jsonb DEFAULT '{}'::jsonb,
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
  v_origens text[]; v_niveis text[]; v_tags text[]; v_comprador boolean; v_alunas text;
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
    FROM public.crm_alunas_recorte(v_alunas) r
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

CREATE OR REPLACE FUNCTION public.crm_segmento_contar(p_slug text)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT l.total FROM public.crm_segmento_listar(p_slug, '{}'::jsonb, 0, 1) l LIMIT 1), 0)
$$;
REVOKE ALL ON FUNCTION public.crm_segmento_contar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_segmento_contar(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_banco_atualizado_em()
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.crm_banco_pode() THEN
    RAISE EXCEPTION 'sem permissão para o Banco de dados do CRM' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT atualizado_em FROM public.base_leads_unificada_estado WHERE id = 1);
END $$;
REVOKE ALL ON FUNCTION public.crm_banco_atualizado_em() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_banco_atualizado_em() TO authenticated;

-- 5. Segmentos de alunas com a regra do sistema do fitness ---------------------------------------
UPDATE public.crm_segmentos SET filtro = '{"alunas":"ex"}'::jsonb,
  descricao = 'Já teve cadastro na Gestão de Alunas ou consulta convertida (fechou, sem reembolso) no Monitoramento das Consultas, e hoje não tem plano vigente.'
WHERE slug = 'ex-alunas';
UPDATE public.crm_segmentos SET filtro = '{"alunas":"ativas"}'::jsonb,
  descricao = 'Cadastro na Gestão de Alunas (sem as de teste) com vencimento do plano hoje ou depois (horário de Brasília). Mesma regra da aba Ativos do painel.'
WHERE slug = 'alunas-ativas';

COMMIT;
