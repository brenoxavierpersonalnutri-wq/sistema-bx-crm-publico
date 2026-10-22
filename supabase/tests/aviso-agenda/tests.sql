\set ON_ERROR_STOP on
SET client_min_messages = warning;
CREATE FUNCTION pg_temp.ok(cond boolean, nome text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', nome; END IF;
  RAISE NOTICE 'ok  %', nome;
END $$;
SET client_min_messages = notice;

-- Cenário -------------------------------------------------------------------
-- A = responsável da Ana (aprovada, sem módulo)   B = time com agenda-alunas
-- C = time sem módulo                             D = dono (admin)
-- E = ex-membro (não aprovado), ainda dono da ficha da Bia
INSERT INTO public.profiles (id, full_name, approved, created_at) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'A', true,  now()),
  ('00000000-0000-0000-0000-00000000000b', 'B', true,  now()),
  ('00000000-0000-0000-0000-00000000000c', 'C', true,  now()),
  ('00000000-0000-0000-0000-00000000000d', 'D', true,  now() - interval '1 year'),
  ('00000000-0000-0000-0000-00000000000e', 'E', false, now());
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-00000000000d', 'admin');
INSERT INTO public.user_modules (user_id, module) VALUES ('00000000-0000-0000-0000-00000000000b', 'agenda-alunas');
INSERT INTO public.alunas (id, user_id, nome_completo, telefone) VALUES
  ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Ana Teste', '(31) 99000-0107'),
  ('11111111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000e', 'Bia Ex', '(11) 98888-7777');
INSERT INTO public.anamnese_respostas (id, aluna_id, token) VALUES
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'tok-ana'),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'tok-bia');

-- Sem dono_do_sistema() ainda: o fallback é o admin aprovado mais antigo.
CREATE FUNCTION pg_temp.avisos() RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.collaborator_tasks WHERE type = 'aviso' $$;

-- 1. Anamnese respondida pelo link público (anon) -------------------------------
SET ROLE anon;
SELECT pg_temp.ok(public.anamnese_enviar('tok-ana', '{"nome_completo":"Ana Digitada","aceite":true}'), 'anamnese: anon envia');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.avisos() = 1, 'anamnese: 1 aviso criado');
SELECT pg_temp.ok(t.title = 'Anamnese preenchida: Ana Teste', 'anamnese: título com o nome do cadastro, veio ' || t.title)
  FROM public.collaborator_tasks t WHERE t.metadata->>'origem' = 'anamnese';
SELECT pg_temp.ok(t.user_id = '00000000-0000-0000-0000-00000000000a', 'anamnese: vai pro responsável da aluna')
  FROM public.collaborator_tasks t WHERE t.metadata->>'origem' = 'anamnese';
SELECT pg_temp.ok(t.metadata->>'link' = '/alunas/ficha/11111111-0000-0000-0000-000000000001'
              AND t.metadata->>'alunaId' = '11111111-0000-0000-0000-000000000001'
              AND t.metadata->>'avisoChave' = 'anamnese:22222222-0000-0000-0000-000000000001'
              AND t.status = 'pending' AND t.recurrence = 'none'
              AND t.due_date BETWEEN now() - interval '1 minute' AND now() + interval '1 minute'
              AND t.description LIKE '%/alunas/ficha/11111111-0000-0000-0000-000000000001',
              'anamnese: link, chave, pendente, data = agora')
  FROM public.collaborator_tasks t WHERE t.metadata->>'origem' = 'anamnese';

-- 2. Idempotência -------------------------------------------------------------
SET ROLE anon;
SELECT pg_temp.ok(NOT public.anamnese_enviar('tok-ana', '{}'), 'anamnese: reenvio recusado');
RESET ROLE;
UPDATE public.anamnese_respostas SET status = 'respondida', updated_at = now() WHERE id = '22222222-0000-0000-0000-000000000001';
UPDATE public.anamnese_respostas SET status = 'pendente' WHERE id = '22222222-0000-0000-0000-000000000001';
UPDATE public.anamnese_respostas SET status = 'respondida' WHERE id = '22222222-0000-0000-0000-000000000001';
SELECT pg_temp.ok(pg_temp.avisos() = 1, 'anamnese: re-disparo (respondida de novo) não duplica');
-- Mesmo se o time apagou o aviso, re-update da já respondida não recria.
UPDATE public.anamnese_respostas SET status = 'respondida' WHERE id = '22222222-0000-0000-0000-000000000001';
SELECT pg_temp.ok(pg_temp.avisos() = 1, 'anamnese: update respondida->respondida não faz nada');

