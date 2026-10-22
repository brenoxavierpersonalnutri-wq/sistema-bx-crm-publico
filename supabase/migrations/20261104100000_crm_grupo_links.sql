-- Links curtos públicos do CRM (18/10/2026):
--   /grupo/<slug> → convite de grupo do WhatsApp (tipo 'grupo')
--   /ir/<slug>    → qualquer outro destino https (tipo 'link'), ex.: /ir/feedback → formulário das alunas
-- Motivo: template oficial (Full Funnel) não aceita botão com chat.whatsapp.com direto; o botão aponta
-- pra equipe.brenoxavier.com.br e a SPA redireciona.
--
-- Acesso:
--   anon/authenticated → SÓ a RPC crm_grupo_link_abrir(slug, tipo) (SECURITY DEFINER): devolve a url
--                         se o link estiver ativo e conta o clique. Nenhum SELECT direto na tabela.
--   admin ou usuário aprovado → lê e edita a tabela (seção "Links de convite" do CRM).
--
-- Idempotente: pode rodar de novo sem quebrar.

CREATE TABLE IF NOT EXISTS public.crm_grupo_links (
  slug       text PRIMARY KEY,
  nome       text NOT NULL DEFAULT '',
  tipo       text NOT NULL DEFAULT 'grupo',
  url        text,
  ativo      boolean NOT NULL DEFAULT false,
  cliques    integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_grupo_links_slug_formato CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  CONSTRAINT crm_grupo_links_tipo_valido  CHECK (tipo IN ('grupo', 'link')),
  CONSTRAINT crm_grupo_links_url_https    CHECK (url IS NULL OR url ~ '^https://[^[:space:]]+$'),
  -- ativo exige destino
  CONSTRAINT crm_grupo_links_ativo_com_url CHECK (NOT ativo OR url IS NOT NULL)
);

-- updated_at automático
CREATE OR REPLACE FUNCTION public.crm_grupo_links_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- clique não conta como edição
  IF TG_OP = 'UPDATE'
     AND NEW.url IS NOT DISTINCT FROM OLD.url AND NEW.ativo = OLD.ativo
     AND NEW.nome = OLD.nome AND NEW.tipo = OLD.tipo THEN
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS crm_grupo_links_touch ON public.crm_grupo_links;
CREATE TRIGGER crm_grupo_links_touch BEFORE INSERT OR UPDATE ON public.crm_grupo_links
  FOR EACH ROW EXECUTE FUNCTION public.crm_grupo_links_touch();

ALTER TABLE public.crm_grupo_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.crm_grupo_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crm_grupo_links TO authenticated;
GRANT ALL ON TABLE public.crm_grupo_links TO service_role;

DROP POLICY IF EXISTS "Admin ou aprovado usa crm_grupo_links" ON public.crm_grupo_links;
CREATE POLICY "Admin ou aprovado usa crm_grupo_links" ON public.crm_grupo_links FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_approved(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_approved(auth.uid()));

-- RPC pública: url do link ativo (e +1 clique) ou NULL. p_tipo NULL = qualquer tipo.
CREATE OR REPLACE FUNCTION public.crm_grupo_link_abrir(p_slug text, p_tipo text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
BEGIN
  IF p_slug IS NULL OR length(p_slug) > 60 THEN
    RETURN NULL;
  END IF;
  UPDATE public.crm_grupo_links
     SET cliques = cliques + 1
   WHERE slug = lower(trim(p_slug))
     AND ativo
     AND url IS NOT NULL
     AND (p_tipo IS NULL OR tipo = p_tipo)
  RETURNING url INTO v_url;
  RETURN v_url;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_grupo_link_abrir(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_grupo_link_abrir(text, text) TO anon, authenticated;

-- Seed: sem destino e inativos até o Breno colar o link no CRM. Não sobrescreve o que já existe.
INSERT INTO public.crm_grupo_links (slug, nome, tipo, url, ativo) VALUES
  ('mgmd',       'Grupo MGMD',                 'grupo', NULL, false),
  ('elite',      'Grupo Elite',                'grupo', NULL, false),
  ('plataforma', 'Grupo Plataforma',           'grupo', NULL, false),
  ('feedback',   'Formulário de feedback',     'link',  NULL, false)
ON CONFLICT (slug) DO NOTHING;
