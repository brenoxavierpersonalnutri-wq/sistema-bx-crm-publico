-- =============================================================
-- Vendas do teste SEM versão (/r/desafio e qualquer outro teste).
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente.
--
-- O QUE É
-- Venda aprovada do produto do teste que a PagTrust mostra, mas que não
-- chegou com o marcador cm_vN_<clique>: não se sabe de qual página veio.
-- Ela entra SÓ no total do teste (cards Conversões/Receita, ROAS e CPA do
-- bloco "Meta Ads · teste inteiro"). As linhas por variação NÃO mudam.
--
-- NÃO CONTA DUAS VEZES
-- A view rotator_vendas_sem_versao_painel marca atribuida = true quando o
-- mesmo order_id já existe como 'purchase' em rotator_events (lançada à mão
-- ou pelo trigger do pagtrust_webhook_bruto, se o webhook trouxer o pedido
-- com marcador). O painel ignora as atribuídas: a venda passa a contar na
-- variação e sai do "sem versão", sem apagar nada.
--
-- 1. Tabela rotator_vendas_sem_versao (RLS: só usuário aprovado; anon nada).
-- 2. View do painel (security_invoker) com a flag atribuida.
-- 3. A compra v3 lançada à mão em 13/10 ('manual:7d1da8ed-…') ganha o
--    código real do pedido na PagTrust, 13373083 (só se ainda for 'manual:'
--    e nenhuma linha já tiver 13373083).
-- 4. Semente: 8 vendas aprovadas do "Desafio MAGRA e DEFINIDA 14 DIAS" de
--    12 e 13/10 (painel da PagTrust), valor bruto pago pela compradora.
--    A 13373083 fica de fora: é a da v3, já atribuída.
-- Não apaga linha nenhuma.
-- =============================================================

BEGIN;

-- 1. Tabela -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rotator_vendas_sem_versao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rotator_link_id uuid NOT NULL REFERENCES public.rotator_links(id) ON DELETE CASCADE,
  order_id        text NOT NULL,
  value           numeric(12,2) NOT NULL,
  sold_at         timestamptz NOT NULL DEFAULT now(),
  source          text NOT NULL DEFAULT 'manual',
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT auth.uid(),
  CONSTRAINT rotator_vendas_sem_versao_pedido_ck
    CHECK (order_id = btrim(order_id) AND order_id <> '' AND length(order_id) <= 200),
  CONSTRAINT rotator_vendas_sem_versao_valor_ck
    CHECK (value >= 0 AND value < 1000000),
  CONSTRAINT rotator_vendas_sem_versao_source_ck
    CHECK (length(source) <= 60),
  CONSTRAINT rotator_vendas_sem_versao_note_ck
    CHECK (note IS NULL OR length(note) <= 500)
);

-- Um pedido é uma venda: o mesmo código não entra duas vezes (em teste nenhum).
CREATE UNIQUE INDEX IF NOT EXISTS rotator_vendas_sem_versao_pedido_key
  ON public.rotator_vendas_sem_versao (order_id);
CREATE INDEX IF NOT EXISTS rotator_vendas_sem_versao_rotator_idx
  ON public.rotator_vendas_sem_versao (rotator_link_id, sold_at);

ALTER TABLE public.rotator_vendas_sem_versao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users can read rotator_vendas_sem_versao"   ON public.rotator_vendas_sem_versao;
DROP POLICY IF EXISTS "Approved users can insert rotator_vendas_sem_versao" ON public.rotator_vendas_sem_versao;
DROP POLICY IF EXISTS "Approved users can update rotator_vendas_sem_versao" ON public.rotator_vendas_sem_versao;
DROP POLICY IF EXISTS "Approved users can delete rotator_vendas_sem_versao" ON public.rotator_vendas_sem_versao;
CREATE POLICY "Approved users can read rotator_vendas_sem_versao" ON public.rotator_vendas_sem_versao
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));
CREATE POLICY "Approved users can insert rotator_vendas_sem_versao" ON public.rotator_vendas_sem_versao
  FOR INSERT TO authenticated WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "Approved users can update rotator_vendas_sem_versao" ON public.rotator_vendas_sem_versao
  FOR UPDATE TO authenticated USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "Approved users can delete rotator_vendas_sem_versao" ON public.rotator_vendas_sem_versao
  FOR DELETE TO authenticated USING (public.is_approved(auth.uid()));

REVOKE ALL ON TABLE public.rotator_vendas_sem_versao FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rotator_vendas_sem_versao TO authenticated;

