-- Acesso "Comercial" + quem altera acessos + acesso do dono travado.
-- (cópia em supabase/migrations/20261013200000_acesso_comercial.sql)
--
-- O que faz, em ordem:
--  1. dono_do_sistema(): o id do Breno, achado pelo e-mail em auth.users na
--     hora de rodar e gravado na função. Se não achar, o script PARA e nada muda.
--  2. Módulo "comercial" = área Monitoramento das Consultas inteira (/vendas,
--     /vendas/funil, /vendas/microinfluencia, /balanco-mensal, /anual,
--     /respostas). Substitui as liberações antigas "vendas", "mensal" e
--     "anual": quem tinha qualquer uma delas, e todo admin, ganha "comercial";
--     as linhas antigas são guardadas em public.user_modules_legado_comercial
--     e depois apagadas (a tela não as oferece mais).
--  3. RLS das tabelas da área, por policy RESTRITIVA (soma "E" com as que já
--     existem; não precisa saber o nome delas):
--       consultations ......... ver: admin, comercial — e, pra não quebrar o
--                               que já usa a tabela fora da área: alunas
--                               (lembretes de sinal na Gestão de Alunas),
--                               financeiro (detalhe de vendas do Dash
--                               Financeiro), agenda-alunas (cobrança de
--                               restante na agenda) e quem tem uma tarefa
--                               ligada àquela consulta.
--                               alterar: admin, comercial, alunas, agenda-alunas
--                               e o dono da tarefa ligada à consulta.
--                               criar e apagar: só admin ou comercial.
--       lead_form_responses ... ler/alterar/apagar: admin ou comercial
--                               (o envio público do formulário continua aberto).
--       lead_recovery ......... tudo: admin ou comercial.
--  4. user_modules / user_roles: só admin escreve (policy restritiva), e
--     qualquer admin escreve para os outros.
--  5. Gatilho: ninguém remove módulo, admin ou aprovação do dono, nem apaga a
--     conta dele — nem outro admin, nem o editor SQL. E ninguém tira o
--     próprio admin pelo app.
--  6. delete_user(): passa a exigir admin (antes qualquer pessoa logada podia
--     chamar) e recusa apagar o dono. O corpo antigo é preservado.
--  7. Relatório no fim: quem tem "comercial" e por quê.
--
-- Idempotente: pode rodar de novo; não duplica nada.

BEGIN;

-- 1. Dono do sistema ---------------------------------------------------------
-- Acha o id pelo e-mail AGORA e grava esse id dentro da função. Assim a
-- proteção não depende do e-mail continuar igual nem da linha em auth.users
-- (ao apagar a conta, a cascata já não enxerga mais o e-mail).
DO $$
DECLARE
  v uuid;
BEGIN
  SELECT id INTO v FROM auth.users
  WHERE lower(email) = 'exemplo@dominio.com'
  ORDER BY created_at
  LIMIT 1;
  IF v IS NULL THEN
    RAISE EXCEPTION 'Nao achei o usuario exemplo@dominio.com em auth.users. Nada foi alterado.';
  END IF;
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.dono_do_sistema() RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path = public AS %L',
    'SELECT ' || quote_literal(v) || '::uuid'
  );
END $$;
REVOKE ALL ON FUNCTION public.dono_do_sistema() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dono_do_sistema() TO authenticated, service_role;

-- O dono é admin e aprovado (normalmente já é; isto só garante).
INSERT INTO public.user_roles (user_id, role)
SELECT public.dono_do_sistema(), 'admin'::public.app_role
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles WHERE user_id = public.dono_do_sistema() AND role = 'admin'
);
UPDATE public.profiles SET approved = true
WHERE id = public.dono_do_sistema() AND approved IS DISTINCT FROM true;

-- 2. Funções de acesso -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_module(_user_id uuid, _module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_modules WHERE user_id = _user_id AND module = _module)
$$;

