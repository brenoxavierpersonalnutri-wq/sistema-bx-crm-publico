-- =============================================================
-- Otimização automática do Teste A/B (multi-armed bandit, Thompson Sampling)
--
-- O sorteio do /r/<slug> acontece na edge function rotator-redirect, que
-- sorteia proporcional a rotator_destinations.weight. Esta migration NÃO mexe
-- na edge function: quando a otimização está ligada, o banco reescreve o
-- weight (escala 10000) e guarda o peso que o Breno digitou em peso_manual.
-- Desligou: weight volta a ser o peso_manual. Desligada (padrão), nada muda.
--
-- 1. Colunas novas em rotator_links (interruptor + parâmetros + último cálculo)
--    e em rotator_destinations (peso manual, peso da IA, prob. de ser a melhor,
--    status).
-- 2. Funções: rotator_otim_gamma / rotator_otim_pesos (puras) e
--    rotator_otimizar(rotador, forcar) que calcula e grava.
-- 3. Gatilhos: ligar/desligar ou mudar parâmetro recalcula na hora; variação
--    inserida com a otimização ligada guarda o peso digitado em peso_manual.
-- 4. pg_cron a cada 15 min: recalcula quem estiver ligado, no máximo 1x por
--    hora, ou antes se entraram otim_recalc_visitas visitas novas.
--
-- Referência em TypeScript (mesmas regras, com testes):
-- src/lib/rotatorOtimizacao.ts
-- Não apaga nem altera linha existente além do weight dos testes LIGADOS.
-- =============================================================

-- 1. Colunas ------------------------------------------------------------------
ALTER TABLE public.rotator_links
  ADD COLUMN IF NOT EXISTS otim_ativa boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS otim_min_visitas integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS otim_min_compras integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS otim_piso numeric NOT NULL DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS otim_teto numeric NOT NULL DEFAULT 0.80,
  ADD COLUMN IF NOT EXISTS otim_recalc_visitas integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS otim_recalculado_em timestamptz,
  ADD COLUMN IF NOT EXISTS otim_visitas_no_calculo bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otim_fase text;