-- 2. View do painel ---------------------------------------------------------
-- security_invoker: quem lê passa pelo RLS da tabela e de rotator_events.
DROP VIEW IF EXISTS public.rotator_vendas_sem_versao_painel;
CREATE VIEW public.rotator_vendas_sem_versao_painel
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.rotator_link_id,
  s.order_id,
  s.value,
  s.sold_at,
  s.source,
  s.note,
  s.created_at,
  EXISTS (SELECT 1 FROM public.rotator_events e
           WHERE e.event_type = 'purchase' AND e.order_id = s.order_id) AS atribuida
FROM public.rotator_vendas_sem_versao s;

REVOKE ALL ON public.rotator_vendas_sem_versao_painel FROM PUBLIC, anon;
GRANT SELECT ON public.rotator_vendas_sem_versao_painel TO authenticated;

-- 3. Compra v3 de 13/10: código real do pedido ------------------------------
UPDATE public.rotator_events
   SET order_id = '13373083'
 WHERE event_type = 'purchase'
   AND order_id = 'manual:7d1da8ed-7e81-4076-842e-78919321cacb'
   AND NOT EXISTS (SELECT 1 FROM public.rotator_events e2 WHERE e2.order_id = '13373083');

-- 4. Semente: vendas aprovadas sem versão (horário de Brasília) -------------
DO $$
DECLARE
  v_rotator uuid;
  v_novas   integer;
BEGIN
  SELECT id INTO v_rotator FROM public.rotator_links
   WHERE id = 'd3fbebfd-89c5-4d00-9a0f-ca0d13ec18c4' AND slug = 'desafio';
  IF v_rotator IS NULL THEN
    RAISE EXCEPTION 'rotator desafio (d3fbebfd-…) não encontrado';
  END IF;

  INSERT INTO public.rotator_vendas_sem_versao (rotator_link_id, order_id, value, sold_at, source, note, created_by)
  SELECT v_rotator, x.pedido, x.valor, x.quando, 'pagtrust-manual', x.nota, NULL
    FROM (VALUES
      ('13372733',                  17.00, timestamptz '2026-10-13 10:51:07-03', 'Desafio MAGRA e DEFINIDA 14 DIAS'),
      ('13372505',                  17.00, timestamptz '2026-10-13 09:43:14-03', 'Desafio MAGRA e DEFINIDA 14 DIAS'),
      ('13372471',                  17.00, timestamptz '2026-10-13 09:29:10-03', 'Desafio MAGRA e DEFINIDA 14 DIAS'),
      ('13371943',                  17.00, timestamptz '2026-10-13 07:18:58-03', 'Desafio MAGRA e DEFINIDA 14 DIAS'),
      ('pagtrust-20261012-223527',  36.98, timestamptz '2026-10-12 22:35:27-03', 'Desafio MAGRA e DEFINIDA 14 DIAS + order bump; código do pedido não aparecia no painel'),
      ('13370557',                  17.00, timestamptz '2026-10-12 19:23:55-03', 'Desafio MAGRA e DEFINIDA 14 DIAS'),
      ('13370421',                  17.00, timestamptz '2026-10-12 18:47:52-03', 'Desafio MAGRA e DEFINIDA 14 DIAS'),
      ('13370415',                  17.00, timestamptz '2026-10-12 18:44:01-03', 'Desafio MAGRA e DEFINIDA 14 DIAS')
    ) AS x(pedido, valor, quando, nota)
  ON CONFLICT (order_id) DO NOTHING;
  GET DIAGNOSTICS v_novas = ROW_COUNT;
  RAISE NOTICE 'vendas sem versão novas: %', v_novas;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 5. Conferência (resultado esperado se não houver outra compra atribuída:
--    atribuidas 1 / R$ 17,00 · sem_versao 8 / R$ 155,98 · total 9 / R$ 172,98)
WITH l AS (SELECT id FROM public.rotator_links WHERE slug = 'desafio'),
a AS (
  SELECT count(DISTINCT e.click_id) AS compras,
         coalesce(sum(e.value), 0)   AS receita
    FROM public.rotator_events_por_destino e
   WHERE e.rotator_id = (SELECT id FROM l) AND e.event_type = 'purchase'
),
s AS (
  SELECT count(*) AS compras, coalesce(sum(value), 0) AS receita
    FROM public.rotator_vendas_sem_versao_painel
   WHERE rotator_link_id = (SELECT id FROM l) AND NOT atribuida
)
SELECT a.compras  AS atribuidas, a.receita AS receita_atribuida,
       s.compras  AS sem_versao, s.receita AS receita_sem_versao,
       a.compras + s.compras AS compras_total,
       a.receita + s.receita AS receita_total,
       (SELECT order_id FROM public.rotator_events
         WHERE event_type = 'purchase' AND click_id = '7d1da8ed-7e81-4076-842e-78919321cacb'
         LIMIT 1) AS pedido_da_v3
  FROM a, s;