-- Área Comercial: admin ou liberação "comercial".
CREATE OR REPLACE FUNCTION public.pode_comercial(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND (
    public.has_role(_user_id, 'admin') OR public.has_module(_user_id, 'comercial')
  )
$$;

-- Ler consultas: a área Comercial + os módulos que já mostram consulta hoje.
CREATE OR REPLACE FUNCTION public.pode_ver_consultas(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.pode_comercial(_user_id) OR EXISTS (
    SELECT 1 FROM public.user_modules
    WHERE user_id = _user_id AND module IN ('alunas', 'financeiro', 'agenda-alunas')
  )
$$;

-- Alterar consultas: Comercial + quem marca sinal/restante pago fora da área.
CREATE OR REPLACE FUNCTION public.pode_alterar_consultas(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.pode_comercial(_user_id) OR EXISTS (
    SELECT 1 FROM public.user_modules
    WHERE user_id = _user_id AND module IN ('alunas', 'agenda-alunas')
  )
$$;

-- A pessoa tem na agenda uma tarefa ligada a esta consulta (cobrança de restante).
CREATE OR REPLACE FUNCTION public.tem_tarefa_da_consulta(_user_id uuid, _consulta uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.collaborator_tasks
    WHERE user_id = _user_id AND metadata->>'consultationId' = _consulta::text
  )
$$;

REVOKE ALL ON FUNCTION public.pode_comercial(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pode_ver_consultas(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pode_alterar_consultas(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tem_tarefa_da_consulta(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_comercial(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pode_ver_consultas(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pode_alterar_consultas(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tem_tarefa_da_consulta(uuid, uuid) TO authenticated, service_role;

-- 3. Liberação "comercial" para quem já usa a área ---------------------------
-- Cópia das liberações antigas antes de apagá-las (dá pra desfazer daqui).
CREATE TABLE IF NOT EXISTS public.user_modules_legado_comercial (
  user_id uuid NOT NULL,
  module text NOT NULL,
  guardado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module)
);
ALTER TABLE public.user_modules_legado_comercial ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_modules_legado_comercial FROM anon, authenticated;

INSERT INTO public.user_modules_legado_comercial (user_id, module)
SELECT user_id, module FROM public.user_modules
WHERE module IN ('vendas', 'mensal', 'anual')
ON CONFLICT (user_id, module) DO NOTHING;

INSERT INTO public.user_modules (user_id, module)
SELECT user_id, 'comercial' FROM public.user_modules WHERE module IN ('vendas', 'mensal', 'anual')
UNION
SELECT user_id, 'comercial' FROM public.user_roles WHERE role = 'admin'
ON CONFLICT (user_id, module) DO NOTHING;

-- (antes do gatilho do dono existir na 1ª rodada; nas seguintes ele libera
-- explicitamente a troca das antigas por "comercial")
DELETE FROM public.user_modules WHERE module IN ('vendas', 'mensal', 'anual');

-- 4. Policies das tabelas da área Comercial ----------------------------------
-- Índice pra a checagem "tarefa ligada à consulta" não varrer a agenda inteira.
CREATE INDEX IF NOT EXISTS collaborator_tasks_consultation_id_idx
  ON public.collaborator_tasks ((metadata->>'consultationId'));

-- consultations
DROP POLICY IF EXISTS "Comercial: ler consultas" ON public.consultations;
CREATE POLICY "Comercial: ler consultas" ON public.consultations
AS RESTRICTIVE FOR SELECT TO authenticated
USING ((SELECT public.pode_ver_consultas(auth.uid())) OR public.tem_tarefa_da_consulta(auth.uid(), id));

DROP POLICY IF EXISTS "Comercial: criar consultas" ON public.consultations;
CREATE POLICY "Comercial: criar consultas" ON public.consultations
AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK ((SELECT public.pode_comercial(auth.uid())));

DROP POLICY IF EXISTS "Comercial: alterar consultas" ON public.consultations;
CREATE POLICY "Comercial: alterar consultas" ON public.consultations
AS RESTRICTIVE FOR UPDATE TO authenticated
USING ((SELECT public.pode_alterar_consultas(auth.uid())) OR public.tem_tarefa_da_consulta(auth.uid(), id))
WITH CHECK ((SELECT public.pode_alterar_consultas(auth.uid())) OR public.tem_tarefa_da_consulta(auth.uid(), id));

DROP POLICY IF EXISTS "Comercial: apagar consultas" ON public.consultations;
CREATE POLICY "Comercial: apagar consultas" ON public.consultations
AS RESTRICTIVE FOR DELETE TO authenticated
USING ((SELECT public.pode_comercial(auth.uid())));

-- lead_form_responses (o INSERT público do formulário não muda)
DROP POLICY IF EXISTS "Comercial: ler respostas" ON public.lead_form_responses;
CREATE POLICY "Comercial: ler respostas" ON public.lead_form_responses
AS RESTRICTIVE FOR SELECT TO authenticated
USING ((SELECT public.pode_comercial(auth.uid())));

DROP POLICY IF EXISTS "Comercial: alterar respostas" ON public.lead_form_responses;
CREATE POLICY "Comercial: alterar respostas" ON public.lead_form_responses
AS RESTRICTIVE FOR UPDATE TO authenticated
USING ((SELECT public.pode_comercial(auth.uid())))
WITH CHECK ((SELECT public.pode_comercial(auth.uid())));

DROP POLICY IF EXISTS "Comercial: apagar respostas" ON public.lead_form_responses;
CREATE POLICY "Comercial: apagar respostas" ON public.lead_form_responses
AS RESTRICTIVE FOR DELETE TO authenticated
USING ((SELECT public.pode_comercial(auth.uid())));

-- lead_recovery
DROP POLICY IF EXISTS "Comercial: recuperacao" ON public.lead_recovery;
CREATE POLICY "Comercial: recuperacao" ON public.lead_recovery
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.pode_comercial(auth.uid())))
WITH CHECK ((SELECT public.pode_comercial(auth.uid())));

-- 5. Quem altera acessos: qualquer admin, para os outros ---------------------
DROP POLICY IF EXISTS "Admins can manage user_modules" ON public.user_modules;
CREATE POLICY "Admins can manage user_modules" ON public.user_modules
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Restritivas: mesmo que exista alguma policy permissiva a mais, quem não é
-- admin não grava aqui. (Ler o próprio continua pela policy que já existe.)
DROP POLICY IF EXISTS "Somente admin grava modulos (insert)" ON public.user_modules;
CREATE POLICY "Somente admin grava modulos (insert)" ON public.user_modules
AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));
DROP POLICY IF EXISTS "Somente admin grava modulos (update)" ON public.user_modules;
CREATE POLICY "Somente admin grava modulos (update)" ON public.user_modules
AS RESTRICTIVE FOR UPDATE TO authenticated
USING ((SELECT public.has_role(auth.uid(), 'admin'))) WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));
DROP POLICY IF EXISTS "Somente admin grava modulos (delete)" ON public.user_modules;
CREATE POLICY "Somente admin grava modulos (delete)" ON public.user_modules
AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT public.has_role(auth.uid(), 'admin')));

DROP POLICY IF EXISTS "Somente admin grava papeis (insert)" ON public.user_roles;
CREATE POLICY "Somente admin grava papeis (insert)" ON public.user_roles
AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));
DROP POLICY IF EXISTS "Somente admin grava papeis (update)" ON public.user_roles;
CREATE POLICY "Somente admin grava papeis (update)" ON public.user_roles
AS RESTRICTIVE FOR UPDATE TO authenticated
USING ((SELECT public.has_role(auth.uid(), 'admin'))) WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));
DROP POLICY IF EXISTS "Somente admin grava papeis (delete)" ON public.user_roles;
CREATE POLICY "Somente admin grava papeis (delete)" ON public.user_roles
AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- 6. Gatilho: acesso do dono não sai; ninguém tira o próprio admin ------------
CREATE OR REPLACE FUNCTION public.proteger_acesso_do_dono()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  dono uuid := public.dono_do_sistema();
BEGIN
  IF TG_TABLE_NAME = 'user_modules' THEN
    IF dono IS NOT NULL AND OLD.user_id = dono AND (
         TG_OP = 'DELETE'
         OR NEW.user_id IS DISTINCT FROM OLD.user_id
         OR NEW.module IS DISTINCT FROM OLD.module) THEN
      -- Única exceção: trocar as liberações antigas pela "comercial".
      IF TG_OP = 'DELETE' AND OLD.module IN ('vendas', 'mensal', 'anual')
         AND public.has_module(dono, 'comercial') THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'O acesso do dono do sistema nao pode ser removido (modulo %).', OLD.module
        USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'user_roles' THEN
    IF OLD.role = 'admin' AND (
         TG_OP = 'DELETE'
         OR NEW.user_id IS DISTINCT FROM OLD.user_id
         OR NEW.role IS DISTINCT FROM OLD.role) THEN
      IF dono IS NOT NULL AND OLD.user_id = dono THEN
        RAISE EXCEPTION 'O admin do dono do sistema nao pode ser removido.' USING ERRCODE = '42501';
      END IF;
      IF auth.uid() IS NOT NULL AND OLD.user_id = auth.uid() THEN
        RAISE EXCEPTION 'Voce nao pode tirar o seu proprio admin. Peca a outro admin.' USING ERRCODE = '42501';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'profiles' THEN
    IF dono IS NOT NULL AND OLD.id = dono AND (
         TG_OP = 'DELETE'
         OR NEW.id IS DISTINCT FROM OLD.id
         OR (OLD.approved IS TRUE AND NEW.approved IS NOT TRUE)) THEN
      RAISE EXCEPTION 'O dono do sistema nao pode ser desaprovado nem apagado.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.proteger_acesso_do_dono() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS proteger_acesso_do_dono ON public.user_modules;
