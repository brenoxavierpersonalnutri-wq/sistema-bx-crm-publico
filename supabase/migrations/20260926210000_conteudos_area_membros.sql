-- -----------------------------------------------------------------------------
-- Área de conteúdos da aluna: módulos, aulas e progresso.
--
-- A aula toca DENTRO do app: YouTube entra como embed (a aluna não é jogada pro
-- YouTube) e vídeo próprio entra como arquivo no storage, servido por URL
-- assinada. Módulo sem programa é visível pra todas; com programa preenchido,
-- só pra quem está naquele plano.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 0. Pré-requisitos do app da aluna
-- -----------------------------------------------------------------------------
-- Estas peças nasceram na migration do app da aluna (20260824120000). Quem
-- aplicou o banco pelo SQL Editor pode não ter rodado aquele arquivo — e sem
-- `aluna_do_usuario` nenhuma policy daqui pra baixo consegue nem ser criada.
-- Tudo aqui é idempotente: se já existe, o bloco não faz nada.
--
-- Nota de formato: este arquivo usa só `$$` como marcador de corpo de função.
-- Marcador com nome (`$fn$`, `$storage$`) é SQL válido, mas alguns editores
-- web cortam o comando no primeiro `;` de dentro do corpo e devolvem
-- "unterminated dollar-quoted string". Com `$$` puro, cola em qualquer um.

CREATE TABLE IF NOT EXISTS public.aluna_acessos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluna_id      uuid NOT NULL REFERENCES public.alunas(id) ON DELETE CASCADE,
  user_id       uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email         text NOT NULL,
  convite_token text UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  ativo         boolean NOT NULL DEFAULT true,
  ultimo_acesso timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aluna_id)
);

CREATE INDEX IF NOT EXISTS idx_aluna_acessos_user  ON public.aluna_acessos(user_id);
CREATE INDEX IF NOT EXISTS idx_aluna_acessos_email ON public.aluna_acessos(lower(email));

