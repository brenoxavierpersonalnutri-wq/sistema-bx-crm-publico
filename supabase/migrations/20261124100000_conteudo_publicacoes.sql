-- Conteúdo: publicar e agendar no Instagram pela Zernio (21/10/2026).
--
-- Quem chama a Zernio é o serviço headturbo-zernio na VPS (infra/zernio), não edge function. Este arquivo cria:
--   1) conteudo_publicacoes: uma linha por envio (card do board, conta, tipo, mídia, status, link, erro).
--      RLS: quem tem Conteúdo lê. Ninguém grava direto: só pelas funções abaixo.
--   2) conteudo_pode(uid) / conteudo_meu_acesso(): aprovado E (admin OU módulo "conteudo" em user_modules).
--   3) conteudo_pub_criar(p): o serviço chama com o JWT DO USUÁRIO (criado_por = auth.uid()).
--   4) Pareamento do serviço: o banco guarda só o sha256 do segredo do serviço (conteudo_zernio_chave).
--      O primeiro admin que abre o Conteúdo com o serviço no ar faz o serviço gravar o hash (conteudo_zernio_parear).
--      Status vindo da Zernio (resposta, webhook, consulta periódica) entra por conteudo_pub_sincronizar(p_segredo, ...).
--      Trocar o segredo: SELECT public.conteudo_zernio_reabrir(); (admin) e reiniciar o serviço.
-- Idempotente: pode rodar mais de uma vez. Não apaga nem altera dado de outra tabela.

-- 1) tabela -------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conteudo_publicacoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_ref        text NOT NULL CHECK (length(card_ref) BETWEEN 1 AND 200),
  perfil          text CHECK (perfil IS NULL OR length(perfil) <= 40),
  card_texto      text CHECK (card_texto IS NULL OR length(card_texto) <= 2000),
  conta_id        text NOT NULL CHECK (conta_id ~ '^[a-f0-9]{24}$'),
  conta_nome      text CHECK (conta_nome IS NULL OR length(conta_nome) <= 100),
  tipo            text NOT NULL CHECK (tipo IN ('feed', 'carrossel', 'reels', 'story')),
  legenda         text CHECK (legenda IS NULL OR length(legenda) <= 2200),
  midias          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(midias) = 'array'),
  agora           boolean NOT NULL DEFAULT false,
  agendado_para   timestamptz,
  status          text NOT NULL DEFAULT 'enviando'
                  CHECK (status IN ('enviando', 'agendado', 'publicando', 'publicado', 'erro', 'cancelado')),
  zernio_post_id  text UNIQUE CHECK (zernio_post_id IS NULL OR length(zernio_post_id) <= 64),
  link_post       text CHECK (link_post IS NULL OR link_post ~ '^https://'),
  erro            text CHECK (erro IS NULL OR length(erro) <= 800),
  criado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  publicado_em    timestamptz
);

CREATE INDEX IF NOT EXISTS conteudo_publicacoes_card_idx ON public.conteudo_publicacoes (card_ref, criado_em DESC);
CREATE INDEX IF NOT EXISTS conteudo_publicacoes_pendentes_idx ON public.conteudo_publicacoes (status, agendado_para)
  WHERE status IN ('enviando', 'agendado', 'publicando');

ALTER TABLE public.conteudo_publicacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conteudo_publicacoes FROM anon, authenticated;
GRANT SELECT ON public.conteudo_publicacoes TO authenticated;

-- 2) acesso -------------------------------------------------------------------------------------------------
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

DROP POLICY IF EXISTS "conteudo_publicacoes: quem tem Conteudo le" ON public.conteudo_publicacoes;
CREATE POLICY "conteudo_publicacoes: quem tem Conteudo le" ON public.conteudo_publicacoes
  FOR SELECT TO authenticated USING (public.conteudo_pode(auth.uid()));

-- 3) criar (JWT do usuário) ----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conteudo_pub_criar(p jsonb)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
  _recentes integer;
BEGIN
  IF NOT public.conteudo_pode(_uid) THEN
    RAISE EXCEPTION 'sem acesso ao Conteúdo' USING ERRCODE = '42501';
  END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'pedido inválido' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p->'midias') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'midias') NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'mídias inválidas' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO _recentes FROM public.conteudo_publicacoes
   WHERE criado_por = _uid AND criado_em > now() - interval '1 hour';
  IF _recentes >= 60 THEN
    RAISE EXCEPTION 'limite de publicações por hora' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.conteudo_publicacoes
    (card_ref, perfil, card_texto, conta_id, conta_nome, tipo, legenda, midias, agora, agendado_para, status, criado_por)
  VALUES
    (p->>'card_ref', p->>'perfil', p->>'card_texto', p->>'conta_id', p->>'conta_nome', p->>'tipo', p->>'legenda',
     p->'midias', COALESCE((p->>'agora')::boolean, false), (p->>'agendado_para')::timestamptz, 'enviando', _uid)
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.conteudo_pub_criar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conteudo_pub_criar(jsonb) TO authenticated;