CREATE TRIGGER proteger_acesso_do_dono BEFORE UPDATE OR DELETE ON public.user_modules
FOR EACH ROW EXECUTE FUNCTION public.proteger_acesso_do_dono();

DROP TRIGGER IF EXISTS proteger_acesso_do_dono ON public.user_roles;
CREATE TRIGGER proteger_acesso_do_dono BEFORE UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.proteger_acesso_do_dono();

DROP TRIGGER IF EXISTS proteger_acesso_do_dono ON public.profiles;
CREATE TRIGGER proteger_acesso_do_dono BEFORE UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.proteger_acesso_do_dono();

-- 7. delete_user(): só admin, nunca o dono -----------------------------------
-- O corpo que está no banco hoje vira delete_user_sem_checagem (fechado para
-- o app); delete_user passa a conferir antes de chamá-lo.
DO $$
BEGIN
  IF to_regprocedure('public.delete_user_sem_checagem(uuid)') IS NULL
     AND to_regprocedure('public.delete_user(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.delete_user(uuid) RENAME TO delete_user_sem_checagem;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regprocedure('public.delete_user_sem_checagem(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.delete_user_sem_checagem(uuid) FROM PUBLIC, anon, authenticated;

    CREATE OR REPLACE FUNCTION public.delete_user(target_user_id uuid)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
    BEGIN
      IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Somente admin exclui usuarios.' USING ERRCODE = '42501';
      END IF;
      IF target_user_id = public.dono_do_sistema() THEN
        RAISE EXCEPTION 'O dono do sistema nao pode ser excluido.' USING ERRCODE = '42501';
      END IF;
      PERFORM public.delete_user_sem_checagem(target_user_id);
    END $f$;

    REVOKE ALL ON FUNCTION public.delete_user(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.delete_user(uuid) TO authenticated, service_role;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 8. Relatório: quem tem "comercial" agora e por quê ------------------------
SELECT
  coalesce(p.full_name, '(sem nome)') AS pessoa,
  u.email,
  (p.id = public.dono_do_sistema()) AS dono,
  public.has_role(p.id, 'admin') AS admin,
  public.has_module(p.id, 'comercial') AS comercial,
  nullif(concat_ws(', ',
    CASE WHEN public.has_role(p.id, 'admin') THEN 'era admin' END,
    (SELECT 'tinha ' || string_agg(l.module, '+' ORDER BY l.module)
       FROM public.user_modules_legado_comercial l WHERE l.user_id = p.id)
  ), '') AS por_que_tem_comercial,
  (SELECT string_agg(m.module, ', ' ORDER BY m.module)
     FROM public.user_modules m WHERE m.user_id = p.id AND m.module <> 'comercial') AS outras_liberacoes,
  CASE
    WHEN NOT public.has_module(p.id, 'comercial') AND public.pode_ver_consultas(p.id)
      THEN 'sem Comercial: nao abre a area, mas le consultas pela Gestao de Alunas/Financeiro/agenda'
    WHEN NOT public.has_module(p.id, 'comercial')
      THEN 'sem Comercial: nao ve Monitoramento das Consultas'
  END AS observacao
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE p.approved
ORDER BY public.has_module(p.id, 'comercial') DESC, p.full_name;