DO $$ BEGIN
  ALTER TABLE public.rotator_links ADD CONSTRAINT rotator_links_otim_limites CHECK (
    otim_min_visitas >= 0 AND otim_min_compras >= 0
    AND otim_piso >= 0 AND otim_piso <= 0.5
    AND otim_teto >= 0.2 AND otim_teto <= 1
    AND otim_recalc_visitas >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.rotator_destinations
  ADD COLUMN IF NOT EXISTS peso_manual integer,
  ADD COLUMN IF NOT EXISTS otim_peso numeric,
  ADD COLUMN IF NOT EXISTS otim_prob_melhor numeric,
  ADD COLUMN IF NOT EXISTS otim_status text;

-- 2. Funções puras ------------------------------------------------------------
-- Gamma(shape,1), Marsaglia-Tsang; shape >= 1 sempre (compras+1, falhas+1).
CREATE OR REPLACE FUNCTION public.rotator_otim_gamma(shape double precision)
RETURNS double precision LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  d double precision := shape - 1.0/3.0;
  c double precision := 1.0 / sqrt(9.0 * (shape - 1.0/3.0));
  x double precision; v double precision; u double precision; u1 double precision;
BEGIN
  LOOP
    LOOP
      u1 := random();
      IF u1 > 1e-300 THEN
        x := sqrt(-2.0 * ln(u1)) * cos(2.0 * pi() * random());
        v := 1.0 + c * x;
        EXIT WHEN v > 0;
      END IF;
    END LOOP;
    v := v * v * v;
    u := random();
    IF u < 1.0 - 0.0331 * x^4 THEN RETURN d * v; END IF;
    IF u > 0 AND ln(u) < 0.5 * x * x + d * (1.0 - v + ln(v)) THEN RETURN d * v; END IF;
  END LOOP;
END $$;

-- w_i = clamp(λ·p_i, piso, teto), λ por bisseção para somar 1 (igual ao TS).
CREATE OR REPLACE FUNCTION public.rotator_otim_pesos(
  probs double precision[], piso double precision, teto double precision, sem_teto boolean)
RETURNS double precision[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  n integer := coalesce(array_length(probs, 1), 0);
  lo double precision; hi double precision;
  p double precision[]; w double precision[];
  positivos integer := 0; max_soma double precision; extra double precision;
  a double precision := 0; b double precision := 1; m double precision;
  s double precision; i integer; it integer;
BEGIN
  IF n = 0 THEN RETURN ARRAY[]::double precision[]; END IF;
  IF n = 1 THEN RETURN ARRAY[1.0]::double precision[]; END IF;
  lo := least(greatest(piso, 0), 1.0 / n);
  hi := CASE WHEN sem_teto THEN 1.0 ELSE greatest(least(teto, 1.0), 1.0 / n) END;
  p := probs;
  FOR i IN 1..n LOOP
    IF p[i] IS NULL OR p[i] <= 0 OR p[i] = 'NaN'::double precision THEN p[i] := 0; ELSE positivos := positivos + 1; END IF;
  END LOOP;
  max_soma := positivos * hi + (n - positivos) * lo;
  w := array_fill(0::double precision, ARRAY[n]);
  IF max_soma < 1 THEN
    extra := (1 - max_soma) / (n - positivos);
    FOR i IN 1..n LOOP w[i] := CASE WHEN p[i] > 0 THEN hi ELSE lo + extra END; END LOOP;
    RETURN w;
  END IF;
  LOOP
    s := 0; FOR i IN 1..n LOOP s := s + least(hi, greatest(lo, b * p[i])); END LOOP;
    EXIT WHEN s >= 1;
    b := b * 2;
  END LOOP;
  FOR it IN 1..200 LOOP
    m := (a + b) / 2;
    s := 0; FOR i IN 1..n LOOP s := s + least(hi, greatest(lo, m * p[i])); END LOOP;
    IF s < 1 THEN a := m; ELSE b := m; END IF;
  END LOOP;
  s := 0;
  FOR i IN 1..n LOOP w[i] := least(hi, greatest(lo, b * p[i])); s := s + w[i]; END LOOP;
  FOR i IN 1..n LOOP w[i] := w[i] / s; END LOOP;
  RETURN w;
END $$;

-- 3. Cálculo e gravação -------------------------------------------------------
-- Compras = cliques distintos com 'purchase' (regra pixel) ou com pageview
-- casando a regra de URL, igual a src/lib/rotatorResultados.ts.
CREATE OR REPLACE FUNCTION public.rotator_otimizar(p_rotator uuid, p_forcar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.rotator_links%ROWTYPE;
  regra text; agulha text;
  ids uuid[]; vis bigint[]; comp bigint[];
  n integer; i integer; s integer; j integer;
  total_vis bigint := 0; total_comp bigint := 0;
  vit integer[]; probs double precision[]; w double precision[];
  amostras integer := 2000; x double precision; melhor integer; maxx double precision;
  validando boolean := false; faltam_comp bigint; maxp double precision; campea boolean;
  fase text; st text;
BEGIN
  SELECT * INTO l FROM public.rotator_links WHERE id = p_rotator;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'rotador não encontrado'); END IF;

  -- Desligada: devolve o peso manual e limpa o que a IA gravou.
  IF NOT l.otim_ativa THEN
    UPDATE public.rotator_destinations
       SET weight = coalesce(peso_manual, weight), peso_manual = NULL,
           otim_peso = NULL, otim_prob_melhor = NULL, otim_status = NULL
     WHERE rotator_id = p_rotator AND (peso_manual IS NOT NULL OR otim_status IS NOT NULL);
    UPDATE public.rotator_links SET otim_fase = NULL, otim_recalculado_em = NULL, otim_visitas_no_calculo = 0
     WHERE id = p_rotator AND (otim_fase IS NOT NULL OR otim_recalculado_em IS NOT NULL);
    RETURN jsonb_build_object('ok', true, 'fase', 'desligada');
  END IF;

  UPDATE public.rotator_destinations SET peso_manual = weight
   WHERE rotator_id = p_rotator AND peso_manual IS NULL;

  regra := coalesce(l.conversion_rule->>'type', 'pixel');
  agulha := lower(btrim(coalesce(l.conversion_rule->>'value', '')));
  IF regra <> 'pixel' AND agulha = '' THEN regra := 'nenhuma'; END IF;

  SELECT array_agg(d.id ORDER BY d.created_at, d.id),
         array_agg(coalesce(v.n, 0) ORDER BY d.created_at, d.id),
         array_agg(least(coalesce(c.n, 0), coalesce(v.n, 0)) ORDER BY d.created_at, d.id)
    INTO ids, vis, comp
    FROM public.rotator_destinations d
    LEFT JOIN LATERAL (SELECT count(*) AS n FROM public.rotator_clicks k WHERE k.destination_id = d.id) v ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT e.click_id) AS n
        FROM public.rotator_clicks k JOIN public.rotator_events e ON e.click_id = k.click_id
       WHERE k.destination_id = d.id
         AND CASE regra
               WHEN 'pixel' THEN e.event_type = 'purchase'
               WHEN 'url_contains' THEN e.event_type = 'pageview' AND strpos(lower(coalesce(e.page_url, '')), agulha) > 0
               WHEN 'url_equals' THEN e.event_type = 'pageview'
                    AND lower(split_part(split_part(coalesce(e.page_url, ''), '#', 1), '?', 1)) = agulha
               ELSE false END
    ) c ON true
   WHERE d.rotator_id = p_rotator;

  n := coalesce(array_length(ids, 1), 0);
  IF n = 0 THEN
    UPDATE public.rotator_links SET otim_fase = 'sem_variacoes', otim_recalculado_em = now() WHERE id = p_rotator;
    RETURN jsonb_build_object('ok', true, 'fase', 'sem_variacoes');
  END IF;
  FOR i IN 1..n LOOP total_vis := total_vis + vis[i]; total_comp := total_comp + comp[i]; END LOOP;

  -- Cadência: no máximo 1x por hora, ou antes com otim_recalc_visitas visitas novas.
  IF NOT p_forcar AND l.otim_recalculado_em IS NOT NULL
     AND l.otim_recalculado_em > now() - interval '1 hour'
     AND total_vis - l.otim_visitas_no_calculo < l.otim_recalc_visitas THEN
    RETURN jsonb_build_object('ok', true, 'fase', l.otim_fase, 'pulou', true);
  END IF;

  -- Monte Carlo: P(ser a melhor) sobre Beta(compras+1, visitas-compras+1).
  vit := array_fill(0, ARRAY[n]);
  IF n = 1 THEN vit[1] := amostras;
  ELSE
    FOR s IN 1..amostras LOOP
      maxx := -1; melhor := 1;
      FOR j IN 1..n LOOP
        x := public.rotator_otim_gamma(comp[j] + 1.0);
        x := x / (x + public.rotator_otim_gamma(vis[j] - comp[j] + 1.0));
        IF x > maxx THEN maxx := x; melhor := j; END IF;
      END LOOP;
      vit[melhor] := vit[melhor] + 1;
    END LOOP;
  END IF;
  probs := array_fill(0::double precision, ARRAY[n]);
  FOR i IN 1..n LOOP probs[i] := vit[i]::double precision / amostras; END LOOP;

  faltam_comp := greatest(0, l.otim_min_compras - total_comp);
  validando := faltam_comp > 0;
  FOR i IN 1..n LOOP IF vis[i] < l.otim_min_visitas THEN validando := true; END IF; END LOOP;

  IF validando THEN
    fase := 'validando';
    FOR i IN 1..n LOOP
      st := CASE WHEN vis[i] < l.otim_min_visitas
                 THEN format('validando: faltam %s visitas', l.otim_min_visitas - vis[i])
                 WHEN faltam_comp > 0 THEN format('validando: faltam %s compras no teste', faltam_comp)
                 ELSE 'validando: aguardando as outras variações' END;
      UPDATE public.rotator_destinations
         SET weight = 10000 / n, otim_peso = 1.0 / n, otim_prob_melhor = probs[i], otim_status = st
       WHERE id = ids[i];
    END LOOP;
  ELSE
    SELECT max(v) INTO maxp FROM unnest(probs) v;
    campea := maxp >= 0.95;
    fase := CASE WHEN campea THEN 'campea' ELSE 'otimizando' END;
    w := public.rotator_otim_pesos(probs, l.otim_piso::double precision, l.otim_teto::double precision, campea);
    FOR i IN 1..n LOOP
      st := CASE WHEN campea AND probs[i] = maxp
                 THEN format('campeã com %s%%', floor(probs[i] * 100)::int)
                 ELSE 'otimizando' END;
      UPDATE public.rotator_destinations
         SET weight = greatest(1, round(w[i] * 10000)::int), otim_peso = w[i],
             otim_prob_melhor = probs[i], otim_status = st
       WHERE id = ids[i];
    END LOOP;
  END IF;

  UPDATE public.rotator_links
     SET otim_fase = fase, otim_recalculado_em = now(), otim_visitas_no_calculo = total_vis
   WHERE id = p_rotator;

  RETURN jsonb_build_object('ok', true, 'fase', fase, 'visitas', total_vis, 'compras', total_comp,
                            'probs', to_jsonb(probs), 'pesos', to_jsonb(w));