ALTER TABLE public.aluna_acessos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_gerencia_aluna_acessos" ON public.aluna_acessos;
CREATE POLICY "time_gerencia_aluna_acessos" ON public.aluna_acessos
  FOR ALL TO authenticated
  USING (public.is_approved(auth.uid()))
  WITH CHECK (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "aluna_le_seu_acesso" ON public.aluna_acessos;
CREATE POLICY "aluna_le_seu_acesso" ON public.aluna_acessos
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- "Qual aluna é este usuário logado?" SECURITY DEFINER pra não cair em recursão
-- de RLS quando as policies chamarem a função.
CREATE OR REPLACE FUNCTION public.aluna_do_usuario(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT aluna_id
  FROM public.aluna_acessos
  WHERE user_id = _user_id AND ativo = true
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.e_minha_aluna(_aluna_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _aluna_id IS NOT NULL
     AND _aluna_id = public.aluna_do_usuario(auth.uid())
$$;

-- Login da aluna: casa o e-mail do auth com o cadastro que o time liberou.
CREATE OR REPLACE FUNCTION public.vincular_meu_acesso()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meu_email text;
  ja_vinculada uuid;
  alvo uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT aluna_id INTO ja_vinculada
  FROM public.aluna_acessos
  WHERE user_id = auth.uid() AND ativo = true;

  IF ja_vinculada IS NOT NULL THEN
    UPDATE public.aluna_acessos
       SET ultimo_acesso = now()
     WHERE user_id = auth.uid();
    RETURN ja_vinculada;
  END IF;

  SELECT lower(email) INTO meu_email FROM auth.users WHERE id = auth.uid();
  IF meu_email IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.aluna_acessos
     SET user_id = auth.uid(), ultimo_acesso = now()
   WHERE lower(email) = meu_email
     AND user_id IS NULL
     AND ativo = true
  RETURNING aluna_id INTO alvo;

  RETURN alvo;
END;
$$;

REVOKE ALL ON FUNCTION public.vincular_meu_acesso() FROM public;
GRANT EXECUTE ON FUNCTION public.vincular_meu_acesso() TO authenticated;

CREATE OR REPLACE FUNCTION public.meu_perfil_aluna()
RETURNS TABLE (aluna_id uuid, nome_completo text, programa text, data_vencimento date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.nome_completo, a.programa, a.data_vencimento
  FROM public.alunas a
  WHERE a.id = public.aluna_do_usuario(auth.uid())
$$;

REVOKE ALL ON FUNCTION public.meu_perfil_aluna() FROM public;
GRANT EXECUTE ON FUNCTION public.meu_perfil_aluna() TO authenticated;


-- -----------------------------------------------------------------------------
-- 1. Módulos, aulas e progresso
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conteudo_modulos (
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

CREATE TABLE IF NOT EXISTS public.conteudo_aulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id uuid NOT NULL REFERENCES public.conteudo_modulos(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  descricao text,
  capa_url text,
  -- 'youtube' guarda o id de 11 caracteres; 'upload' guarda o caminho no bucket.
  tipo text NOT NULL DEFAULT 'youtube' CHECK (tipo IN ('youtube', 'upload')),
  youtube_id text,
  video_path text,
  duracao_segundos integer,
  destaque boolean NOT NULL DEFAULT false,
  ordem integer NOT NULL DEFAULT 0,
  publicado boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conteudo_progresso (
  aluna_id uuid NOT NULL,
  aula_id uuid NOT NULL REFERENCES public.conteudo_aulas(id) ON DELETE CASCADE,
  segundos integer NOT NULL DEFAULT 0,
  concluida boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (aluna_id, aula_id)
);

CREATE INDEX IF NOT EXISTS idx_conteudo_modulos_ordem
  ON public.conteudo_modulos (ordem, created_at);
CREATE INDEX IF NOT EXISTS idx_conteudo_aulas_modulo
  ON public.conteudo_aulas (modulo_id, ordem, created_at);
CREATE INDEX IF NOT EXISTS idx_conteudo_progresso_aluna
  ON public.conteudo_progresso (aluna_id, updated_at DESC);

ALTER TABLE public.conteudo_modulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conteudo_aulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conteudo_progresso ENABLE ROW LEVEL SECURITY;

-- ---- Time: gerencia tudo ----------------------------------------------------
DROP POLICY IF EXISTS "time_gerencia_conteudo_modulos" ON public.conteudo_modulos;
CREATE POLICY "time_gerencia_conteudo_modulos" ON public.conteudo_modulos
  FOR ALL TO authenticated
  USING (public.is_approved(auth.uid()))
  WITH CHECK (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "time_gerencia_conteudo_aulas" ON public.conteudo_aulas;
CREATE POLICY "time_gerencia_conteudo_aulas" ON public.conteudo_aulas
  FOR ALL TO authenticated
  USING (public.is_approved(auth.uid()))
  WITH CHECK (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "time_gerencia_conteudo_progresso" ON public.conteudo_progresso;
CREATE POLICY "time_gerencia_conteudo_progresso" ON public.conteudo_progresso
  FOR ALL TO authenticated
  USING (public.is_approved(auth.uid()))
  WITH CHECK (public.is_approved(auth.uid()));

-- ---- Aluna: lê o que está publicado e liberado pro plano dela ---------------
DROP POLICY IF EXISTS "aluna_le_modulos" ON public.conteudo_modulos;
CREATE POLICY "aluna_le_modulos" ON public.conteudo_modulos
  FOR SELECT TO authenticated
  USING (
    publicado = true
    AND EXISTS (
      SELECT 1 FROM public.alunas a
      WHERE a.id = public.aluna_do_usuario(auth.uid())
        AND (
          conteudo_modulos.programa IS NULL
          OR btrim(conteudo_modulos.programa) = ''
          OR lower(btrim(conteudo_modulos.programa)) = lower(btrim(coalesce(a.programa, '')))
        )
    )
  );

DROP POLICY IF EXISTS "aluna_le_aulas" ON public.conteudo_aulas;
CREATE POLICY "aluna_le_aulas" ON public.conteudo_aulas
  FOR SELECT TO authenticated
  USING (
    publicado = true
    AND EXISTS (
      SELECT 1 FROM public.conteudo_modulos m
      WHERE m.id = conteudo_aulas.modulo_id AND m.publicado = true
    )
  );

-- ---- Aluna: o progresso é dela ---------------------------------------------
DROP POLICY IF EXISTS "aluna_le_progresso" ON public.conteudo_progresso;
CREATE POLICY "aluna_le_progresso" ON public.conteudo_progresso
  FOR SELECT TO authenticated
  USING (conteudo_progresso.aluna_id = public.aluna_do_usuario(auth.uid()));

DROP POLICY IF EXISTS "aluna_grava_progresso" ON public.conteudo_progresso;
CREATE POLICY "aluna_grava_progresso" ON public.conteudo_progresso
  FOR INSERT TO authenticated
  WITH CHECK (conteudo_progresso.aluna_id = public.aluna_do_usuario(auth.uid()));

DROP POLICY IF EXISTS "aluna_atualiza_progresso" ON public.conteudo_progresso;
CREATE POLICY "aluna_atualiza_progresso" ON public.conteudo_progresso
  FOR UPDATE TO authenticated
  USING (conteudo_progresso.aluna_id = public.aluna_do_usuario(auth.uid()))
  WITH CHECK (conteudo_progresso.aluna_id = public.aluna_do_usuario(auth.uid()));

-- -----------------------------------------------------------------------------
-- Storage: vídeos e capas. Privado, servido por URL assinada.
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'conteudos', 'conteudos', false, 1073741824,
  ARRAY[
    'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v',
    'image/jpeg', 'image/png', 'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- storage.objects pertence a supabase_storage_admin. Pelo SQL Editor o papel é
-- postgres, que costuma ser MEMBRO desse papel — então assumimos o papel. Se
-- nem isso der, o bloco avisa e segue: as policies podem ser criadas depois em
-- Storage -> Policies, sem derrubar o resto da migration.
DO $$
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE supabase_storage_admin';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Sem permissão pra criar policies de storage; cria na tela Storage -> Policies.';
    RETURN;
  END;

  DROP POLICY IF EXISTS "conteudos_time_gerencia" ON storage.objects;
  CREATE POLICY "conteudos_time_gerencia" ON storage.objects
    FOR ALL TO authenticated
    USING (bucket_id = 'conteudos' AND public.is_approved(auth.uid()))
    WITH CHECK (bucket_id = 'conteudos' AND public.is_approved(auth.uid()));

  DROP POLICY IF EXISTS "conteudos_aluna_le" ON storage.objects;
  CREATE POLICY "conteudos_aluna_le" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'conteudos' AND public.aluna_do_usuario(auth.uid()) IS NOT NULL);
END
$$;

NOTIFY pgrst, 'reload schema';
