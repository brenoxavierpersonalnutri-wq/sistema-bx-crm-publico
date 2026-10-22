-- CRM: etapas do kanban configuráveis (18/10/2026, pedido do Breno: "criar mais etapas").
--
-- Antes: 5 etapas fixas no código (leads, contato, agendado, compareceu, fechou) em KANBAN_COLUMNS (front) e em
-- ETAPAS_VALIDAS / ETAPAS_FLUXO / ETAPAS_PADRAO (_shared). O banco NUNCA teve CHECK em stage: whatsapp_contacts,
-- ig_contatos e crm_roteiros guardam stage como text livre.
--
-- Agora:
--  1) public.crm_etapas (slug PK, nome, cor, ordem, ativo, sistema). As 5 de sempre entram como sistema=true
--     (renomeia e reordena; não apaga, não arquiva, slug e flag sistema imutáveis).
--  2) Qualquer stage que já exista no banco e não seja uma das 5 vira etapa (não-sistema), para nada sumir do
--     quadro nem a FK falhar.
--  3) FK de whatsapp_contacts.stage, ig_contatos.stage e crm_roteiros.stage para crm_etapas(slug)
--     (ON DELETE RESTRICT: etapa em uso não é apagada). Se sobrar valor fora do formato de slug, a FK entra
--     NOT VALID (linhas antigas ficam como estão; escrita nova é validada) e um NOTICE avisa.
--  4) Arquivar etapa: só não-sistema e sem contato (trigger). public.crm_etapa_valida(slug) para quem quiser
--     validar sem a FK.
--  RLS: aprovados leem; admin cria/edita/arquiva/apaga. Edge functions usam service_role.
--
-- Idempotente (roda 2x sem erro) e não altera nem apaga nenhum dado de contato/roteiro.

-- 1) Tabela -------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_etapas (
  slug       text PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9_]{0,39}$'),
  nome       text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 40),
  cor        text NOT NULL DEFAULT '#64748b' CHECK (cor ~ '^#[0-9a-fA-F]{6}$'),
  ordem      integer NOT NULL DEFAULT 0,
  ativo      boolean NOT NULL DEFAULT true,
  sistema    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_etapas_ordem_idx ON public.crm_etapas (ordem);

-- 2) Seed: as 5 de sempre (não sobrescreve nome/cor/ordem se alguém já editou) ------------------------------
INSERT INTO public.crm_etapas (slug, nome, cor, ordem, ativo, sistema) VALUES
  ('leads',      'Leads',      '#64748b', 1, true, true),
  ('contato',    'Em Contato', '#3b82f6', 2, true, true),
  ('agendado',   'Agendado',   '#f59e0b', 3, true, true),
  ('compareceu', 'Compareceu', '#8b5cf6', 4, true, true),
  ('fechou',     'Fechou',     '#22c55e', 5, true, true)
ON CONFLICT (slug) DO UPDATE SET sistema = true, ativo = true;

-- 3) Stages já gravados fora das 5: viram etapas (ativas, para aparecerem no quadro) --------------------------
DO $$
DECLARE
  fontes text[] := ARRAY['public.whatsapp_contacts', 'public.ig_contatos', 'public.crm_roteiros'];
  t text;
  r record;
  prox integer;
BEGIN
  FOREACH t IN ARRAY fontes LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;
    FOR r IN EXECUTE format('SELECT DISTINCT stage FROM %s WHERE stage IS NOT NULL', t) LOOP
      IF r.stage ~ '^[a-z0-9][a-z0-9_]{0,39}$' THEN
        IF NOT EXISTS (SELECT 1 FROM public.crm_etapas WHERE slug = r.stage) THEN
          SELECT COALESCE(max(ordem), 0) + 1 INTO prox FROM public.crm_etapas;
          INSERT INTO public.crm_etapas (slug, nome, ordem) VALUES (r.stage, left(initcap(replace(r.stage, '_', ' ')), 40), prox)
          ON CONFLICT (slug) DO NOTHING;
        END IF;
      ELSE
        RAISE NOTICE 'crm_etapas: stage % em % fora do formato de slug; FK dessa tabela entra NOT VALID', r.stage, t;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- 4) Validação por função ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_etapa_valida(_slug text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.crm_etapas WHERE slug = _slug);
$$;