-- 3. Responsável fora do time -> admin (sem dono_do_sistema) -------------------
SET ROLE anon;
SELECT public.anamnese_enviar('tok-bia', '{"nome_completo":"Bia"}');
RESET ROLE;
SELECT pg_temp.ok(t.user_id = '00000000-0000-0000-0000-00000000000d', 'responsável não aprovado: vai pro admin')
  FROM public.collaborator_tasks t WHERE t.metadata->>'avisoChave' = 'anamnese:22222222-0000-0000-0000-000000000002';

-- 4. Feedback com aluna_id (anon, INSERT direto como o formulário) -----------
SET ROLE anon;
INSERT INTO public.feedback_semanal_responses (id, nome, telefone, produto, aluna_id)
VALUES ('33333333-0000-0000-0000-000000000001', 'ana digitou assim', '5531990000107', 'mgmd', '11111111-0000-0000-0000-000000000001');
RESET ROLE;
SELECT pg_temp.ok(t.title = 'Feedback enviado: Ana Teste' AND t.user_id = '00000000-0000-0000-0000-00000000000a'
              AND t.metadata->>'link' = '/alunas/ficha/11111111-0000-0000-0000-000000000001', 'feedback: aviso pro responsável com link')
  FROM public.collaborator_tasks t WHERE t.metadata->>'avisoChave' = 'feedback:33333333-0000-0000-0000-000000000001';

-- 5. Segundo feedback da mesma aluna no mesmo dia: outro aviso ---------------
SET ROLE anon;
INSERT INTO public.feedback_semanal_responses (id, nome, aluna_id)
VALUES ('33333333-0000-0000-0000-000000000002', 'Ana', '11111111-0000-0000-0000-000000000001');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.collaborator_tasks WHERE metadata->>'origem' = 'feedback') = 2, 'feedback: 2 envios = 2 avisos');

-- 6. Feedback antigo, sem aluna_id: casa pelo telefone (nono dígito) ---------
SET ROLE anon;
INSERT INTO public.feedback_semanal_responses (id, nome, telefone)
VALUES ('33333333-0000-0000-0000-000000000003', 'Ana', '(31) 9000-0107');
RESET ROLE;
SELECT pg_temp.ok(t.metadata->>'alunaId' = '11111111-0000-0000-0000-000000000001', 'feedback sem aluna_id: casou pelo telefone')
  FROM public.collaborator_tasks t WHERE t.metadata->>'avisoChave' = 'feedback:33333333-0000-0000-0000-000000000003';

-- 7. Feedback de quem não está no cadastro: aviso pro dono, sem link ---------
CREATE FUNCTION public.dono_do_sistema() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '00000000-0000-0000-0000-00000000000c'::uuid $$;
SET ROLE anon;
INSERT INTO public.feedback_semanal_responses (id, nome, telefone)
VALUES ('33333333-0000-0000-0000-000000000004', 'Desconhecida', '(21) 90000-1111');
RESET ROLE;
SELECT pg_temp.ok(t.user_id = '00000000-0000-0000-0000-00000000000c' AND NOT (t.metadata ? 'link') AND NOT (t.metadata ? 'alunaId')
              AND t.title = 'Feedback enviado: Desconhecida', 'sem cadastro: vai pro dono_do_sistema(), sem link')
  FROM public.collaborator_tasks t WHERE t.metadata->>'avisoChave' = 'feedback:33333333-0000-0000-0000-000000000004';
DROP FUNCTION public.dono_do_sistema();

-- 8. Falha no aviso não derruba o envio da aluna ------------------------------
ALTER TABLE public.collaborator_tasks ADD CONSTRAINT teste_barra_aviso CHECK (type <> 'aviso') NOT VALID;
SET ROLE anon;
INSERT INTO public.feedback_semanal_responses (id, nome, aluna_id)
VALUES ('33333333-0000-0000-0000-000000000005', 'Ana', '11111111-0000-0000-0000-000000000001');
RESET ROLE;
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.feedback_semanal_responses WHERE id = '33333333-0000-0000-0000-000000000005'), 'falha: feedback gravado mesmo assim');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.collaborator_tasks WHERE metadata->>'avisoChave' = 'feedback:33333333-0000-0000-0000-000000000005'), 'falha: sem aviso, sem erro');
INSERT INTO public.anamnese_respostas (id, aluna_id, token) VALUES ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'tok-ana2');
SET ROLE anon;
SELECT pg_temp.ok(public.anamnese_enviar('tok-ana2', '{}'), 'falha: anamnese gravada mesmo assim');
RESET ROLE;
SELECT pg_temp.ok((SELECT status FROM public.anamnese_respostas WHERE token = 'tok-ana2') = 'respondida', 'falha: status respondida');
ALTER TABLE public.collaborator_tasks DROP CONSTRAINT teste_barra_aviso;