-- 4) pareamento do serviço -----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conteudo_zernio_chave (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  segredo_hash  text NOT NULL CHECK (segredo_hash ~ '^[0-9a-f]{64}$'),
  pareado_por   uuid,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conteudo_zernio_chave ENABLE ROW LEVEL SECURITY; -- sem policy: só as funções abaixo
REVOKE ALL ON public.conteudo_zernio_chave FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.conteudo_zernio_segredo_ok(p_segredo text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_segredo IS NOT NULL AND length(p_segredo) >= 32 AND EXISTS (
    SELECT 1 FROM public.conteudo_zernio_chave
     WHERE segredo_hash = encode(sha256(convert_to(p_segredo, 'UTF8')), 'hex'))
$$;
REVOKE ALL ON FUNCTION public.conteudo_zernio_segredo_ok(text) FROM PUBLIC, anon, authenticated;

-- 'vazio' (ninguém pareou) | 'ok' (o segredo confere) | 'diferente'. Não revela o hash.
CREATE OR REPLACE FUNCTION public.conteudo_zernio_estado(p_segredo text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.conteudo_zernio_chave) THEN 'vazio'
    WHEN public.conteudo_zernio_segredo_ok(p_segredo) THEN 'ok'
    ELSE 'diferente' END
$$;
REVOKE ALL ON FUNCTION public.conteudo_zernio_estado(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conteudo_zernio_estado(text) TO anon, authenticated;

-- Grava o hash UMA vez, só admin. Já pareado: 'ja_pareado' (rearmar com conteudo_zernio_reabrir).
CREATE OR REPLACE FUNCTION public.conteudo_zernio_parear(p_hash text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'só admin pareia o serviço' USING ERRCODE = '42501';
  END IF;
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'hash inválido' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.conteudo_zernio_chave (id, segredo_hash, pareado_por) VALUES (1, p_hash, auth.uid())
  ON CONFLICT (id) DO NOTHING;
  IF FOUND THEN RETURN 'ok'; END IF;
  RETURN 'ja_pareado';
END $$;
REVOKE ALL ON FUNCTION public.conteudo_zernio_parear(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conteudo_zernio_parear(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.conteudo_zernio_reabrir()
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- No SQL editor (sem JWT) roda como dono; pela API, só admin.
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'só admin' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.conteudo_zernio_chave WHERE id = 1;
  RETURN 'reaberto';
END $$;
REVOKE ALL ON FUNCTION public.conteudo_zernio_reabrir() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conteudo_zernio_reabrir() TO authenticated;

-- 5) funções do serviço (segredo) ------------------------------------------------------------------------------
-- Atualiza o status de uma publicação (por id do CRM ou, no webhook, pelo id da Zernio).
-- Estados finais (publicado, cancelado) não voltam atrás; erro pode virar publicado (a Zernio repete sozinha).
CREATE OR REPLACE FUNCTION public.conteudo_pub_sincronizar(
  p_segredo text, p_id uuid, p_zernio_post_id text, p_status text, p_link text, p_erro text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _n integer;
BEGIN
  IF NOT public.conteudo_zernio_segredo_ok(p_segredo) THEN
    RAISE EXCEPTION 'segredo do serviço não confere' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('enviando', 'agendado', 'publicando', 'publicado', 'erro', 'cancelado') THEN
    RAISE EXCEPTION 'status inválido' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL AND p_zernio_post_id IS NULL THEN
    RAISE EXCEPTION 'falta o id' USING ERRCODE = '22023';
  END IF;
  UPDATE public.conteudo_publicacoes c SET
    status         = p_status,
    zernio_post_id = COALESCE(c.zernio_post_id, left(p_zernio_post_id, 64)),
    link_post      = CASE WHEN p_link ~ '^https://' THEN left(p_link, 1000) ELSE c.link_post END,
    erro           = CASE WHEN p_status = 'erro' THEN left(COALESCE(p_erro, 'falhou'), 800) ELSE NULL END,
    publicado_em   = CASE WHEN p_status = 'publicado' THEN COALESCE(c.publicado_em, now()) ELSE c.publicado_em END,
    atualizado_em  = now()
  WHERE (c.id = p_id OR (p_id IS NULL AND c.zernio_post_id = p_zernio_post_id))
    AND c.status NOT IN ('publicado', 'cancelado')
    AND NOT (c.status = 'erro' AND p_status NOT IN ('publicado', 'erro'));
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END $$;
REVOKE ALL ON FUNCTION public.conteudo_pub_sincronizar(text, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conteudo_pub_sincronizar(text, uuid, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.conteudo_pub_pendentes(p_segredo text)
RETURNS TABLE (id uuid, zernio_post_id text, status text, agendado_para timestamptz, criado_em timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.conteudo_zernio_segredo_ok(p_segredo) THEN
    RAISE EXCEPTION 'segredo do serviço não confere' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.id, c.zernio_post_id, c.status, c.agendado_para, c.criado_em
      FROM public.conteudo_publicacoes c
     WHERE c.status IN ('enviando', 'agendado', 'publicando')
     ORDER BY c.agendado_para NULLS FIRST
     LIMIT 500;
END $$;
REVOKE ALL ON FUNCTION public.conteudo_pub_pendentes(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conteudo_pub_pendentes(text) TO anon, authenticated;

-- Pede ao PostgREST para recarregar o esquema (as RPCs novas aparecem na hora).
NOTIFY pgrst, 'reload schema';
