-- =============================================================
-- CRM: permissões por colaborador, atendente e departamentos — PARTE 1 de 2 (estrutura).
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente (pode rodar de novo). Não apaga dado nenhum.
-- A PARTE 2 (20261123110000_crm_permissoes_rls.sql) liga a proteção nas tabelas; rode esta antes.
--
-- O que faz:
--  1) crm_acessos: uma linha por usuário com
--       todos_numeros / numeros (uuid[] de crm_numeros) .... quais números ele enxerga;
--       areas (jsonb: area -> 'nenhum' | 'ver' | 'editar') .. acesso por área do CRM;
--       so_minhas ......................................... só as conversas em que é o atendente (+ sem atendente);
--       so_departamentos .................................. só as conversas dos departamentos dele (+ sem departamento).
--     Admin (user_roles 'admin') ignora a linha: vê e edita tudo. Só admin grava aqui.
--  2) crm_acessos_padrao: o acesso com que nasce o usuário NOVO aprovado (configurável na tela).
--     Padrão: nenhum número e só "ver" em Conversas, até o admin liberar.
--  3) Todo usuário aprovado que JÁ existe ganha acesso total (o mesmo de hoje). Lives e Banco de dados
--     continuam seguindo a liberação que a pessoa já tinha em user_modules ('lives', 'crm-banco').
--  4) Gatilho: usuário aprovado sem linha ganha a do padrão (no momento em que é aprovado).
--  5) Atendente: whatsapp_contacts.atendente_id (uuid do usuário). A coluna antiga `atendente` (texto, nome
--     escrito pelo passo "Atribuir" dos fluxos e pela transferência do robô) continua; quando ela é gravada e
--     a conversa ainda não tem atendente_id, o gatilho resolve o nome para o usuário aprovado com aquele nome
--     (só se houver exatamente um). Preenchimento retroativo: só desse texto, que é atribuição explícita.
--     Mensagem antiga NÃO vira atendente: whatsapp_messages não guarda quem enviou.
--  6) Departamentos = as abas de /crm/conversas e as colunas do Kanban: crm_departamentos (nome, cor, ativo, ordem),
--     membros e números ligados; departamento_id na conversa. Aba fixa "Em atendimento com IA" (regra: IA atendendo,
--     não exclui). Conversa nova entra no departamento do número quando o número é de exatamente um departamento.
--     Sem departamento = todos veem, como hoje. A conversão das etapas do funil em departamentos é a migration
--     20261123120000.
--  7) Funções de checagem (SECURITY DEFINER, STABLE) usadas pelas policies e pelas edge functions, e as RPCs
--     da tela: crm_atendentes, crm_atendente_definir, crm_departamento_definir, crm_atendente_assumir_se_vazio,
--     crm_acesso_conferir, crm_meu_acesso.
-- =============================================================

BEGIN;

-- 0) Áreas do CRM -----------------------------------------------------------------------------------------
-- conversas · kanban (antes "Contatos e funil") · automacao · disparo (Disparo em grupo) · agente_ia · banco
-- (Banco de dados) · base_leads · conexao (Conexão WhatsApp) · configuracoes · lives
CREATE OR REPLACE FUNCTION public.crm_areas()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY['conversas','kanban','automacao','disparo','agente_ia','banco','base_leads','conexao','configuracoes','lives']::text[]
$$;

