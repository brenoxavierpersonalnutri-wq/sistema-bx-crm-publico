-- Cenários da 20261125100000_conteudo_reacts (rodado por rodar.sh). Cada linha sai "ok ..." ou "FALHA ...".
-- A = admin · E = editora (módulo conteudo) · F = outra editora · S = aprovada sem módulo · N = não aprovada com módulo
\pset tuples_only on
\pset format unaligned
SET client_min_messages = error;

CREATE FUNCTION pg_temp.erro(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN 'nenhum'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION pg_temp.v(_nome text, _ok boolean) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(_ok, false) THEN 'ok   ' ELSE 'FALHA ' END || _nome $$;
CREATE FUNCTION pg_temp.como(_uid text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _uid IS NULL THEN '{"role":"anon"}'
    ELSE json_build_object('sub', _uid, 'role', 'authenticated')::text END, false) $$;
CREATE FUNCTION pg_temp.linhas(_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE _sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; EXCEPTION WHEN OTHERS THEN RETURN -1; END $$;

INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-0000-0000-00000000000a', 'admin@t'),
  ('d0000000-0000-0000-0000-00000000000e', 'editora@t'),
  ('d0000000-0000-0000-0000-0000000000ef', 'editora2@t'),
  ('d0000000-0000-0000-0000-000000000005', 'semmod@t'),
  ('d0000000-0000-0000-0000-00000000000f', 'naoaprov@t')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, approved) VALUES
  ('d0000000-0000-0000-0000-00000000000a', 'Admin', true),
  ('d0000000-0000-0000-0000-00000000000e', 'Editora', true),
  ('d0000000-0000-0000-0000-0000000000ef', 'Editora 2', true),
  ('d0000000-0000-0000-0000-000000000005', 'Sem modulo', true),
  ('d0000000-0000-0000-0000-00000000000f', 'Nao aprovada', false)
ON CONFLICT (id) DO UPDATE SET approved = EXCLUDED.approved, full_name = EXCLUDED.full_name;
INSERT INTO public.user_roles (user_id, role) VALUES ('d0000000-0000-0000-0000-00000000000a', 'admin');
INSERT INTO public.user_modules (user_id, module) VALUES
  ('d0000000-0000-0000-0000-00000000000e', 'conteudo'),
  ('d0000000-0000-0000-0000-0000000000ef', 'conteudo'),
  ('d0000000-0000-0000-0000-00000000000f', 'conteudo');

SET ROLE authenticated;
-- E cria (tentando forjar autor e data: o banco ignora)
SELECT pg_temp.como('d0000000-0000-0000-0000-00000000000e') \g /dev/null
WITH x AS (INSERT INTO public.conteudo_reacts (titulo, perfil, linha_tempo, criado_por, criado_em)
  VALUES ('Reação ao treino', 'breno-fit', '[{"tipo":"tocando","ini":0,"fim":2,"orig":0}]', 'd0000000-0000-0000-0000-00000000000e', '2000-01-01')
  RETURNING id) SELECT set_config('t.r1', id::text, false) FROM x \g /dev/null
SELECT pg_temp.v('E: cria react (status rascunho, autor E, data de agora)',
  (SELECT status = 'rascunho' AND criado_por = 'd0000000-0000-0000-0000-00000000000e' AND criado_em > now() - interval '1 minute'
     FROM public.conteudo_reacts WHERE id = current_setting('t.r1')::uuid));
SELECT pg_temp.v('E: autor forjado no INSERT vira E (o banco põe quem está logado)', pg_temp.erro($$INSERT INTO public.conteudo_reacts (titulo, criado_por) VALUES ('x', 'd0000000-0000-0000-0000-00000000000a')$$) = 'nenhum'
  AND (SELECT count(*) FROM public.conteudo_reacts WHERE criado_por = 'd0000000-0000-0000-0000-00000000000a') = 0);
SELECT pg_temp.v('E: status inválido recusado (23514)', pg_temp.erro($$INSERT INTO public.conteudo_reacts (status) VALUES ('publicado')$$) = '23514');
SELECT pg_temp.v('E: layout inválido recusado (23514)', pg_temp.erro($$INSERT INTO public.conteudo_reacts (layout) VALUES ('lado')$$) = '23514');
SELECT pg_temp.v('E: linha do tempo que não é lista recusada (23514)', pg_temp.erro($$INSERT INTO public.conteudo_reacts (linha_tempo) VALUES ('{}')$$) = '23514');
SELECT pg_temp.v('E: atualiza status/duração', pg_temp.linhas(format($$UPDATE public.conteudo_reacts SET status = 'pronto', duracao_final_seg = 41.3 WHERE id = %L$$, current_setting('t.r1'))) = 1);
SELECT pg_temp.v('E: não troca autor nem data de criação no UPDATE',
  pg_temp.linhas(format($$UPDATE public.conteudo_reacts SET criado_por = 'd0000000-0000-0000-0000-00000000000a', criado_em = '2000-01-01' WHERE id = %L$$, current_setting('t.r1'))) = 1
  AND (SELECT criado_por = 'd0000000-0000-0000-0000-00000000000e' AND criado_em > '2001-01-01' FROM public.conteudo_reacts WHERE id = current_setting('t.r1')::uuid));

-- F (outra editora): vê e edita, não apaga o de E
SELECT pg_temp.como('d0000000-0000-0000-0000-0000000000ef') \g /dev/null
SELECT pg_temp.v('F: enxerga o react da E (time)', (SELECT count(*) FROM public.conteudo_reacts WHERE id = current_setting('t.r1')::uuid) = 1);
SELECT pg_temp.v('F: edita o título', pg_temp.linhas(format($$UPDATE public.conteudo_reacts SET titulo = 'Novo' WHERE id = %L$$, current_setting('t.r1'))) = 1);
SELECT pg_temp.v('F: não apaga o react da E (0 linhas)', pg_temp.linhas(format($$DELETE FROM public.conteudo_reacts WHERE id = %L$$, current_setting('t.r1'))) = 0);

-- S e N: nada
SELECT pg_temp.como('d0000000-0000-0000-0000-000000000005') \g /dev/null
SELECT pg_temp.v('S: não enxerga nenhum react', (SELECT count(*) FROM public.conteudo_reacts) = 0);
SELECT pg_temp.v('S: criar recusado (42501)', pg_temp.erro($$INSERT INTO public.conteudo_reacts (titulo) VALUES ('x')$$) = '42501');
SELECT pg_temp.v('S: UPDATE não pega nada', pg_temp.linhas($$UPDATE public.conteudo_reacts SET titulo = 'hack'$$) = 0);
SELECT pg_temp.v('S: meu_acesso sem conteudo', public.conteudo_meu_acesso() = '{"aprovado":true,"admin":false,"conteudo":false}');
SELECT pg_temp.como('d0000000-0000-0000-0000-00000000000f') \g /dev/null
SELECT pg_temp.v('N: não aprovada não enxerga', (SELECT count(*) FROM public.conteudo_reacts) = 0);
SELECT pg_temp.v('N: criar recusado (42501)', pg_temp.erro($$INSERT INTO public.conteudo_reacts (titulo) VALUES ('x')$$) = '42501');
RESET ROLE;

SET ROLE anon;
SELECT pg_temp.como(NULL) \g /dev/null
SELECT pg_temp.v('anon: SELECT negado (42501)', pg_temp.erro($$SELECT * FROM public.conteudo_reacts$$) = '42501');
SELECT pg_temp.v('anon: INSERT negado (42501)', pg_temp.erro($$INSERT INTO public.conteudo_reacts (titulo) VALUES ('x')$$) = '42501');
SELECT pg_temp.v('anon: conteudo_meu_acesso negado (42501)', pg_temp.erro('SELECT public.conteudo_meu_acesso()') = '42501');
RESET ROLE;

SET ROLE authenticated;
SELECT pg_temp.como('d0000000-0000-0000-0000-00000000000e') \g /dev/null
SELECT pg_temp.v('E: apaga o próprio react', pg_temp.linhas(format($$DELETE FROM public.conteudo_reacts WHERE id = %L$$, current_setting('t.r1'))) = 1);
WITH x AS (INSERT INTO public.conteudo_reacts (titulo) VALUES ('Outro') RETURNING id) SELECT set_config('t.r2', id::text, false) FROM x \g /dev/null
SELECT pg_temp.como('d0000000-0000-0000-0000-00000000000a') \g /dev/null
SELECT pg_temp.v('A: admin apaga react de outra pessoa', pg_temp.linhas(format($$DELETE FROM public.conteudo_reacts WHERE id = %L$$, current_setting('t.r2'))) = 1);
SELECT pg_temp.v('A: meu_acesso = aprovado+admin+conteudo', public.conteudo_meu_acesso() = '{"aprovado":true,"admin":true,"conteudo":true}');
RESET ROLE;
