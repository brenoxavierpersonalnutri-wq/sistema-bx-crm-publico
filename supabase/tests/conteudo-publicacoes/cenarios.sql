-- Cenários da 20261124100000_conteudo_publicacoes (rodado por rodar.sh). Cada linha sai "ok ..." ou "FALHA ...".
-- A = admin · E = editora (módulo conteudo) · S = aprovada sem módulo · N = não aprovada com módulo
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

INSERT INTO auth.users (id, email) VALUES
  ('c0000000-0000-0000-0000-00000000000a', 'admin@t'),
  ('c0000000-0000-0000-0000-00000000000e', 'editora@t'),
  ('c0000000-0000-0000-0000-000000000005', 'semmod@t'),
  ('c0000000-0000-0000-0000-00000000000f', 'naoaprov@t')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, approved) VALUES
  ('c0000000-0000-0000-0000-00000000000a', 'Admin', true),
  ('c0000000-0000-0000-0000-00000000000e', 'Editora', true),
  ('c0000000-0000-0000-0000-000000000005', 'Sem modulo', true),
  ('c0000000-0000-0000-0000-00000000000f', 'Nao aprovada', false)
ON CONFLICT (id) DO UPDATE SET approved = EXCLUDED.approved, full_name = EXCLUDED.full_name;
INSERT INTO public.user_roles (user_id, role) VALUES ('c0000000-0000-0000-0000-00000000000a', 'admin');
INSERT INTO public.user_modules (user_id, module) VALUES
  ('c0000000-0000-0000-0000-00000000000e', 'conteudo'),
  ('c0000000-0000-0000-0000-00000000000f', 'conteudo');

\set PUB '''{"card_ref":"breno-fit|viral|abc123","perfil":"breno-fit","card_texto":"Magra não é definida","conta_id":"65f1c0a9e2b5af0012ab34cd","conta_nome":"brenoxavier","tipo":"feed","legenda":"teste","midias":[{"url":"https://media.zernio.com/temp/a.jpg","tipo":"image"}],"agora":false,"agendado_para":"2030-01-01T12:00:00Z"}'''

-- acesso -----------------------------------------------------------------------------------------------------
SET ROLE authenticated;
SELECT pg_temp.como('c0000000-0000-0000-0000-00000000000a') \g /dev/null
SELECT pg_temp.v('A: meu_acesso = aprovado+admin+conteudo', public.conteudo_meu_acesso() = '{"aprovado":true,"admin":true,"conteudo":true}');
SELECT pg_temp.como('c0000000-0000-0000-0000-00000000000e') \g /dev/null
SELECT pg_temp.v('E: meu_acesso = aprovado+conteudo, sem admin', public.conteudo_meu_acesso() = '{"aprovado":true,"admin":false,"conteudo":true}');
SELECT pg_temp.como('c0000000-0000-0000-0000-000000000005') \g /dev/null
SELECT pg_temp.v('S: meu_acesso sem conteudo', public.conteudo_meu_acesso() = '{"aprovado":true,"admin":false,"conteudo":false}');
SELECT pg_temp.como('c0000000-0000-0000-0000-00000000000f') \g /dev/null
SELECT pg_temp.v('N: não aprovada com módulo não tem conteudo', (public.conteudo_meu_acesso()->>'conteudo')::boolean = false);

-- criar ------------------------------------------------------------------------------------------------------
SELECT pg_temp.como('c0000000-0000-0000-0000-00000000000e') \g /dev/null
SELECT set_config('t.id1', public.conteudo_pub_criar(:PUB::jsonb)::text, false) \g /dev/null
SELECT pg_temp.v('E: cria publicação (status enviando, criado_por = E)',
  (SELECT status = 'enviando' AND criado_por = 'c0000000-0000-0000-0000-00000000000e' FROM public.conteudo_publicacoes WHERE id = current_setting('t.id1')::uuid));
