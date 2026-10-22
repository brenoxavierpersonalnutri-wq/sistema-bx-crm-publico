-- =============================================================
-- Base de leads (importação do SellFlux e outras origens) + segmentos para campanha.
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente.
-- Só usuários aprovados (public.is_approved) leem e escrevem. Nada aqui envia mensagem.
-- =============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.base_leads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem         text NOT NULL DEFAULT 'sellflux',
  origem_id      text NOT NULL,
  nome           text,
  telefone_e164  text,
  email          text,
  tags           text[] NOT NULL DEFAULT '{}',
  produto        text,
  status         text,
  criado_origem  timestamptz,
  importado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origem, origem_id)
);

CREATE INDEX IF NOT EXISTS base_leads_telefone_idx ON public.base_leads (telefone_e164);
CREATE INDEX IF NOT EXISTS base_leads_tags_gin_idx ON public.base_leads USING GIN (tags);
CREATE INDEX IF NOT EXISTS base_leads_produto_idx  ON public.base_leads (produto);
CREATE INDEX IF NOT EXISTS base_leads_criado_idx   ON public.base_leads (criado_origem);

ALTER TABLE public.base_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.base_leads FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.base_leads TO authenticated;

DROP POLICY IF EXISTS "Aprovados leem base_leads" ON public.base_leads;
DROP POLICY IF EXISTS "Aprovados inserem base_leads" ON public.base_leads;
DROP POLICY IF EXISTS "Aprovados atualizam base_leads" ON public.base_leads;
DROP POLICY IF EXISTS "Aprovados apagam base_leads" ON public.base_leads;
CREATE POLICY "Aprovados leem base_leads" ON public.base_leads FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));
CREATE POLICY "Aprovados inserem base_leads" ON public.base_leads FOR INSERT TO authenticated
  WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "Aprovados atualizam base_leads" ON public.base_leads FOR UPDATE TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));
CREATE POLICY "Aprovados apagam base_leads" ON public.base_leads FOR DELETE TO authenticated
  USING (public.is_approved(auth.uid()));

-- Segmentos prontos para campanha (só a lista; o disparo é das automações) -------------------
CREATE TABLE IF NOT EXISTS public.base_leads_segmentos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  filtro      jsonb NOT NULL DEFAULT '{}'::jsonb,
  telefones   text[] NOT NULL DEFAULT '{}',
  total       integer NOT NULL DEFAULT 0,
  criado_por  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.base_leads_segmentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.base_leads_segmentos FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.base_leads_segmentos TO authenticated;

DROP POLICY IF EXISTS "Aprovados usam base_leads_segmentos" ON public.base_leads_segmentos;
CREATE POLICY "Aprovados usam base_leads_segmentos" ON public.base_leads_segmentos FOR ALL TO authenticated
  USING (public.is_approved(auth.uid())) WITH CHECK (public.is_approved(auth.uid()));

COMMIT;
