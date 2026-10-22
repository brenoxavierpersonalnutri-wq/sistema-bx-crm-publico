-- Conteúdo: Estúdio React (21/10/2026) — projetos de react gravados em /conteudo/react.
--
-- Os vídeos NÃO moram no banco: o original, a gravação e o MP4 pronto ficam no serviço headturbo-react na VPS
-- (infra/react). Esta tabela é a lista de projetos (título, linha do tempo, opções, status, duração), que o CRM
-- escreve com o JWT do usuário. O serviço confere, com o JWT de quem chama, que a pessoa enxerga a linha do projeto
-- (RLS abaixo) antes de aceitar upload ou montagem.
--
-- Quem tem acesso: aprovado E (admin OU módulo "conteudo" em user_modules) = public.conteudo_pode(uid), a mesma
-- regra da publicação no Instagram (20261124100000). As duas funções de acesso são recriadas aqui com o MESMO corpo,
-- para esta migration rodar sozinha mesmo que a 20261124100000 ainda não tenha rodado.
--
-- Idempotente: pode rodar mais de uma vez. Não apaga nem altera dado de outra tabela.

-- 1) acesso (mesmo corpo da 20261124100000) --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conteudo_pode(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL
     AND public.is_approved(_uid)
     AND (public.has_role(_uid, 'admin'::public.app_role) OR public.has_module(_uid, 'conteudo'))
$$;
REVOKE ALL ON FUNCTION public.conteudo_pode(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conteudo_pode(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.conteudo_meu_acesso()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'aprovado', auth.uid() IS NOT NULL AND public.is_approved(auth.uid()),
    'admin',    auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'::public.app_role),
    'conteudo', public.conteudo_pode(auth.uid())
  )
$$;
REVOKE ALL ON FUNCTION public.conteudo_meu_acesso() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conteudo_meu_acesso() TO authenticated;

-- 2) tabela ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conteudo_reacts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo                text NOT NULL DEFAULT 'React' CHECK (length(titulo) BETWEEN 1 AND 120),
  perfil                text CHECK (perfil IS NULL OR length(perfil) <= 40),
  modo                  text NOT NULL DEFAULT 'aqui' CHECK (modo IN ('aqui', 'separado')),
  layout                text NOT NULL DEFAULT 'dividido' CHECK (layout IN ('dividido', 'cheia_longos')),
  legenda               boolean NOT NULL DEFAULT true,
  cortar_silencio       boolean NOT NULL DEFAULT true,
  linha_tempo           jsonb NOT NULL DEFAULT '[]'::jsonb
                        CHECK (jsonb_typeof(linha_tempo) = 'array' AND jsonb_array_length(linha_tempo) <= 1000),
  original_nome         text CHECK (original_nome IS NULL OR length(original_nome) <= 300),
  original_bytes        bigint CHECK (original_bytes IS NULL OR original_bytes >= 0),
  duracao_gravacao_seg  numeric(10, 2) CHECK (duracao_gravacao_seg IS NULL OR duracao_gravacao_seg >= 0),
  duracao_final_seg     numeric(10, 2) CHECK (duracao_final_seg IS NULL OR duracao_final_seg >= 0),
  status                text NOT NULL DEFAULT 'rascunho'
                        CHECK (status IN ('rascunho', 'enviando', 'montando', 'pronto', 'erro')),
  erro                  text CHECK (erro IS NULL OR length(erro) <= 800),
  -- conteudo_publicacoes.id quando ele publicou/agendou este react (sem FK: as migrations podem rodar em qualquer ordem)
  publicacao_id         uuid,
  criado_por            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conteudo_reacts_criado_idx ON public.conteudo_reacts (criado_em DESC);

-- quem cria é sempre quem está logado; id, autor e data de criação não mudam; atualizado_em é do banco
CREATE OR REPLACE FUNCTION public.conteudo_reacts_carimbo()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.criado_por := auth.uid();
    NEW.criado_em := now();
  ELSE
    NEW.id := OLD.id;
    NEW.criado_por := OLD.criado_por;
    NEW.criado_em := OLD.criado_em;
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS conteudo_reacts_carimbo ON public.conteudo_reacts;
CREATE TRIGGER conteudo_reacts_carimbo BEFORE INSERT OR UPDATE ON public.conteudo_reacts
  FOR EACH ROW EXECUTE FUNCTION public.conteudo_reacts_carimbo();

-- 3) RLS: quem tem Conteúdo vê e edita os reacts do time; apagar = quem criou ou admin -----------------------------
ALTER TABLE public.conteudo_reacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conteudo_reacts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conteudo_reacts TO authenticated;

DROP POLICY IF EXISTS "conteudo_reacts: quem tem Conteudo le" ON public.conteudo_reacts;
CREATE POLICY "conteudo_reacts: quem tem Conteudo le" ON public.conteudo_reacts
  FOR SELECT TO authenticated USING (public.conteudo_pode(auth.uid()));

DROP POLICY IF EXISTS "conteudo_reacts: quem tem Conteudo cria" ON public.conteudo_reacts;
CREATE POLICY "conteudo_reacts: quem tem Conteudo cria" ON public.conteudo_reacts
  FOR INSERT TO authenticated WITH CHECK (public.conteudo_pode(auth.uid()) AND criado_por = auth.uid());

DROP POLICY IF EXISTS "conteudo_reacts: quem tem Conteudo edita" ON public.conteudo_reacts;
CREATE POLICY "conteudo_reacts: quem tem Conteudo edita" ON public.conteudo_reacts
  FOR UPDATE TO authenticated USING (public.conteudo_pode(auth.uid())) WITH CHECK (public.conteudo_pode(auth.uid()));

DROP POLICY IF EXISTS "conteudo_reacts: autor ou admin apaga" ON public.conteudo_reacts;
CREATE POLICY "conteudo_reacts: autor ou admin apaga" ON public.conteudo_reacts
  FOR DELETE TO authenticated USING (
    public.conteudo_pode(auth.uid())
    AND (criado_por = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  );