CREATE OR REPLACE FUNCTION public.crm_areas_validas(_areas jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_typeof(_areas) = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(_areas) e
        WHERE NOT (e.key = ANY (public.crm_areas()))
           OR jsonb_typeof(e.value) <> 'string'
           OR NOT (e.value #>> '{}' = ANY (ARRAY['nenhum','ver','editar']))
     )
$$;

CREATE OR REPLACE FUNCTION public.crm_areas_todas(_nivel text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_object_agg(a, _nivel) FROM unnest(public.crm_areas()) a
$$;

-- Ações dentro das áreas (prefixo = área; só valem com a área em "editar")
CREATE OR REPLACE FUNCTION public.crm_acoes()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY['conversas.enviar','conversas.transferir','conversas.assumir_ia','kanban.mover',
               'agente_ia.editar_prompt','disparo.enviar','conexao.conectar']::text[]
$$;

CREATE OR REPLACE FUNCTION public.crm_acoes_validas(_acoes jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_typeof(_acoes) = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(_acoes) e
        WHERE NOT (e.key = ANY (public.crm_acoes())) OR jsonb_typeof(e.value) <> 'boolean')
$$;

-- 1) Tabelas ----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_acessos (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  todos_numeros    boolean NOT NULL DEFAULT false,
  numeros          uuid[]  NOT NULL DEFAULT '{}',
  areas            jsonb   NOT NULL DEFAULT '{}'::jsonb,
  so_minhas        boolean NOT NULL DEFAULT false,
  so_departamentos boolean NOT NULL DEFAULT false,
  -- ações dentro das áreas (crm_acoes()): ação ausente = liberada quando a área é "editar"
  acoes            jsonb   NOT NULL DEFAULT '{}'::jsonb,
  -- perfil pronto aplicado por último (sdr, closer, cs, admin); a tela compara e mostra "(ajustado)"
  perfil           text,
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_por   uuid,
  CONSTRAINT crm_acessos_areas_validas CHECK (public.crm_areas_validas(areas))
);
ALTER TABLE public.crm_acessos ADD COLUMN IF NOT EXISTS so_departamentos boolean NOT NULL DEFAULT false;
ALTER TABLE public.crm_acessos ADD COLUMN IF NOT EXISTS acoes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.crm_acessos ADD COLUMN IF NOT EXISTS perfil text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_acessos_acoes_validas') THEN
    ALTER TABLE public.crm_acessos ADD CONSTRAINT crm_acessos_acoes_validas CHECK (public.crm_acoes_validas(acoes));
  END IF;
END $$;

-- linha única (id = true) com o acesso do usuário novo
CREATE TABLE IF NOT EXISTS public.crm_acessos_padrao (
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  todos_numeros    boolean NOT NULL DEFAULT false,
  numeros          uuid[]  NOT NULL DEFAULT '{}',
  areas            jsonb   NOT NULL DEFAULT '{"conversas":"ver"}'::jsonb,
  so_minhas        boolean NOT NULL DEFAULT false,
  so_departamentos boolean NOT NULL DEFAULT false,
  acoes            jsonb   NOT NULL DEFAULT '{}'::jsonb,
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_por   uuid,
  CONSTRAINT crm_acessos_padrao_areas_validas CHECK (public.crm_areas_validas(areas))
);
ALTER TABLE public.crm_acessos_padrao ADD COLUMN IF NOT EXISTS acoes jsonb NOT NULL DEFAULT '{}'::jsonb;
INSERT INTO public.crm_acessos_padrao (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.crm_departamentos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 60),
  cor        text NOT NULL DEFAULT '#64748b' CHECK (cor ~ '^#[0-9a-fA-F]{6}$'),
  ativo      boolean NOT NULL DEFAULT true,
  ordem      integer NOT NULL DEFAULT 0,
  -- id do departamento na SellFlux (importação); nulo quando foi criado aqui
  origem_id  text,
  -- 'manual' = conversas com departamento_id dele · 'ia' = IA atendendo (regra automática, sem etiqueta)
  regra      text NOT NULL DEFAULT 'manual' CHECK (regra IN ('manual', 'ia')),
  -- fixo = não pode ser excluído (o "Em atendimento com IA")
  fixo       boolean NOT NULL DEFAULT false,
  -- veio da etapa do funil com este slug (migration 20261123120000): mover para cá também muda a etapa
  etapa_origem text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_departamentos ADD COLUMN IF NOT EXISTS regra text NOT NULL DEFAULT 'manual';
ALTER TABLE public.crm_departamentos ADD COLUMN IF NOT EXISTS fixo boolean NOT NULL DEFAULT false;
ALTER TABLE public.crm_departamentos ADD COLUMN IF NOT EXISTS etapa_origem text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_departamentos_regra_chk') THEN
    ALTER TABLE public.crm_departamentos ADD CONSTRAINT crm_departamentos_regra_chk CHECK (regra IN ('manual', 'ia'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS crm_departamentos_nome_key ON public.crm_departamentos (lower(btrim(nome)));
CREATE UNIQUE INDEX IF NOT EXISTS crm_departamentos_ia_key ON public.crm_departamentos (regra) WHERE regra = 'ia';
CREATE UNIQUE INDEX IF NOT EXISTS crm_departamentos_etapa_key ON public.crm_departamentos (etapa_origem) WHERE etapa_origem IS NOT NULL;

-- Aba fixa "Em atendimento com IA": regra (ai_agent_slug preenchido e não pausado), não exclui.
INSERT INTO public.crm_departamentos (nome, cor, regra, fixo, ordem)
SELECT 'Em atendimento com IA', '#7c3aed', 'ia', true, 0
 WHERE NOT EXISTS (SELECT 1 FROM public.crm_departamentos WHERE regra = 'ia');
UPDATE public.crm_departamentos SET fixo = true WHERE regra = 'ia' AND NOT fixo;

-- departamento fixo não sai e não muda de regra
CREATE OR REPLACE FUNCTION public.crm_departamentos_guarda()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.fixo THEN RAISE EXCEPTION 'o departamento "%" é fixo e não pode ser excluído', OLD.nome USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.fixo AND (NEW.fixo IS DISTINCT FROM OLD.fixo OR NEW.regra IS DISTINCT FROM OLD.regra OR NOT NEW.ativo) THEN
    RAISE EXCEPTION 'o departamento "%" é fixo: só nome e cor mudam', OLD.nome USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_departamentos_guarda ON public.crm_departamentos;
CREATE TRIGGER trg_crm_departamentos_guarda BEFORE UPDATE OR DELETE ON public.crm_departamentos
FOR EACH ROW EXECUTE FUNCTION public.crm_departamentos_guarda();

CREATE TABLE IF NOT EXISTS public.crm_departamento_membros (
  departamento_id uuid NOT NULL REFERENCES public.crm_departamentos(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (departamento_id, user_id)
);
CREATE INDEX IF NOT EXISTS crm_departamento_membros_user_idx ON public.crm_departamento_membros (user_id);

CREATE TABLE IF NOT EXISTS public.crm_departamento_numeros (
  departamento_id uuid NOT NULL REFERENCES public.crm_departamentos(id) ON DELETE CASCADE,
  numero_id       uuid NOT NULL REFERENCES public.crm_numeros(id) ON DELETE CASCADE,
  PRIMARY KEY (departamento_id, numero_id)
);
CREATE INDEX IF NOT EXISTS crm_departamento_numeros_numero_idx ON public.crm_departamento_numeros (numero_id);

-- 2) Colunas na conversa ----------------------------------------------------------------------------------
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS atendente_id uuid;
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS atendente_em timestamptz;
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS departamento_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contacts_atendente_id_fkey') THEN
    ALTER TABLE public.whatsapp_contacts ADD CONSTRAINT whatsapp_contacts_atendente_id_fkey
      FOREIGN KEY (atendente_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contacts_departamento_id_fkey') THEN
    ALTER TABLE public.whatsapp_contacts ADD CONSTRAINT whatsapp_contacts_departamento_id_fkey
      FOREIGN KEY (departamento_id) REFERENCES public.crm_departamentos(id) ON DELETE SET NULL;
  END IF;
END $$;
-- filtro da tela e policy "só as dele" / "só dos departamentos"
CREATE INDEX IF NOT EXISTS whatsapp_contacts_atendente_idx ON public.whatsapp_contacts (atendente_id) WHERE atendente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_contacts_departamento_idx ON public.whatsapp_contacts (departamento_id) WHERE departamento_id IS NOT NULL;
-- leitura da lista por número (policy por número + ORDER BY updated_at)
CREATE INDEX IF NOT EXISTS whatsapp_contacts_numero_updated_idx ON public.whatsapp_contacts (numero_id, updated_at DESC);

-- 3) Funções de checagem ----------------------------------------------------------------------------------
-- Todas: SECURITY DEFINER (leem crm_acessos/user_roles sem depender de RLS), STABLE, search_path fixo.
-- Nas policies são chamadas como (SELECT fn((SELECT auth.uid()))): viram InitPlan, uma vez por consulta.

CREATE OR REPLACE FUNCTION public.crm_eh_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin')
$$;

-- nível numa área: 0 nenhum, 1 ver, 2 editar
CREATE OR REPLACE FUNCTION public.crm_nivel(_uid uuid, _area text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _uid IS NULL THEN 0
    WHEN public.crm_eh_admin(_uid) THEN 2
    WHEN NOT public.is_approved(_uid) THEN 0
    ELSE coalesce((
      SELECT CASE a.areas ->> _area WHEN 'editar' THEN 2 WHEN 'ver' THEN 1 ELSE 0 END
        FROM public.crm_acessos a WHERE a.user_id = _uid), 0)
  END
$$;

-- pode, em PELO MENOS UMA das áreas, no nível pedido?
CREATE OR REPLACE FUNCTION public.crm_pode(_uid uuid, _areas text[], _nivel integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM unnest(_areas) a WHERE public.crm_nivel(_uid, a) >= _nivel)
$$;

-- pode fazer esta ação? área da ação em "editar" e a ação não desligada (ausente = liberada)
CREATE OR REPLACE FUNCTION public.crm_acao(_uid uuid, _acao text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _uid IS NULL OR NOT (_acao = ANY (public.crm_acoes())) THEN false
    WHEN public.crm_eh_admin(_uid) THEN true
    WHEN public.crm_nivel(_uid, split_part(_acao, '.', 1)) < 2 THEN false
    ELSE coalesce((SELECT (a.acoes ->> _acao)::boolean FROM public.crm_acessos a WHERE a.user_id = _uid), true)
  END
$$;

-- números que a pessoa enxerga (admin e "todos os números": todos, inclusive os que forem criados depois)
CREATE OR REPLACE FUNCTION public.crm_numeros_do_usuario(_uid uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _uid IS NULL THEN '{}'::uuid[]
    WHEN public.crm_eh_admin(_uid) THEN ARRAY(SELECT id FROM public.crm_numeros)
    WHEN NOT public.is_approved(_uid) THEN '{}'::uuid[]
    ELSE coalesce((
      SELECT CASE WHEN a.todos_numeros THEN ARRAY(SELECT id FROM public.crm_numeros) ELSE a.numeros END
        FROM public.crm_acessos a WHERE a.user_id = _uid), '{}'::uuid[])
  END
$$;

CREATE OR REPLACE FUNCTION public.crm_todos_numeros(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.crm_eh_admin(_uid)
    OR (public.is_approved(_uid) AND coalesce((SELECT todos_numeros FROM public.crm_acessos WHERE user_id = _uid), false))
  )
$$;

CREATE OR REPLACE FUNCTION public.crm_so_minhas(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.crm_eh_admin(_uid)
     AND coalesce((SELECT so_minhas FROM public.crm_acessos WHERE user_id = _uid), false)
$$;

CREATE OR REPLACE FUNCTION public.crm_so_departamentos(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.crm_eh_admin(_uid)
     AND coalesce((SELECT so_departamentos FROM public.crm_acessos WHERE user_id = _uid), false)
$$;

CREATE OR REPLACE FUNCTION public.crm_meus_departamentos(_uid uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(ARRAY(SELECT departamento_id FROM public.crm_departamento_membros WHERE user_id = _uid), '{}'::uuid[])
$$;

-- vê todas as conversas dos números dele (sem "só as dele" nem "só dos departamentos")
CREATE OR REPLACE FUNCTION public.crm_ve_todas_conversas(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.crm_so_minhas(_uid) AND NOT public.crm_so_departamentos(_uid)
$$;

-- vê tudo de contato: todos os números e todas as conversas (atalho das policies por telefone)
CREATE OR REPLACE FUNCTION public.crm_ve_tudo(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.crm_todos_numeros(_uid) AND public.crm_ve_todas_conversas(_uid)
$$;

-- o número padrão (closer) está entre os dele? (linhas de fila/log com numero_id nulo são do padrão)
CREATE OR REPLACE FUNCTION public.crm_padrao_permitido(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.crm_numero_padrao_id() = ANY (public.crm_numeros_do_usuario(_uid))
$$;

-- Uma conversa (número + telefone) está ao alcance desta pessoa? _nivel 1 = ver, 2 = editar.
-- Área: Conversas ou Kanban. Número: entre os dele (nulo = padrão). "Só as dele" e
-- "só dos departamentos" valem para conversa que já existe; conversa nova (sem contato) passa.
CREATE OR REPLACE FUNCTION public.crm_conversa_pode(_uid uuid, _numero_id uuid, _phone text, _nivel integer)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nums uuid[];
  v_minhas boolean;
  v_deps boolean;
  v_meus uuid[];
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  IF public.crm_eh_admin(_uid) THEN RETURN true; END IF;
  IF NOT public.crm_pode(_uid, ARRAY['conversas','kanban'], _nivel) THEN RETURN false; END IF;
  v_nums := public.crm_numeros_do_usuario(_uid);
  v_minhas := public.crm_so_minhas(_uid);
  v_deps := public.crm_so_departamentos(_uid);
  v_meus := public.crm_meus_departamentos(_uid);
  IF _numero_id IS NOT NULL THEN
    IF NOT (_numero_id = ANY (v_nums)) THEN RETURN false; END IF;
    IF _phone IS NULL THEN RETURN true; END IF;
    RETURN NOT EXISTS (
      SELECT 1 FROM public.whatsapp_contacts c
       WHERE c.numero_id = _numero_id AND c.phone = _phone
         AND ((v_minhas AND c.atendente_id IS NOT NULL AND c.atendente_id <> _uid)
           OR (v_deps AND c.departamento_id IS NOT NULL AND NOT (c.departamento_id = ANY (v_meus))))
    );
  END IF;
  -- sem número: as funções antigas agem em TODAS as conversas daquele telefone; precisa alcançar todas
  IF _phone IS NULL THEN RETURN false; END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM public.whatsapp_contacts c
     WHERE c.phone = _phone
       AND (NOT (c.numero_id = ANY (v_nums))
         OR (v_minhas AND c.atendente_id IS NOT NULL AND c.atendente_id <> _uid)
         OR (v_deps AND c.departamento_id IS NOT NULL AND NOT (c.departamento_id = ANY (v_meus))))
  );
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'crm_eh_admin(uuid)', 'crm_nivel(uuid,text)', 'crm_pode(uuid,text[],integer)', 'crm_acao(uuid,text)', 'crm_numeros_do_usuario(uuid)',
    'crm_todos_numeros(uuid)', 'crm_so_minhas(uuid)', 'crm_so_departamentos(uuid)', 'crm_meus_departamentos(uuid)',
    'crm_ve_todas_conversas(uuid)', 'crm_ve_tudo(uuid)', 'crm_padrao_permitido(uuid)',
    'crm_conversa_pode(uuid,uuid,text,integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- 4) Seed: quem já está aprovado começa com o acesso de hoje ---------------------------------------------
-- Lives e Banco de dados já tinham liberação própria (user_modules): o nível inicial segue ela.
INSERT INTO public.crm_acessos (user_id, todos_numeros, numeros, areas, so_minhas, so_departamentos)
SELECT p.id, true, '{}',
       public.crm_areas_todas('editar')
         || jsonb_build_object(
              'lives', CASE WHEN EXISTS (SELECT 1 FROM public.user_modules m WHERE m.user_id = p.id AND m.module = 'lives') THEN 'editar' ELSE 'nenhum' END,
              'banco', CASE WHEN EXISTS (SELECT 1 FROM public.user_modules m WHERE m.user_id = p.id AND m.module = 'crm-banco') THEN 'editar' ELSE 'nenhum' END),
       false, false
  FROM public.profiles p
 WHERE p.approved
   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
ON CONFLICT (user_id) DO NOTHING;

-- 5) Usuário aprovado depois disto: nasce com o padrão ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_acessos_ao_aprovar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.approved AND (TG_OP = 'INSERT' OR OLD.approved IS DISTINCT FROM true) THEN
    INSERT INTO public.crm_acessos (user_id, todos_numeros, numeros, areas, so_minhas, so_departamentos, acoes)
    SELECT NEW.id, d.todos_numeros, d.numeros, d.areas, d.so_minhas, d.so_departamentos, d.acoes
      FROM public.crm_acessos_padrao d WHERE d.id
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'crm_acessos_ao_aprovar: %', SQLERRM; -- nunca derruba a aprovação
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_acessos_ao_aprovar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_crm_acessos_ao_aprovar ON public.profiles;
CREATE TRIGGER trg_crm_acessos_ao_aprovar AFTER INSERT OR UPDATE OF approved ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.crm_acessos_ao_aprovar();

-- 6) Atendente e departamento na conversa: validação e herança -----------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_contato_atendente_guarda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v uuid;
  n integer;
BEGIN
  -- atendente_id só aponta para usuário aprovado
  IF NEW.atendente_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.atendente_id IS DISTINCT FROM OLD.atendente_id)
     AND NOT public.is_approved(NEW.atendente_id) THEN
    RAISE EXCEPTION 'atendente precisa ser um usuário aprovado' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.atendente_id IS DISTINCT FROM OLD.atendente_id THEN
    NEW.atendente_em := CASE WHEN NEW.atendente_id IS NULL THEN NULL ELSE now() END;
  END IF;
  -- nome gravado pelo fluxo/robô (coluna antiga `atendente`): vira atendente_id se a conversa ainda não tem
  IF NEW.atendente_id IS NULL AND coalesce(btrim(NEW.atendente), '') <> ''
     AND (TG_OP = 'INSERT' OR NEW.atendente IS DISTINCT FROM OLD.atendente) THEN
    SELECT min(p.id::text)::uuid, count(*) INTO v, n FROM public.profiles p
     WHERE p.approved AND lower(btrim(p.full_name)) = lower(btrim(NEW.atendente));
    IF n = 1 THEN
      NEW.atendente_id := v;
      NEW.atendente_em := now();
    END IF;
  END IF;
  -- conversa nova sem departamento: o do número, se o número é de exatamente um departamento ativo
  IF TG_OP = 'INSERT' AND NEW.departamento_id IS NULL AND NEW.numero_id IS NOT NULL THEN
    SELECT min(dn.departamento_id::text)::uuid, count(*) INTO v, n
      FROM public.crm_departamento_numeros dn
      JOIN public.crm_departamentos d ON d.id = dn.departamento_id AND d.ativo AND d.regra = 'manual'
     WHERE dn.numero_id = NEW.numero_id;
    IF n = 1 THEN NEW.departamento_id := v; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_contato_atendente_guarda() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_crm_contato_atendente_guarda ON public.whatsapp_contacts;
CREATE TRIGGER trg_crm_contato_atendente_guarda
BEFORE INSERT OR UPDATE OF atendente_id, atendente ON public.whatsapp_contacts
FOR EACH ROW EXECUTE FUNCTION public.crm_contato_atendente_guarda();

-- retroativo, só do dado confiável: nome atribuído pelo fluxo/robô que casa com UM usuário aprovado
UPDATE public.whatsapp_contacts c
   SET atendente_id = x.id, atendente_em = now()
  FROM (
    SELECT lower(btrim(full_name)) AS nome, min(id::text)::uuid AS id
      FROM public.profiles WHERE approved AND btrim(full_name) <> ''
     GROUP BY 1 HAVING count(*) = 1
  ) x
 WHERE c.atendente_id IS NULL AND coalesce(btrim(c.atendente), '') <> '' AND lower(btrim(c.atendente)) = x.nome;

CREATE OR REPLACE FUNCTION public.crm_departamentos_tocar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_departamentos_tocar ON public.crm_departamentos;
CREATE TRIGGER trg_crm_departamentos_tocar BEFORE UPDATE ON public.crm_departamentos
FOR EACH ROW EXECUTE FUNCTION public.crm_departamentos_tocar();

-- 7) RLS das tabelas novas -------------------------------------------------------------------------------
ALTER TABLE public.crm_acessos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_acessos_padrao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_departamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_departamento_membros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_departamento_numeros ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_acessos, public.crm_acessos_padrao, public.crm_departamentos,
              public.crm_departamento_membros, public.crm_departamento_numeros FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_acessos, public.crm_acessos_padrao, public.crm_departamentos,
              public.crm_departamento_membros, public.crm_departamento_numeros TO authenticated;
GRANT ALL ON public.crm_acessos, public.crm_acessos_padrao, public.crm_departamentos,
              public.crm_departamento_membros, public.crm_departamento_numeros TO service_role;

-- crm_acessos: cada um lê o seu; admin lê e grava todos
DROP POLICY IF EXISTS "crm_acessos: ler o proprio" ON public.crm_acessos;
CREATE POLICY "crm_acessos: ler o proprio" ON public.crm_acessos FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "crm_acessos: admin" ON public.crm_acessos;
CREATE POLICY "crm_acessos: admin" ON public.crm_acessos FOR ALL TO authenticated
  USING ((SELECT public.crm_eh_admin((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.crm_eh_admin((SELECT auth.uid()))));

DROP POLICY IF EXISTS "crm_acessos_padrao: admin" ON public.crm_acessos_padrao;
CREATE POLICY "crm_acessos_padrao: admin" ON public.crm_acessos_padrao FOR ALL TO authenticated
  USING ((SELECT public.crm_eh_admin((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.crm_eh_admin((SELECT auth.uid()))));

-- departamentos: aprovado lê (filtro e cabeçalho da conversa); só admin cria, edita e apaga
DROP POLICY IF EXISTS "crm_departamentos: aprovados leem" ON public.crm_departamentos;
CREATE POLICY "crm_departamentos: aprovados leem" ON public.crm_departamentos FOR SELECT TO authenticated
  USING ((SELECT public.is_approved((SELECT auth.uid()))));
DROP POLICY IF EXISTS "crm_departamentos: admin" ON public.crm_departamentos;
CREATE POLICY "crm_departamentos: admin" ON public.crm_departamentos FOR ALL TO authenticated
  USING ((SELECT public.crm_eh_admin((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.crm_eh_admin((SELECT auth.uid()))));

DROP POLICY IF EXISTS "crm_departamento_membros: aprovados leem" ON public.crm_departamento_membros;
CREATE POLICY "crm_departamento_membros: aprovados leem" ON public.crm_departamento_membros FOR SELECT TO authenticated
  USING ((SELECT public.is_approved((SELECT auth.uid()))));
DROP POLICY IF EXISTS "crm_departamento_membros: admin" ON public.crm_departamento_membros;
CREATE POLICY "crm_departamento_membros: admin" ON public.crm_departamento_membros FOR ALL TO authenticated
  USING ((SELECT public.crm_eh_admin((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.crm_eh_admin((SELECT auth.uid()))));

DROP POLICY IF EXISTS "crm_departamento_numeros: aprovados leem" ON public.crm_departamento_numeros;
CREATE POLICY "crm_departamento_numeros: aprovados leem" ON public.crm_departamento_numeros FOR SELECT TO authenticated
  USING ((SELECT public.is_approved((SELECT auth.uid()))));
DROP POLICY IF EXISTS "crm_departamento_numeros: admin" ON public.crm_departamento_numeros;
CREATE POLICY "crm_departamento_numeros: admin" ON public.crm_departamento_numeros FOR ALL TO authenticated
  USING ((SELECT public.crm_eh_admin((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.crm_eh_admin((SELECT auth.uid()))));

-- 8) RPCs da tela ------------------------------------------------------------------------------------------
-- Meu acesso (o front esconde menu e trava o que é "ver"; quem barra de verdade são as policies).
CREATE OR REPLACE FUNCTION public.crm_meu_acesso()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'admin', public.crm_eh_admin(auth.uid()),
    'areas', (SELECT jsonb_object_agg(a, CASE public.crm_nivel(auth.uid(), a) WHEN 2 THEN 'editar' WHEN 1 THEN 'ver' ELSE 'nenhum' END)
                FROM unnest(public.crm_areas()) a),
    'todos_numeros', public.crm_todos_numeros(auth.uid()),
    'numeros', to_jsonb(public.crm_numeros_do_usuario(auth.uid())),
    'so_minhas', public.crm_so_minhas(auth.uid()),
    'so_departamentos', public.crm_so_departamentos(auth.uid()),
    'departamentos', to_jsonb(public.crm_meus_departamentos(auth.uid())),
    'acoes', (SELECT jsonb_object_agg(x, public.crm_acao(auth.uid(), x)) FROM unnest(public.crm_acoes()) x)
  )
$$;
REVOKE ALL ON FUNCTION public.crm_meu_acesso() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_meu_acesso() TO authenticated;

-- Colaboradores que podem ser atendente (perfis aprovados), para o filtro e o cabeçalho.
CREATE OR REPLACE FUNCTION public.crm_atendentes()
RETURNS TABLE (id uuid, nome text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, coalesce(nullif(btrim(p.full_name), ''), 'Sem nome')
    FROM public.profiles p
   WHERE p.approved AND public.is_approved(auth.uid())
   ORDER BY 2, 1
$$;
REVOKE ALL ON FUNCTION public.crm_atendentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_atendentes() TO authenticated;

-- Conferência para as edge functions (com o JWT de quem chamou): pode agir nesta área / conversa?
CREATE OR REPLACE FUNCTION public.crm_acesso_conferir(p_area text, p_nivel integer, p_numero_id uuid DEFAULT NULL, p_phone text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN RETURN true; END IF;
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF p_area = 'conversa' THEN
    RETURN public.crm_conversa_pode(auth.uid(), coalesce(p_numero_id, public.crm_numero_padrao_id()), p_phone, coalesce(p_nivel, 2));
  END IF;
  IF NOT (p_area = ANY (public.crm_areas())) THEN RETURN false; END IF;
  IF NOT public.crm_pode(auth.uid(), ARRAY[p_area], coalesce(p_nivel, 2)) THEN RETURN false; END IF;
  IF p_numero_id IS NOT NULL AND NOT (p_numero_id = ANY (public.crm_numeros_do_usuario(auth.uid()))) THEN RETURN false; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_acesso_conferir(text, integer, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_acesso_conferir(text, integer, uuid, text) TO authenticated, service_role;

-- Ação ligada para quem chamou? (edge functions: enviar, conectar, disparar...)
CREATE OR REPLACE FUNCTION public.crm_acao_minha(p_acao text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(auth.role(), '') = 'service_role' OR public.crm_acao(auth.uid(), p_acao)
$$;
REVOKE ALL ON FUNCTION public.crm_acao_minha(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_acao_minha(text) TO authenticated, service_role;

-- Mensagem manual pelo CRM: quem mandou vira o atendente, SE a conversa ainda não tem. Nunca troca sozinho.
CREATE OR REPLACE FUNCTION public.crm_atendente_assumir_se_vazio(p_numero_id uuid, p_phone text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved(auth.uid()) THEN RETURN false; END IF;
  IF NOT public.crm_conversa_pode(auth.uid(), coalesce(p_numero_id, public.crm_numero_padrao_id()), p_phone, 2) THEN RETURN false; END IF;
  UPDATE public.whatsapp_contacts SET atendente_id = auth.uid()
   WHERE numero_id = coalesce(p_numero_id, public.crm_numero_padrao_id()) AND phone = p_phone AND atendente_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_atendente_assumir_se_vazio(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_atendente_assumir_se_vazio(uuid, text) TO authenticated;

-- Troca/tira o atendente à mão (cabeçalho da conversa). Quem tem "só as dele" só pode pegar para si ou soltar.
CREATE OR REPLACE FUNCTION public.crm_atendente_definir(p_contato_id uuid, p_atendente_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sem login' USING ERRCODE = '42501'; END IF;
  SELECT id, numero_id, phone INTO c FROM public.whatsapp_contacts WHERE id = p_contato_id;
  IF c.id IS NULL OR NOT public.crm_conversa_pode(auth.uid(), c.numero_id, c.phone, 2) THEN
    RAISE EXCEPTION 'sem permissão nesta conversa' USING ERRCODE = '42501';
  END IF;
  IF p_atendente_id IS NOT NULL AND p_atendente_id <> auth.uid() AND public.crm_so_minhas(auth.uid()) THEN
    RAISE EXCEPTION 'você só pode pegar a conversa para você ou soltar' USING ERRCODE = '42501';
  END IF;
  -- passar para outra pessoa é "transferir"
  IF p_atendente_id IS NOT NULL AND p_atendente_id <> auth.uid() AND NOT public.crm_acao(auth.uid(), 'conversas.transferir') THEN
    RAISE EXCEPTION 'sem permissão para transferir conversa' USING ERRCODE = '42501';
  END IF;
  IF p_atendente_id IS NOT NULL AND NOT public.is_approved(p_atendente_id) THEN
    RAISE EXCEPTION 'atendente precisa ser um usuário aprovado' USING ERRCODE = '23514';
  END IF;
  UPDATE public.whatsapp_contacts SET atendente_id = p_atendente_id WHERE id = c.id;
  RETURN p_atendente_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_atendente_definir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_atendente_definir(uuid, uuid) TO authenticated;

-- Troca/tira o departamento à mão. Quem tem "só dos departamentos" só move para um departamento dele (ou tira).
CREATE OR REPLACE FUNCTION public.crm_departamento_definir(p_contato_id uuid, p_departamento_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sem login' USING ERRCODE = '42501'; END IF;
  SELECT id, numero_id, phone INTO c FROM public.whatsapp_contacts WHERE id = p_contato_id;
  IF c.id IS NULL OR NOT public.crm_conversa_pode(auth.uid(), c.numero_id, c.phone, 2) THEN
    RAISE EXCEPTION 'sem permissão nesta conversa' USING ERRCODE = '42501';
  END IF;
  IF p_departamento_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.crm_departamentos WHERE id = p_departamento_id AND ativo AND regra = 'manual') THEN
    RAISE EXCEPTION 'departamento não existe, está desativado ou é automático (IA/etapa)' USING ERRCODE = 'P0002';
  END IF;
  -- mover de departamento: "mover card" (Kanban) ou "transferir" (Conversas)
  IF NOT (public.crm_acao(auth.uid(), 'kanban.mover') OR public.crm_acao(auth.uid(), 'conversas.transferir')) THEN
    RAISE EXCEPTION 'sem permissão para mover a conversa de departamento' USING ERRCODE = '42501';
  END IF;
  IF p_departamento_id IS NOT NULL AND public.crm_so_departamentos(auth.uid())
     AND NOT (p_departamento_id = ANY (public.crm_meus_departamentos(auth.uid()))) THEN
    RAISE EXCEPTION 'você só pode mover para um departamento seu' USING ERRCODE = '42501';
  END IF;
  -- departamento que veio de uma etapa do funil: a etapa acompanha (automações de "mudou de etapa" seguem valendo)
  UPDATE public.whatsapp_contacts w
     SET departamento_id = p_departamento_id,
         stage = coalesce((SELECT d.etapa_origem FROM public.crm_departamentos d
                            JOIN public.crm_etapas e ON e.slug = d.etapa_origem AND e.ativo
                           WHERE d.id = p_departamento_id), w.stage)
   WHERE w.id = c.id;
  RETURN p_departamento_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_departamento_definir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_departamento_definir(uuid, uuid) TO authenticated;

-- Importar/cadastrar departamentos em lote (lista da SellFlux): [{nome, cor?, ativo?, origem_id?}].
-- Casa pelo nome (sem caixa/espaço); não apaga nenhum que já existe. Só admin.
CREATE OR REPLACE FUNCTION public.crm_departamentos_importar(p_lista jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  IF NOT public.crm_eh_admin(auth.uid()) THEN RAISE EXCEPTION 'só admin' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_lista) <> 'array' THEN RAISE EXCEPTION 'lista inválida' USING ERRCODE = '22023'; END IF;
  FOR r IN
    SELECT btrim(x.nome) AS nome,
           CASE WHEN coalesce(x.cor, '') ~ '^#[0-9a-fA-F]{6}$' THEN x.cor END AS cor,
           coalesce(x.ativo, true) AS ativo,
           nullif(btrim(coalesce(x.origem_id, '')), '') AS origem_id
      FROM jsonb_to_recordset(p_lista) AS x(nome text, cor text, ativo boolean, origem_id text)
     WHERE length(btrim(coalesce(x.nome, ''))) BETWEEN 1 AND 60
  LOOP
    UPDATE public.crm_departamentos
       SET cor = coalesce(r.cor, cor), ativo = r.ativo, origem_id = coalesce(r.origem_id, origem_id)
     WHERE lower(btrim(nome)) = lower(r.nome);
    IF NOT FOUND THEN
      INSERT INTO public.crm_departamentos (nome, cor, ativo, origem_id, ordem)
      VALUES (r.nome, coalesce(r.cor, '#64748b'), r.ativo, r.origem_id,
              coalesce((SELECT max(ordem) FROM public.crm_departamentos), 0) + 10);
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_departamentos_importar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_departamentos_importar(jsonb) TO authenticated;

-- "HUMANO ASSUME DAQUI" / "Assumir (humano)": pausa a IA com motivo 'humano' (como antes) e quem clicou vira o
-- atendente (clique explícito: troca mesmo se havia outro). Evento no histórico com o nome de quem assumiu.
CREATE OR REPLACE FUNCTION public.crm_ai_assumir(p_numero_id uuid, p_phone text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_slug text;
  v_nome text;
BEGIN
  IF NOT public.crm_ai_pode() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  IF coalesce(auth.role(), '') <> 'service_role' AND (
       NOT public.crm_conversa_pode(auth.uid(), p_numero_id, p_phone, 2)
       OR NOT public.crm_acao(auth.uid(), 'conversas.assumir_ia')) THEN
    RAISE EXCEPTION 'sem permissão para assumir esta conversa' USING ERRCODE = '42501';
  END IF;
  SELECT ai_agent_slug INTO v_slug FROM public.whatsapp_contacts
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id) LIMIT 1;
  UPDATE public.whatsapp_contacts
     SET ai_pausado = true, ai_pausado_motivo = 'humano', ai_precisa_humano = false, updated_at = now(),
         atendente_id = coalesce(auth.uid(), atendente_id)
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id);
  UPDATE public.crm_ai_fila SET status = 'ignorado', motivo = 'humano assumiu', updated_at = now()
   WHERE contact_phone = p_phone AND status = 'pendente'
     AND (p_numero_id IS NULL OR numero_id = p_numero_id);
  SELECT nullif(btrim(full_name), '') INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.crm_ai_eventos (contact_phone, numero_id, agent_slug, tipo, detalhe, usuario_id)
  VALUES (p_phone, p_numero_id, v_slug, 'assumido_humano',
          coalesce(v_nome, 'Humano') || ' assumiu: IA pausada (atendimento humano)', auth.uid());
  RETURN 'ok';
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_ai_assumir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ai_assumir(uuid, text) TO authenticated, service_role;

-- Lives e Banco de dados: a tela grava o nível e mantém a liberação antiga (user_modules) igual a ele.
CREATE OR REPLACE FUNCTION public.crm_acessos_sincronizar_modulos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  par text[];
BEGIN
  FOREACH par SLICE 1 IN ARRAY ARRAY[ARRAY['lives','lives'], ARRAY['banco','crm-banco']] LOOP
    IF coalesce(NEW.areas ->> par[1], 'nenhum') = 'nenhum' THEN
      DELETE FROM public.user_modules WHERE user_id = NEW.user_id AND module = par[2];
    ELSE
      INSERT INTO public.user_modules (user_id, module)
      SELECT NEW.user_id, par[2]
       WHERE NOT EXISTS (SELECT 1 FROM public.user_modules WHERE user_id = NEW.user_id AND module = par[2]);
    END IF;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- ex.: o gatilho que protege o acesso do dono recusou; o nível do CRM continua gravado
  RAISE WARNING 'crm_acessos_sincronizar_modulos: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_acessos_sincronizar_modulos() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_crm_acessos_sincronizar_modulos ON public.crm_acessos;
CREATE TRIGGER trg_crm_acessos_sincronizar_modulos AFTER INSERT OR UPDATE OF areas ON public.crm_acessos
FOR EACH ROW EXECUTE FUNCTION public.crm_acessos_sincronizar_modulos();

CREATE OR REPLACE FUNCTION public.crm_acessos_carimbar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.atualizado_em := now();
  NEW.atualizado_por := auth.uid();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_acessos_carimbar ON public.crm_acessos;
CREATE TRIGGER trg_crm_acessos_carimbar BEFORE INSERT OR UPDATE ON public.crm_acessos
FOR EACH ROW EXECUTE FUNCTION public.crm_acessos_carimbar();
DROP TRIGGER IF EXISTS trg_crm_acessos_padrao_carimbar ON public.crm_acessos_padrao;
CREATE TRIGGER trg_crm_acessos_padrao_carimbar BEFORE INSERT OR UPDATE ON public.crm_acessos_padrao
FOR EACH ROW EXECUTE FUNCTION public.crm_acessos_carimbar();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferir:
--   SELECT p.full_name, a.perfil, a.todos_numeros, a.areas, a.acoes, a.so_minhas FROM crm_acessos a JOIN profiles p ON p.id = a.user_id;
--   SELECT * FROM crm_acessos_padrao;
--   SELECT count(*) FILTER (WHERE atendente_id IS NOT NULL) AS com_atendente FROM whatsapp_contacts;
