-- =============================================================
-- Compra por variação do teste /r/desafio SEM publicar edge function.
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente.
--
-- POR QUE NÃO É TRIGGER EM sales_events
-- A versão PUBLICADA do pagtrust-webhook-2 (código até 26/09, sem
-- rotatorVenda.ts) grava, para venda aprovada, só:
--   sales_events {profile_id, source:'PAGTRUST_2', value, customer_email,
--                 customer_phone, created_at}
--   monthly_data {month, faturamento, comissao}
-- utm_*, src, sck, código do pedido e payload bruto NÃO são gravados (o
-- payload só vai para console.log). pagtrust-webhook e webhook-receiver
-- publicados gravam o mesmo conjunto. Nenhuma linha do banco carrega o
-- marcador cm_vN_<clique>, então trigger em sales_events não tem o que ler.
--
-- O CAMINHO: a PagTrust chama o PostgREST direto, sem edge function.
--   Webhook NOVO na PagTrust (o "lovable-bxmetrics" fica como está) apontando
--   para  https://SEU_PROJECT_REF.supabase.co/rest/v1/rpc/<nome>?apikey=<chave pública>
--   <nome> é aleatório (wh + 32 hex), gerado aqui, guardado no banco e
--   mostrado no fim; não está no git. A chave pública é a mesma do front
--   (VITE_SUPABASE_PUBLISHABLE_KEY). A função tem UM parâmetro jsonb sem
--   nome, então o PostgREST entrega o corpo inteiro do webhook nela.
--   Ela grava o payload em pagtrust_webhook_bruto; o trigger dessa tabela
--   acha o marcador, confere o clique em rotator_clicks e grava
--   rotator_events 'purchase' com o valor bruto e o código do pedido.
--
-- Mesmas regras do rotatorVenda.ts (status, valor bruto, código do pedido,
-- marcador), para que, se um dia a edge function nova for publicada, os dois
-- caminhos gerem o mesmo order_id e o índice único não deixe duplicar.
-- Reembolso/chargeback: fica registrado em pagtrust_webhook_bruto, a compra
-- NÃO é apagada (consulta no fim do arquivo mostra quais reembolsaram).
-- =============================================================

BEGIN;

-- 0. Garantias da migration 20261013120000 (caso não tenha rodado) ---------
ALTER TABLE public.rotator_events ADD COLUMN IF NOT EXISTS order_id text;
CREATE UNIQUE INDEX IF NOT EXISTS rotator_events_tipo_pedido_key
  ON public.rotator_events (event_type, order_id);
CREATE INDEX IF NOT EXISTS rotator_events_click_id_idx
  ON public.rotator_events (click_id);