END $$;

CREATE OR REPLACE FUNCTION public.rotator_otimizar_todos()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; k integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.rotator_links WHERE otim_ativa LOOP
    BEGIN
      PERFORM public.rotator_otimizar(r.id, false);
      k := k + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'rotator_otimizar % falhou: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN k;
END $$;

REVOKE ALL ON FUNCTION public.rotator_otimizar(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotator_otimizar(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.rotator_otimizar_todos() FROM PUBLIC, anon, authenticated;

-- 4. Gatilhos -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rotator_links_otim_gatilho()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.rotator_otimizar(NEW.id, true);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rotator_links_otim ON public.rotator_links;
CREATE TRIGGER rotator_links_otim
  AFTER UPDATE OF otim_ativa, otim_min_visitas, otim_min_compras, otim_piso, otim_teto ON public.rotator_links
  FOR EACH ROW
  WHEN (OLD.otim_ativa IS DISTINCT FROM NEW.otim_ativa
        OR (NEW.otim_ativa AND (OLD.otim_min_visitas, OLD.otim_min_compras, OLD.otim_piso, OLD.otim_teto)
            IS DISTINCT FROM (NEW.otim_min_visitas, NEW.otim_min_compras, NEW.otim_piso, NEW.otim_teto)))
  EXECUTE FUNCTION public.rotator_links_otim_gatilho();

-- Variação nova com a otimização ligada: o peso digitado é o manual, e o
-- próximo cálculo (cron, ou o "Recalcular agora" do painel) refaz os pesos.
CREATE OR REPLACE FUNCTION public.rotator_destinations_otim_gatilho()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.peso_manual IS NULL AND EXISTS (
       SELECT 1 FROM public.rotator_links WHERE id = NEW.rotator_id AND otim_ativa) THEN
    NEW.peso_manual := NEW.weight;
    UPDATE public.rotator_links SET otim_recalculado_em = NULL WHERE id = NEW.rotator_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rotator_destinations_otim ON public.rotator_destinations;
CREATE TRIGGER rotator_destinations_otim
  BEFORE INSERT ON public.rotator_destinations
  FOR EACH ROW EXECUTE FUNCTION public.rotator_destinations_otim_gatilho();

-- 5. Agenda (pg_cron) ------------------------------------------------------------
SELECT cron.unschedule('rotator-otimizar')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rotator-otimizar');
SELECT cron.schedule('rotator-otimizar', '*/15 * * * *', 'SELECT public.rotator_otimizar_todos()');

-- Conferência (rode depois e olhe):
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'rotator-otimizar';
--   SELECT slug, otim_ativa, otim_fase, otim_recalculado_em FROM public.rotator_links;
--   SELECT label, weight, peso_manual, round(otim_peso*100,1) AS peso_pct,
--          round(otim_prob_melhor*100,1) AS prob_pct, otim_status
--     FROM public.rotator_destinations d JOIN public.rotator_links l ON l.id = d.rotator_id
--    WHERE l.slug = 'desafio' ORDER BY d.created_at;