SELECT pg_temp.como('c0000000-0000-0000-0000-000000000005') \g /dev/null
SELECT pg_temp.v('S: criar recusado (42501)', pg_temp.erro(format('SELECT public.conteudo_pub_criar(%L::jsonb)', :PUB)) = '42501');
SELECT pg_temp.v('S: não enxerga nenhuma publicação (RLS)', (SELECT count(*) FROM public.conteudo_publicacoes) = 0);
SELECT pg_temp.como('c0000000-0000-0000-0000-00000000000f') \g /dev/null
SELECT pg_temp.v('N: criar recusado (42501)', pg_temp.erro(format('SELECT public.conteudo_pub_criar(%L::jsonb)', :PUB)) = '42501');
SELECT pg_temp.como('c0000000-0000-0000-0000-00000000000e') \g /dev/null
SELECT pg_temp.v('E: tipo inválido recusado (23514)', pg_temp.erro(format('SELECT public.conteudo_pub_criar(%L::jsonb)', jsonb_set(:PUB::jsonb, '{tipo}', '"tiktok"'))) = '23514');
SELECT pg_temp.v('E: sem mídia recusado (22023)', pg_temp.erro(format('SELECT public.conteudo_pub_criar(%L::jsonb)', jsonb_set(:PUB::jsonb, '{midias}', '[]'))) = '22023');
SELECT pg_temp.v('E: conta_id fora do formato recusado (23514)', pg_temp.erro(format('SELECT public.conteudo_pub_criar(%L::jsonb)', jsonb_set(:PUB::jsonb, '{conta_id}', '"x; drop"'))) = '23514');
SELECT pg_temp.v('E: INSERT direto negado (42501)', pg_temp.erro($$INSERT INTO public.conteudo_publicacoes (card_ref, conta_id, tipo) VALUES ('x','65f1c0a9e2b5af0012ab34cd','feed')$$) = '42501');
SELECT pg_temp.v('E: UPDATE direto negado (42501)', pg_temp.erro($$UPDATE public.conteudo_publicacoes SET status = 'publicado'$$) = '42501');
SELECT pg_temp.v('E: DELETE direto negado (42501)', pg_temp.erro($$DELETE FROM public.conteudo_publicacoes$$) = '42501');
SELECT pg_temp.v('E: enxerga a publicação (RLS)', (SELECT count(*) FROM public.conteudo_publicacoes) = 1);
SELECT pg_temp.v('E: não lê a tabela do segredo (42501)', pg_temp.erro($$SELECT * FROM public.conteudo_zernio_chave$$) = '42501');
RESET ROLE;

SET ROLE anon;
SELECT pg_temp.como(NULL) \g /dev/null
SELECT pg_temp.v('anon: criar negado (42501)', pg_temp.erro(format('SELECT public.conteudo_pub_criar(%L::jsonb)', :PUB)) = '42501');
SELECT pg_temp.v('anon: SELECT na tabela negado (42501)', pg_temp.erro($$SELECT * FROM public.conteudo_publicacoes$$) = '42501');
SELECT pg_temp.v('anon: estado = vazio antes do pareamento', public.conteudo_zernio_estado(repeat('s', 64)) = 'vazio');
SELECT pg_temp.v('anon: sincronizar sem pareamento recusado (42501)', pg_temp.erro(format('SELECT public.conteudo_pub_sincronizar(%L, %L::uuid, NULL, %L, NULL, NULL)', repeat('s', 64), current_setting('t.id1'), 'publicado')) = '42501');
SELECT pg_temp.v('anon: parear negado (42501)', pg_temp.erro(format('SELECT public.conteudo_zernio_parear(%L)', encode(sha256(convert_to(repeat('s', 64), 'UTF8')), 'hex'))) = '42501');
RESET ROLE;

-- pareamento -------------------------------------------------------------------------------------------------
SET ROLE authenticated;
SELECT pg_temp.como('c0000000-0000-0000-0000-00000000000e') \g /dev/null
SELECT pg_temp.v('E (não admin): parear recusado (42501)', pg_temp.erro(format('SELECT public.conteudo_zernio_parear(%L)', encode(sha256(convert_to(repeat('s', 64), 'UTF8')), 'hex'))) = '42501');
SELECT pg_temp.v('E (não admin): reabrir recusado (42501)', pg_temp.erro('SELECT public.conteudo_zernio_reabrir()') = '42501');
SELECT pg_temp.como('c0000000-0000-0000-0000-00000000000a') \g /dev/null
SELECT pg_temp.v('A: hash fora do formato recusado (22023)', pg_temp.erro($$SELECT public.conteudo_zernio_parear('abc')$$) = '22023');
SELECT pg_temp.v('A: parear = ok', public.conteudo_zernio_parear(encode(sha256(convert_to(repeat('s', 64), 'UTF8')), 'hex')) = 'ok');
SELECT pg_temp.v('A: parear de novo = ja_pareado (não troca o hash)', public.conteudo_zernio_parear(encode(sha256(convert_to(repeat('x', 64), 'UTF8')), 'hex')) = 'ja_pareado');
RESET ROLE;

