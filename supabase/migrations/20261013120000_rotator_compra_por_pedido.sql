-- =============================================================
-- Teste de página (/r/desafio): checkout e compra por variação.
-- Idempotente: pode rodar de novo sem efeito colateral.
--
-- 1. rotator_events.order_id: código do pedido da PagTrust na linha
--    'purchase' gravada pelo webhook. Índice único (event_type, order_id):
--    o mesmo pedido reenviado, ou chegando por dois webhooks, não duplica.
--    Linhas antigas e as do rotator-track ficam com order_id NULL, e NULL
--    não conflita com nada.
-- 2. Inserção direta pela API pública (anon/authenticated) não pode mais
--    gravar 'purchase' nem order_id: compra só entra pelo service role
--    (webhook e rotator-track, que já usam service role e ignoram RLS).
--    Nenhum código do app insere direto nessa tabela.
-- 3. View rotator_events_por_destino (security_invoker): evento já com a
--    variação (destination_id) e o rotador, para o painel ler só os eventos
--    do teste, paginado, sem mandar milhares de click_id na URL.
-- Não apaga nem altera linha existente.
-- =============================================================

-- 1. Pedido na linha de compra ---------------------------------------------
ALTER TABLE public.rotator_events ADD COLUMN IF NOT EXISTS order_id text;

CREATE UNIQUE INDEX IF NOT EXISTS rotator_events_tipo_pedido_key
  ON public.rotator_events (event_type, order_id);

CREATE INDEX IF NOT EXISTS rotator_events_click_id_idx
  ON public.rotator_events (click_id);

CREATE INDEX IF NOT EXISTS rotator_clicks_rotator_id_idx
  ON public.rotator_clicks (rotator_id);

CREATE INDEX IF NOT EXISTS rotator_clicks_destination_id_idx
  ON public.rotator_clicks (destination_id);

-- 2. Inserção pública só de pageview/checkout, sem pedido -------------------
DROP POLICY IF EXISTS "Anyone can insert rotator_events" ON public.rotator_events;
CREATE POLICY "Anyone can insert rotator_events" ON public.rotator_events
  FOR INSERT
  WITH CHECK (event_type IN ('pageview', 'checkout') AND order_id IS NULL);

-- 3. View do painel ---------------------------------------------------------
DROP VIEW IF EXISTS public.rotator_events_por_destino;
CREATE VIEW public.rotator_events_por_destino
WITH (security_invoker = true) AS
SELECT
  e.id AS event_id,
  c.rotator_id,
  c.destination_id,
  e.click_id,
  e.event_type,
  e.value,
  e.page_url,
  e.order_id,
  e.created_at
FROM public.rotator_events e
JOIN public.rotator_clicks c ON c.click_id = e.click_id;

REVOKE ALL ON public.rotator_events_por_destino FROM anon;
GRANT SELECT ON public.rotator_events_por_destino TO authenticated;

-- Conferência (rode depois e olhe o resultado; por variação do desafio):
-- SELECT d.label,
--        (SELECT count(*) FROM public.rotator_clicks c WHERE c.destination_id = d.id) AS visitas,
--        count(DISTINCT e.click_id) FILTER (WHERE e.event_type = 'checkout') AS checkouts,
--        count(DISTINCT e.click_id) FILTER (WHERE e.event_type = 'purchase') AS compras,
--        coalesce(sum(e.value) FILTER (WHERE e.event_type = 'purchase'), 0) AS receita
--   FROM public.rotator_links l
--   JOIN public.rotator_destinations d ON d.rotator_id = l.id
--   LEFT JOIN public.rotator_events_por_destino e ON e.destination_id = d.id
--  WHERE l.slug = 'desafio'
--  GROUP BY d.id, d.label ORDER BY d.label;