-- 1. Payload bruto da PagTrust (tem dado do comprador: fechado à API) ------
CREATE TABLE IF NOT EXISTS public.pagtrust_webhook_bruto (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  payload     jsonb NOT NULL,
  status      text,
  aprovada    boolean,
  reembolso   boolean,
  pedido      text,
  valor       numeric,
  click_id    text,
  variante    text,
  resultado   text
);
CREATE INDEX IF NOT EXISTS pagtrust_webhook_bruto_recebido_idx ON public.pagtrust_webhook_bruto (recebido_em);
CREATE INDEX IF NOT EXISTS pagtrust_webhook_bruto_click_idx    ON public.pagtrust_webhook_bruto (click_id);
ALTER TABLE public.pagtrust_webhook_bruto ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pagtrust_webhook_bruto FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.rotator_webhook_segredo (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nome_funcao text NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rotator_webhook_segredo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rotator_webhook_segredo FROM PUBLIC, anon, authenticated;

-- 2. Leitura do payload (espelho do rotatorVenda.ts / handler publicado) ---

-- Number() do JS: "1.234,56" -> 1234.56; texto não numérico -> NULL.
CREATE OR REPLACE FUNCTION public.pagtrust_numero(t text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, pg_temp AS $$
DECLARE s text := btrim(coalesce(t, ''));
BEGIN
  IF s = '' THEN RETURN NULL; END IF;
  IF position(',' in s) > 0 THEN s := replace(replace(s, '.', ''), ',', '.'); END IF;
  IF s !~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' THEN RETURN NULL; END IF;
  RETURN s::numeric;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

-- getStatus(): mesma ordem de campos do handler.
CREATE OR REPLACE FUNCTION public.pagtrust_status(p jsonb)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT lower(coalesce(p->>'status', p#>>'{transaction,status}', p#>>'{sale,status}',
                        p#>>'{payment,status}', p#>>'{data,purchase,status}', p->>'event', ''));
$$;

-- getGrossValue(): primeiro campo numérico, na ordem do handler.
CREATE OR REPLACE FUNCTION public.pagtrust_valor_bruto(p jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(
    public.pagtrust_numero(p->>'value'), public.pagtrust_numero(p->>'amount'),
    public.pagtrust_numero(p#>>'{sale,value}'), public.pagtrust_numero(p#>>'{sale,amount}'),
    public.pagtrust_numero(p#>>'{sale,total}'),
    public.pagtrust_numero(p#>>'{transaction,value}'), public.pagtrust_numero(p#>>'{transaction,amount}'),
    public.pagtrust_numero(p#>>'{transaction,total}'),
    public.pagtrust_numero(p#>>'{payment,value}'), public.pagtrust_numero(p#>>'{payment,amount}'),
    public.pagtrust_numero(p#>>'{purchase,value}'), public.pagtrust_numero(p#>>'{purchase,amount}'),
    public.pagtrust_numero(p#>>'{data,purchase,full_price,value}'),
    public.pagtrust_numero(p#>>'{data,purchase,original_offer_price,value}'),
    public.pagtrust_numero(p#>>'{data,purchase,price,value}'),
    public.pagtrust_numero(p->>'price'), public.pagtrust_numero(p->>'total'),
    0);
$$;

-- extrairIdDoPedido(): texto não vazio ou número; transação 2.0.0 primeiro.
CREATE OR REPLACE FUNCTION public.pagtrust_pedido(p jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  caminhos text[] := ARRAY[
    '{data,purchase,transaction}', '{data,purchase,order_id}', '{data,purchase,code}',
    '{orderId}', '{order_id}', '{transaction_id}', '{transaction,id}', '{transaction,code}',
    '{sale,id}', '{sale,code}', '{purchase,transaction}', '{purchase,id}', '{order,id}', '{id}'];
  c text; v jsonb; t text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN NULL; END IF;
  FOREACH c IN ARRAY caminhos LOOP
    v := p #> c::text[];
    IF v IS NULL THEN CONTINUE; END IF;
    IF jsonb_typeof(v) = 'string' THEN
      t := btrim(v #>> '{}');
      IF t <> '' THEN RETURN left(t, 200); END IF;
    ELSIF jsonb_typeof(v) = 'number' THEN
      RETURN left(v #>> '{}', 200);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- 3. Trigger: payload -> rotator_events 'purchase' --------------------------
-- BEFORE INSERT para preencher as colunas de leitura na mesma linha.
-- Nunca bloqueia o insert: erro vira WARNING e resultado = 'erro: ...'.
CREATE OR REPLACE FUNCTION public.pagtrust_bruto_processar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  m        text[];
  v_click  text;
  v_var    text;
  v_visto  text;
  v_valor  numeric;
  v_pedido text;
  n        int;
BEGIN
  BEGIN
    NEW.status    := public.pagtrust_status(NEW.payload);
    NEW.aprovada  := NEW.status = ANY (ARRAY['approved','aprovado','paid','pago','completed','completo',
                                            'confirmed','confirmado','purchase_approved']);
    NEW.reembolso := NEW.status = ANY (ARRAY['refunded','reembolsado','refund','reembolso','chargeback',
                                            'purchase_refunded','purchase_chargeback']);
    NEW.valor     := public.pagtrust_valor_bruto(NEW.payload);
    NEW.pedido    := public.pagtrust_pedido(NEW.payload);

    -- Marcador cm_[vN_]<uuid> em qualquer texto do payload; vale o primeiro
    -- cujo clique existe (o "cm_" evita casar com outros uuid do payload).
    FOR m IN
      SELECT regexp_matches(NEW.payload::text,
        'cm_(?:(v[0-9]{1,3})_)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'gi')
    LOOP
      v_visto := coalesce(v_visto, lower(m[2]));
      IF EXISTS (SELECT 1 FROM public.rotator_clicks c WHERE c.click_id = lower(m[2])) THEN
        v_click := lower(m[2]);
        v_var   := lower(m[1]);
        EXIT;
      END IF;
    END LOOP;
    NEW.click_id := coalesce(v_click, v_visto);
    NEW.variante := v_var;

    IF v_visto IS NULL THEN
      NEW.resultado := 'sem-marcador';
    ELSIF v_click IS NULL THEN
      NEW.resultado := 'clique-desconhecido';
    ELSIF NEW.reembolso THEN
      NEW.resultado := 'reembolso (compra mantida)';
    ELSIF NOT NEW.aprovada THEN
      NEW.resultado := 'ignorada: status ' || coalesce(NEW.status, '');
    ELSE
      v_valor  := CASE WHEN NEW.valor > 0 THEN NEW.valor ELSE 0 END;
      v_pedido := coalesce(NEW.pedido, 'sem-pedido:' || v_click || ':' || trim_scale(v_valor)::text);

      -- Compra lançada à mão (rotator_compra_manual) para este clique ganha o
      -- código real do pedido em vez de virar uma segunda compra.
      UPDATE public.rotator_events
         SET order_id = v_pedido, value = v_valor
       WHERE event_type = 'purchase' AND click_id = v_click AND order_id LIKE 'manual:%'
         AND NOT EXISTS (SELECT 1 FROM public.rotator_events e2
                          WHERE e2.event_type = 'purchase' AND e2.order_id = v_pedido);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN
        NEW.resultado := 'registrada (substituiu lançamento manual)';
      ELSE
        INSERT INTO public.rotator_events (click_id, event_type, value, page_url, order_id)
        VALUES (v_click, 'purchase', v_valor, NULL, v_pedido)
        ON CONFLICT (event_type, order_id) DO NOTHING;
        GET DIAGNOSTICS n = ROW_COUNT;
        NEW.resultado := CASE WHEN n = 1 THEN 'registrada' ELSE 'duplicada' END;
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'pagtrust_bruto_processar: % (%)', SQLERRM, SQLSTATE;
    NEW.resultado := left('erro: ' || SQLERRM, 500);
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pagtrust_bruto_processar ON public.pagtrust_webhook_bruto;
CREATE TRIGGER pagtrust_bruto_processar
  BEFORE INSERT ON public.pagtrust_webhook_bruto
  FOR EACH ROW EXECUTE FUNCTION public.pagtrust_bruto_processar();

-- 4. Entrada do webhook ----------------------------------------------------
-- Interna (sem acesso pela API). Também serve para reprocessar à mão um
-- payload copiado do log do pagtrust-webhook-2:
--   SELECT public.pagtrust_receber('<json do log>'::jsonb);
CREATE OR REPLACE FUNCTION public.pagtrust_receber(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE r public.pagtrust_webhook_bruto;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'payload não é objeto JSON');
  END IF;
  IF octet_length(p::text) > 1000000 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'payload grande demais');
  END IF;
  -- Freio contra enxurrada se a URL vazar (venda real não chega nesse ritmo).
  IF (SELECT count(*) FROM public.pagtrust_webhook_bruto
       WHERE recebido_em > now() - interval '10 minutes') >= 300 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'limite de recebimento');
  END IF;
  INSERT INTO public.pagtrust_webhook_bruto (payload) VALUES (p) RETURNING * INTO r;
  RETURN jsonb_build_object('ok', true, 'id', r.id, 'resultado', r.resultado);
END $$;

-- Lançamento manual (backfill de venda vista no painel da PagTrust).
-- Não duplica: se o clique já tem compra, não faz nada.
CREATE OR REPLACE FUNCTION public.rotator_compra_manual(
  p_click text, p_valor numeric, p_pedido text DEFAULT NULL, p_quando timestamptz DEFAULT now())
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE c text := lower(btrim(p_click)); n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rotator_clicks WHERE click_id = c) THEN
    RETURN 'clique-desconhecido: ' || c;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rotator_events WHERE event_type = 'purchase' AND click_id = c) THEN
    RETURN 'ja-tinha-compra: ' || c;
  END IF;
  INSERT INTO public.rotator_events (click_id, event_type, value, page_url, order_id, created_at)
  VALUES (c, 'purchase', greatest(coalesce(p_valor, 0), 0), NULL,
          coalesce(nullif(btrim(p_pedido), ''), 'manual:' || c), coalesce(p_quando, now()))
  ON CONFLICT (event_type, order_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN CASE WHEN n = 1 THEN 'registrada: ' ELSE 'pedido-ja-existia: ' END || c;
END $$;

-- Supabase dá EXECUTE a anon/authenticated em toda função nova do public:
-- tira de todas (senão /rpc/pagtrust_receber pularia o nome secreto).
REVOKE ALL ON FUNCTION public.pagtrust_numero(text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pagtrust_status(jsonb)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pagtrust_valor_bruto(jsonb)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pagtrust_pedido(jsonb)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pagtrust_bruto_processar()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pagtrust_receber(jsonb)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotator_compra_manual(text, numeric, text, timestamptz)
                                                             FROM PUBLIC, anon, authenticated;

-- Função pública de nome aleatório (o "segredo" da URL). O nome não pode ter
-- prefixo adivinhável: o PostgREST sugere nome parecido no erro 404
-- ("Perhaps you meant to call the function ..."), medido em 13/10.
DO $$
DECLARE v_nome text;
BEGIN
  SELECT nome_funcao INTO v_nome FROM public.rotator_webhook_segredo WHERE id = 1;
  IF v_nome IS NULL THEN
    v_nome := 'wh' || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.rotator_webhook_segredo (id, nome_funcao) VALUES (1, v_nome);
  END IF;
  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.%I(jsonb)
    RETURNS jsonb LANGUAGE sql SECURITY DEFINER
    SET search_path = public, pg_temp AS 'SELECT public.pagtrust_receber($1)'
  $f$, v_nome);
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(jsonb) FROM PUBLIC, authenticated', v_nome);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(jsonb) TO anon', v_nome);
END $$;

-- 5. Backfill ---------------------------------------------------------------
-- Venda vista no painel da PagTrust em 13/10 12:25 (R$ 17,00, aprovada,
-- src/sck = cm_v3_7d1da8ed-...). Se o webhook novo trouxer esse pedido depois
-- (reenvio), o trigger troca o 'manual:' pelo código real, sem duplicar.
SELECT public.rotator_compra_manual('7d1da8ed-7e81-4076-842e-78919321cacb', 17.00, NULL,
                                    '2026-10-13 12:25:00-03') AS backfill_v3;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 6. URL para cadastrar na PagTrust (troque <CHAVE_PUBLICA> pela chave
--    publishable/anon do projeto, a mesma do front). Evento: venda aprovada
--    (e reembolso/chargeback, se quiser o registro). Produto: o do Desafio.
SELECT 'https://SEU_PROJECT_REF.supabase.co/rest/v1/rpc/' || nome_funcao
       || '?apikey=<CHAVE_PUBLICA>' AS url_webhook_pagtrust
  FROM public.rotator_webhook_segredo;

-- Conferências (rodar à parte):
-- O que chegou e o que virou:
--   SELECT id, recebido_em, status, pedido, valor, variante, click_id, resultado
--     FROM public.pagtrust_webhook_bruto ORDER BY id DESC LIMIT 50;
-- Vendas PAGTRUST_2 desde 12/10 (para conferir com o painel da PagTrust
-- quais vieram do /r/desafio e lançar à mão com rotator_compra_manual):
--   SELECT created_at + interval '3 hours' AS quando_aprox, value, customer_email
--     FROM public.sales_events
--    WHERE source = 'PAGTRUST_2' AND created_at >= '2026-10-12'
--    ORDER BY created_at;
--   (o handler publicado grava created_at = data da venda MENOS 3 h)
-- Compras do teste que depois reembolsaram:
--   SELECT b.click_id, b.pedido, b.status, b.recebido_em
--     FROM public.pagtrust_webhook_bruto b
--    WHERE b.reembolso AND EXISTS (SELECT 1 FROM public.rotator_events e
--                                   WHERE e.event_type = 'purchase' AND e.click_id = b.click_id);
