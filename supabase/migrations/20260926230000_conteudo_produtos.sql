-- -----------------------------------------------------------------------------
-- Nível de PRODUTO na área de conteúdos.
--
-- A hierarquia passa a ser Produto -> Módulo -> Aula, igual ao que o Breno já
-- usa na plataforma de vendas: "PLATAFORMA MAGRA E DEFINIDA" é o produto,
-- "Boas vindas", "Os pilares do treino" são os módulos, e as aulas ficam
-- dentro deles.
--
-- Quem vê o quê passa a ser decidido no produto: produto sem programa é de
-- todas as alunas; com programa preenchido, só de quem está nesse plano.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.conteudo_produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  descricao text,
  capa_url text,
  programa text,
  ordem integer NOT NULL DEFAULT 0,
  publicado boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conteudo_produtos_ordem
  ON public.conteudo_produtos (ordem, created_at);

ALTER TABLE public.conteudo_modulos
  ADD COLUMN IF NOT EXISTS produto_id uuid REFERENCES public.conteudo_produtos(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_conteudo_modulos_produto
  ON public.conteudo_modulos (produto_id, ordem, created_at);

ALTER TABLE public.conteudo_produtos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_gerencia_conteudo_produtos" ON public.conteudo_produtos;
CREATE POLICY "time_gerencia_conteudo_produtos" ON public.conteudo_produtos
  FOR ALL TO authenticated
  USING (public.is_approved(auth.uid()))
  WITH CHECK (public.is_approved(auth.uid()));

-- A aluna vê o produto publicado que está liberado pro plano dela.
DROP POLICY IF EXISTS "aluna_le_produtos" ON public.conteudo_produtos;
CREATE POLICY "aluna_le_produtos" ON public.conteudo_produtos
  FOR SELECT TO authenticated
  USING (
    publicado = true
    AND EXISTS (
      SELECT 1 FROM public.alunas a
      WHERE a.id = public.aluna_do_usuario(auth.uid())
        AND (
          conteudo_produtos.programa IS NULL
          OR btrim(conteudo_produtos.programa) = ''
          OR lower(btrim(conteudo_produtos.programa)) = lower(btrim(coalesce(a.programa, '')))
        )
    )
  );

-- O módulo agora herda o acesso do produto. Módulo solto (sem produto) fica
-- invisível pra aluna: é rascunho até ser colocado dentro de um produto.
DROP POLICY IF EXISTS "aluna_le_modulos" ON public.conteudo_modulos;
CREATE POLICY "aluna_le_modulos" ON public.conteudo_modulos
  FOR SELECT TO authenticated
  USING (
    publicado = true
    AND EXISTS (
      SELECT 1 FROM public.conteudo_produtos p
      WHERE p.id = conteudo_modulos.produto_id AND p.publicado = true
    )
  );

NOTIFY pgrst, 'reload schema';
