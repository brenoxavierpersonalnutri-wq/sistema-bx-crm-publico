-- Camada "Conteúdo" da agenda (time de conteúdo e criativo).
--
-- Mesmo molde da camada "Reavaliações" (drizzle/migrations/0002_agenda_alunas_access.sql):
-- a liberação é uma linha em public.user_modules com module = 'agenda-conteudo',
-- ligada/desligada pelo admin na lista "Quem tem acesso" da Área do Usuário.
-- Quem tem a liberação lê, cria, edita e apaga as tarefas type = 'conteudo'
-- de qualquer pessoa. Admin já tem tudo pela policy "Admins can manage all tasks".
--
-- A repetição estilo Calendário do Mac (quinzenal, a cada N, término, exceções)
-- NÃO precisa de coluna nova: a coluna recurrence continua com a frequência base
-- (a CHECK atual aceita) e o resto da regra vai em metadata.recorrencia.
--
-- Idempotente: pode rodar mais de uma vez.

-- 1. has_module (já existe se a 0002 do drizzle rodou; recria igual por garantia).
CREATE OR REPLACE FUNCTION public.has_module(_user_id uuid, _module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_modules WHERE user_id = _user_id AND module = _module)
$$;

-- 2. Libera o valor 'conteudo' em collaborator_tasks.type. Uma das migrations
-- antigas criava a tabela com CHECK (type IN ('manual','reavaliacao','liberacao'));
-- se essa constraint existir no banco, ela barraria 'conteudo' (e 'meta'/'residuo').
-- (20260311164500; a 20260311205653, do Lovable, cria sem CHECK). Não dá pra
-- saber daqui qual das duas valeu em produção, então só remove se existir.
-- Não recria lista fixa de propósito: uma lista nova poderia barrar algum tipo
-- em uso que o repositório não conhece.
ALTER TABLE public.collaborator_tasks DROP CONSTRAINT IF EXISTS collaborator_tasks_type_check;

-- 3. Policies da camada.
DROP POLICY IF EXISTS "Agenda conteudo access can read conteudo tasks" ON public.collaborator_tasks;
CREATE POLICY "Agenda conteudo access can read conteudo tasks" ON public.collaborator_tasks
FOR SELECT TO authenticated
USING (type = 'conteudo' AND public.has_module(auth.uid(), 'agenda-conteudo'));

DROP POLICY IF EXISTS "Agenda conteudo access can insert conteudo tasks" ON public.collaborator_tasks;
CREATE POLICY "Agenda conteudo access can insert conteudo tasks" ON public.collaborator_tasks
FOR INSERT TO authenticated
WITH CHECK (type = 'conteudo' AND public.has_module(auth.uid(), 'agenda-conteudo'));

DROP POLICY IF EXISTS "Agenda conteudo access can update conteudo tasks" ON public.collaborator_tasks;
CREATE POLICY "Agenda conteudo access can update conteudo tasks" ON public.collaborator_tasks
FOR UPDATE TO authenticated
USING (type = 'conteudo' AND public.has_module(auth.uid(), 'agenda-conteudo'))
WITH CHECK (type = 'conteudo' AND public.has_module(auth.uid(), 'agenda-conteudo'));

DROP POLICY IF EXISTS "Agenda conteudo access can delete conteudo tasks" ON public.collaborator_tasks;
CREATE POLICY "Agenda conteudo access can delete conteudo tasks" ON public.collaborator_tasks
FOR DELETE TO authenticated
USING (type = 'conteudo' AND public.has_module(auth.uid(), 'agenda-conteudo'));

NOTIFY pgrst, 'reload schema';