SET ROLE anon;
SELECT pg_temp.como(NULL) \g /dev/null
SELECT pg_temp.v('anon: estado com o segredo certo = ok', public.conteudo_zernio_estado(repeat('s', 64)) = 'ok');
SELECT pg_temp.v('anon: estado com segredo errado = diferente', public.conteudo_zernio_estado(repeat('x', 64)) = 'diferente');
SELECT pg_temp.v('anon: sincronizar com segredo errado recusado (42501)', pg_temp.erro(format('SELECT public.conteudo_pub_sincronizar(%L, %L::uuid, NULL, %L, NULL, NULL)', repeat('x', 64), current_setting('t.id1'), 'publicado')) = '42501');
SELECT pg_temp.v('anon: pendentes com segredo errado recusado (42501)', pg_temp.erro(format('SELECT * FROM public.conteudo_pub_pendentes(%L)', repeat('x', 64))) = '42501');
SELECT pg_temp.v('serviço: pendentes lista a publicação enviando', (SELECT count(*) FROM public.conteudo_pub_pendentes(repeat('s', 64))) = 1);
SELECT pg_temp.v('serviço: status inválido recusado (22023)', pg_temp.erro(format('SELECT public.conteudo_pub_sincronizar(%L, %L::uuid, NULL, %L, NULL, NULL)', repeat('s', 64), current_setting('t.id1'), 'hackeado')) = '22023');
SELECT pg_temp.v('serviço: agendado com id da Zernio', public.conteudo_pub_sincronizar(repeat('s', 64), current_setting('t.id1')::uuid, 'aaaaaaaaaaaaaaaaaaaaaaaa', 'agendado', NULL, NULL));
SELECT pg_temp.v('serviço (webhook): publicado pelo id da Zernio, com link', public.conteudo_pub_sincronizar(repeat('s', 64), NULL, 'aaaaaaaaaaaaaaaaaaaaaaaa', 'publicado', 'https://www.instagram.com/p/X/', NULL));
SELECT pg_temp.v('serviço: publicado é final (cancelado não sobrescreve)', public.conteudo_pub_sincronizar(repeat('s', 64), current_setting('t.id1')::uuid, NULL, 'cancelado', NULL, NULL) = false);
SELECT pg_temp.v('serviço: pendentes vazio depois de publicado', (SELECT count(*) FROM public.conteudo_pub_pendentes(repeat('s', 64))) = 0);
RESET ROLE;
SELECT pg_temp.v('linha final: publicado, link, publicado_em, erro nulo',
  (SELECT status = 'publicado' AND link_post = 'https://www.instagram.com/p/X/' AND publicado_em IS NOT NULL AND erro IS NULL
     FROM public.conteudo_publicacoes WHERE id = current_setting('t.id1')::uuid));

-- erro -> publicado permitido; erro -> agendado não; cancelado final
SET ROLE authenticated;
SELECT pg_temp.como('c0000000-0000-0000-0000-00000000000e') \g /dev/null
SELECT set_config('t.id2', public.conteudo_pub_criar(:PUB::jsonb)::text, false) \g /dev/null
SELECT set_config('t.id3', public.conteudo_pub_criar(:PUB::jsonb)::text, false) \g /dev/null
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.como(NULL) \g /dev/null
SELECT pg_temp.v('serviço: erro com mensagem', public.conteudo_pub_sincronizar(repeat('s', 64), current_setting('t.id2')::uuid, NULL, 'erro', NULL, 'conta desconectada'));
SELECT pg_temp.v('serviço: erro não volta para agendado', public.conteudo_pub_sincronizar(repeat('s', 64), current_setting('t.id2')::uuid, NULL, 'agendado', NULL, NULL) = false);
SELECT pg_temp.v('serviço: erro pode virar publicado', public.conteudo_pub_sincronizar(repeat('s', 64), current_setting('t.id2')::uuid, NULL, 'publicado', 'javascript:alert(1)', NULL));
SELECT pg_temp.v('serviço: cancelar', public.conteudo_pub_sincronizar(repeat('s', 64), current_setting('t.id3')::uuid, NULL, 'cancelado', NULL, NULL));
SELECT pg_temp.v('serviço: cancelado é final', public.conteudo_pub_sincronizar(repeat('s', 64), current_setting('t.id3')::uuid, NULL, 'publicado', NULL, NULL) = false);
RESET ROLE;
SELECT pg_temp.v('erro some quando publica; link que não é https ignorado', (SELECT erro IS NULL AND link_post IS NULL FROM public.conteudo_publicacoes WHERE id = current_setting('t.id2')::uuid));

-- reabrir (como dono, no SQL editor) e repetir a migration não apaga dado
SELECT pg_temp.v('dono: reabrir', public.conteudo_zernio_reabrir() = 'reaberto');
SELECT pg_temp.v('depois de reabrir: estado = vazio', public.conteudo_zernio_estado(repeat('s', 64)) = 'vazio');
