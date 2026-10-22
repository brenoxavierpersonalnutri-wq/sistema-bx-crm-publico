-- =============================================================
-- CRM > Banco de dados (/crm/banco): definições de SEGMENTOS (listas prontas) sobre a visão
-- public.base_leads_unificada. Cada segmento é nome + filtro (jsonb) + gatilhos dos fluxos ligados a ele.
-- O front aplica o filtro (src/lib/crm/segmentos.ts, aplicarFiltro). Sem esta tabela a tela usa o mesmo
-- seed embutido, só leitura.
--
-- Rodar inteiro no SQL editor. Idempotente. NÃO apaga nada, NÃO envia mensagem.
-- filtro: { origens?: text[], niveis?: text[], tags?: text[], comprador?: bool, alunas?: 'ativas'|'ex' }
-- gatilhos: [{ tipo: 'evento'|'tag'|'etapa', valor: text }]
-- =============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_segmentos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,60}$'),
  nome        text NOT NULL CHECK (length(trim(nome)) BETWEEN 2 AND 80),
  descricao   text,
  filtro      jsonb NOT NULL DEFAULT '{}'::jsonb,
  gatilhos    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ordem       integer NOT NULL DEFAULT 1000,
  ativo       boolean NOT NULL DEFAULT true,
  criado_por  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_segmentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_segmentos FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crm_segmentos TO authenticated;

DROP POLICY IF EXISTS "Aprovados usam crm_segmentos" ON public.crm_segmentos;
CREATE POLICY "Aprovados usam crm_segmentos" ON public.crm_segmentos FOR ALL TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));

INSERT INTO public.crm_segmentos (slug, nome, descricao, filtro, gatilhos, ordem) VALUES
('todos', 'Todos os leads', 'Uma linha por pessoa, juntando todas as fontes.', '{}', '[]', 10),
('avaliacao-qualificados', 'Avaliação qualificados', 'Formulário da avaliação com nível A a D.',
  '{"origens":["avaliacao"],"niveis":["A","B","C","D"]}',
  '[{"tipo":"evento","valor":"lead_qualificado"},{"tipo":"tag","valor":"lead-qualificado-avaliacao"}]', 20),
('avaliacao-desqualificados', 'Avaliação desqualificados', 'Formulário da avaliação com nível DQ.',
  '{"origens":["avaliacao"],"niveis":["DQ"]}', '[]', 30),
('individual', 'Individual', 'Formulário da consultoria individual.', '{"origens":["individual"]}', '[]', 40),
('ex-alunas', 'Ex-alunas', 'Comprou ou foi aluna e não tem plano vigente.', '{"comprador":true,"alunas":"ex"}', '[]', 50),
('alunas-ativas', 'Alunas ativas', 'Plano vigente na gestão de alunas.', '{"alunas":"ativas"}', '[]', 60),
('compradores-pagtrust', 'Compradores PagTrust', NULL, '{"origens":["pagtrust","compra"],"comprador":true}',
  '[{"tipo":"evento","valor":"pagtrust_desafio_compra_aprovada"},{"tipo":"evento","valor":"pagtrust_lowticket_compra_aprovada"}]', 70),
('abandono-pix', 'Abandonou carrinho / Pix não pago', NULL,
  '{"tags":["abandonou-carrinho","aguardando-pagamento","desafio-carrinho-abandonado","lowticket-carrinho-abandonado"],"comprador":false}',
  '[{"tipo":"evento","valor":"pagtrust_desafio_carrinho_abandonado"},{"tipo":"evento","valor":"pagtrust_lowticket_carrinho_abandonado"}]', 80),
('sellflux', 'SellFlux', 'Contatos importados do SellFlux.', '{"origens":["sellflux"]}', '[]', 90)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