-- 9. Ninguém de fora chama o núcleo direto -------------------------------------
SET ROLE anon;
DO $$ BEGIN
  PERFORM public.criar_aviso_aluna('feedback', gen_random_uuid(), NULL, 'x');
  RAISE EXCEPTION 'FALHOU: anon chamou criar_aviso_aluna';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  anon não chama criar_aviso_aluna';
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM public.criar_aviso_aluna('feedback', gen_random_uuid(), NULL, 'x');
  RAISE EXCEPTION 'FALHOU: authenticated chamou criar_aviso_aluna';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  logado não chama criar_aviso_aluna';
END $$;
RESET ROLE;

-- 10. RLS: quem vê o aviso -------------------------------------------------------
CREATE FUNCTION pg_temp.vistos(_sub text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _sub, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.collaborator_tasks WHERE type = 'aviso';
  RESET ROLE;
  RETURN n;
END $$;
SELECT pg_temp.ok(pg_temp.vistos('00000000-0000-0000-0000-00000000000a') = 4, 'RLS: responsável vê os 4 dela');
SELECT pg_temp.ok(pg_temp.vistos('00000000-0000-0000-0000-00000000000b') = (SELECT count(*) FROM public.collaborator_tasks WHERE type = 'aviso'), 'RLS: agenda-alunas vê todos');
SELECT pg_temp.ok(pg_temp.vistos('00000000-0000-0000-0000-00000000000c') = 1, 'RLS: sem módulo vê só o que é dele');
SELECT pg_temp.ok(pg_temp.vistos('00000000-0000-0000-0000-00000000000d') = (SELECT count(*) FROM public.collaborator_tasks WHERE type = 'aviso'), 'RLS: admin vê todos');
SET ROLE anon;
SELECT pg_temp.ok((SELECT count(*) FROM public.collaborator_tasks) = 0, 'RLS: anon não vê agenda');
SELECT pg_temp.ok((SELECT count(*) FROM public.feedback_semanal_responses) = 0, 'RLS: anon continua sem ler feedback');
SELECT pg_temp.ok((SELECT count(*) FROM public.anamnese_respostas) = 0, 'RLS: anon continua sem ler anamnese');
RESET ROLE;

-- B (agenda-alunas) marca como feito; C (sem módulo) não consegue mexer em aviso alheio.
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
SET LOCAL ROLE authenticated;
UPDATE public.collaborator_tasks SET status = 'completed' WHERE metadata->>'avisoChave' = 'anamnese:22222222-0000-0000-0000-000000000001';
COMMIT;
SELECT pg_temp.ok((SELECT status FROM public.collaborator_tasks WHERE metadata->>'avisoChave' = 'anamnese:22222222-0000-0000-0000-000000000001') = 'completed', 'RLS: agenda-alunas marca aviso como feito');
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
SET LOCAL ROLE authenticated;
UPDATE public.collaborator_tasks SET status = 'pending' WHERE metadata->>'avisoChave' = 'anamnese:22222222-0000-0000-0000-000000000001';
COMMIT;
SELECT pg_temp.ok((SELECT status FROM public.collaborator_tasks WHERE metadata->>'avisoChave' = 'anamnese:22222222-0000-0000-0000-000000000001') = 'completed', 'RLS: sem módulo não mexe em aviso alheio');
-- B não vira dono de reavaliação de ninguém por causa disto: a camada continua só nos tipos dela.
INSERT INTO public.collaborator_tasks (user_id, title, due_date, type) VALUES ('00000000-0000-0000-0000-00000000000a', 'manual da A', now(), 'manual');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false) \gset
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.collaborator_tasks WHERE type = 'manual') = 0, 'RLS: agenda-alunas não passa a ver tarefa manual alheia');
RESET ROLE;

-- 11. Policies existentes intactas --------------------------------------------
SELECT pg_temp.ok(NOT EXISTS (
  SELECT tablename, policyname, cmd, roles, qual, with_check FROM public._policies_antes
  EXCEPT
  SELECT tablename, policyname, cmd, roles::text, qual, with_check FROM pg_policies WHERE schemaname = 'public'
), 'policies: nenhuma existente mudou ou sumiu');
SELECT pg_temp.ok((
  SELECT array_agg(policyname ORDER BY policyname) FROM (
    SELECT policyname::text FROM pg_policies WHERE schemaname = 'public'
    EXCEPT SELECT policyname::text FROM public._policies_antes) n
) = ARRAY['Agenda alunas access can read aviso tasks', 'Agenda alunas access can update aviso tasks'], 'policies: só as 2 novas do aviso');
SELECT pg_temp.ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN
  ('public.collaborator_tasks'::regclass, 'public.feedback_semanal_responses'::regclass, 'public.anamnese_respostas'::regclass)), 'RLS ligada nas 3 tabelas');