-- 5) Guarda: slug e sistema imutáveis; sistema não apaga/arquiva; arquivar só sem contato ----------------------
CREATE OR REPLACE FUNCTION public.crm_etapas_guarda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n bigint := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.sistema THEN
      RAISE EXCEPTION 'A etapa "%" é padrão do sistema e não pode ser apagada.', OLD.nome USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- só a migration (sem usuário logado) cria etapa de sistema
    IF NEW.sistema AND auth.uid() IS NOT NULL THEN NEW.sistema := false; END IF;
    NEW.nome := btrim(NEW.nome);
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'O identificador da etapa não muda (renomeie pelo nome).' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.sistema IS DISTINCT FROM OLD.sistema THEN
    RAISE EXCEPTION 'A marcação de etapa do sistema não pode ser alterada.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.ativo AND NOT NEW.ativo THEN
    IF OLD.sistema THEN
      RAISE EXCEPTION 'A etapa "%" é padrão do sistema e não pode ser arquivada.', OLD.nome USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*) INTO n FROM public.whatsapp_contacts WHERE stage = OLD.slug;
    IF to_regclass('public.ig_contatos') IS NOT NULL THEN
      n := n + (SELECT count(*) FROM public.ig_contatos WHERE stage = OLD.slug);
    END IF;
    IF n > 0 THEN
      RAISE EXCEPTION 'A etapa "%" tem % contato(s). Mova para outra etapa antes de arquivar.', OLD.nome, n
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.nome := btrim(NEW.nome);
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS crm_etapas_guarda ON public.crm_etapas;
CREATE TRIGGER crm_etapas_guarda BEFORE INSERT OR UPDATE OR DELETE ON public.crm_etapas
FOR EACH ROW EXECUTE FUNCTION public.crm_etapas_guarda();

-- 6) FK (troca a "lista fixa" do código pela tabela) -----------------------------------------------------------
DO $$
DECLARE
  alvos text[][] := ARRAY[
    ARRAY['whatsapp_contacts', 'whatsapp_contacts_stage_fkey'],
    ARRAY['ig_contatos',       'ig_contatos_stage_fkey'],
    ARRAY['crm_roteiros',      'crm_roteiros_stage_fkey']];
  i int;
  tab text;
  nome text;
  orfaos bigint;
BEGIN
  FOR i IN 1 .. array_length(alvos, 1) LOOP
    tab := alvos[i][1];
    nome := alvos[i][2];
    IF to_regclass('public.' || tab) IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = nome AND conrelid = ('public.' || tab)::regclass) THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I t WHERE t.stage IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.crm_etapas e WHERE e.slug = t.stage)', tab)
      INTO orfaos;
    IF orfaos = 0 THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (stage) REFERENCES public.crm_etapas(slug) ON UPDATE RESTRICT ON DELETE RESTRICT', tab, nome);
    ELSE
      RAISE NOTICE 'crm_etapas: % linha(s) de % com stage desconhecido; FK criada NOT VALID', orfaos, tab;
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (stage) REFERENCES public.crm_etapas(slug) ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID', tab, nome);
    END IF;
  END LOOP;
END $$;

-- 7) RLS: aprovados leem, admin edita --------------------------------------------------------------------------
ALTER TABLE public.crm_etapas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Aprovados leem crm_etapas" ON public.crm_etapas;
CREATE POLICY "Aprovados leem crm_etapas" ON public.crm_etapas FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Admin cria crm_etapas" ON public.crm_etapas;
CREATE POLICY "Admin cria crm_etapas" ON public.crm_etapas FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin edita crm_etapas" ON public.crm_etapas;
CREATE POLICY "Admin edita crm_etapas" ON public.crm_etapas FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin apaga crm_etapas" ON public.crm_etapas;
CREATE POLICY "Admin apaga crm_etapas" ON public.crm_etapas FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_etapas TO authenticated;
GRANT ALL ON public.crm_etapas TO service_role;
REVOKE ALL ON public.crm_etapas FROM anon;
GRANT EXECUTE ON FUNCTION public.crm_etapa_valida(text) TO authenticated, service_role;

-- realtime (a tela recarrega quando outro admin edita); ignora se a publicação não existir ou já tiver a tabela
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_etapas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_etapas;
  END IF;
END $$;
