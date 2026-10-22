-- =============================================================
-- CRM: as etapas do funil viram departamentos (Kanban = departamentos) — PARTE C.
-- Rodar no SQL editor do Lovable Cloud DEPOIS das partes 1 e 2 (20261123100000 e 20261123110000).
-- Idempotente. Não apaga dado: crm_etapas e whatsapp_contacts.stage ficam como estão.
--
-- O que faz:
--  1) Cada etapa de crm_etapas (Leads, Em Contato, Agendado...) vira um departamento com o mesmo nome, cor e
--     ordem, marcado com etapa_origem = slug. Se já existe departamento com o mesmo nome, só liga a etapa a ele.
--  2) A etapa de cada conversa individual vira o departamento dela (só onde departamento_id ainda está vazio;
--     grupos @g.us ficam sem departamento).
--  3) Daqui pra frente as duas andam juntas, nos dois sentidos:
--       - conversa nova sem departamento entra no departamento da etapa dela (depois da regra do número);
--       - automação/fluxo/tela que muda a etapa leva a conversa ao departamento daquela etapa, se ela está
--         sem departamento ou num departamento que também veio de etapa (Comercial/Suporte manuais não mudam);
--       - mover para um departamento que veio de etapa muda a etapa (crm_departamento_definir, parte 1).
-- =============================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.crm_departamentos') IS NULL OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'crm_departamentos' AND column_name = 'etapa_origem') THEN
    RAISE EXCEPTION 'rode antes a parte 1: 20261123100000_crm_permissoes_estrutura.sql';
  END IF;
END $$;

-- 1) etapa -> departamento -----------------------------------------------------------------------------------
-- já existe com o mesmo nome (ex.: a lista importada da SellFlux tem "Leads"): só liga
UPDATE public.crm_departamentos d
   SET etapa_origem = e.slug
  FROM public.crm_etapas e
 WHERE d.etapa_origem IS NULL AND d.regra = 'manual'
   AND lower(btrim(d.nome)) = lower(btrim(e.nome))
   AND NOT EXISTS (SELECT 1 FROM public.crm_departamentos x WHERE x.etapa_origem = e.slug);

INSERT INTO public.crm_departamentos (nome, cor, ativo, ordem, etapa_origem, regra)
SELECT e.nome, e.cor, e.ativo, 100 + e.ordem * 10, e.slug, 'manual'
  FROM public.crm_etapas e
 WHERE NOT EXISTS (SELECT 1 FROM public.crm_departamentos d WHERE d.etapa_origem = e.slug)
   AND NOT EXISTS (SELECT 1 FROM public.crm_departamentos d WHERE lower(btrim(d.nome)) = lower(btrim(e.nome)))
 ORDER BY e.ordem;

-- 2) etapa de cada conversa -> departamento (só onde está vazio; grupo não entra) -------------------------------
UPDATE public.whatsapp_contacts c
   SET departamento_id = d.id
  FROM public.crm_departamentos d
 WHERE c.departamento_id IS NULL
   AND coalesce(c.is_group, false) = false AND c.phone NOT LIKE '%@g.us'
   AND d.etapa_origem = c.stage;

-- 3) etapa e departamento andam juntos -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_contato_departamento_da_etapa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v uuid;
BEGIN
  IF coalesce(NEW.is_group, false) OR NEW.phone LIKE '%@g.us' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.departamento_id IS NOT NULL THEN RETURN NEW; END IF;
  ELSE
    IF NEW.stage IS NOT DISTINCT FROM OLD.stage THEN RETURN NEW; END IF;
    -- departamento trocado no mesmo UPDATE (arrastar no Kanban / crm_departamento_definir): ele manda
    IF NEW.departamento_id IS DISTINCT FROM OLD.departamento_id THEN RETURN NEW; END IF;
    -- manual (Comercial, Suporte...) não sai por mudança de etapa
    IF NEW.departamento_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.crm_departamentos WHERE id = NEW.departamento_id AND etapa_origem IS NOT NULL) THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT id INTO v FROM public.crm_departamentos WHERE etapa_origem = NEW.stage AND ativo;
  IF v IS NOT NULL THEN NEW.departamento_id := v; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_contato_departamento_da_etapa() FROM PUBLIC, anon, authenticated;
-- nome depois de trg_crm_contato_atendente_guarda (os BEFORE rodam em ordem alfabética): a regra do número vem antes
DROP TRIGGER IF EXISTS trg_crm_contato_departamento_da_etapa ON public.whatsapp_contacts;
CREATE TRIGGER trg_crm_contato_departamento_da_etapa
BEFORE INSERT OR UPDATE OF stage ON public.whatsapp_contacts
FOR EACH ROW EXECUTE FUNCTION public.crm_contato_departamento_da_etapa();

-- Kanban: colunas paginadas por departamento, na ordem de updated_at
CREATE INDEX IF NOT EXISTS whatsapp_contacts_departamento_updated_idx
  ON public.whatsapp_contacts (departamento_id, updated_at DESC) WHERE NOT is_group;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferir:
--   SELECT nome, etapa_origem, regra, fixo, ordem FROM crm_departamentos ORDER BY ordem;
--   SELECT d.nome, count(*) FROM whatsapp_contacts c LEFT JOIN crm_departamentos d ON d.id = c.departamento_id
--    WHERE NOT c.is_group GROUP BY 1 ORDER BY 2 DESC;
