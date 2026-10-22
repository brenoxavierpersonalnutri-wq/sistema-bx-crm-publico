-- Tempo de banco (EXPLAIN ANALYZE, melhor de 3) das leituras da tela de Conversas, como usuário logado.
-- Roda antes e depois das migrations de permissão (rodar.sh --explain).
\set QUIET on
CREATE SCHEMA IF NOT EXISTS teste;
GRANT USAGE ON SCHEMA teste TO PUBLIC;
CREATE OR REPLACE FUNCTION teste.tempo(p_rotulo text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE j json; melhor numeric := null; t numeric; i int;
BEGIN
  FOR i IN 1..3 LOOP
    EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON) ' || p_sql INTO j;
    t := (j -> 0 ->> 'Execution Time')::numeric;
    melhor := least(coalesce(melhor, t), t);
  END LOOP;
  RETURN format('%-58s %9s ms', p_rotulo, round(melhor, 1));
END $$;
GRANT EXECUTE ON FUNCTION teste.tempo(text, text) TO PUBLIC;
SELECT id AS n1 FROM public.crm_numeros ORDER BY ordem LIMIT 1 \gset
SELECT phone AS p1 FROM public.whatsapp_contacts WHERE numero_id = :'n1' AND name LIKE 'Lead %' LIMIT 1 \gset

-- usuário restrito (só existe depois das migrations): 1 número, só Conversas, "só as dele"
SELECT to_regclass('public.crm_acessos') IS NOT NULL AS tem_acessos \gset
\if :tem_acessos
INSERT INTO auth.users (id, email) VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'restrito@t') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, approved) VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'Restrito', true)
ON CONFLICT (id) DO UPDATE SET approved = true;
UPDATE public.crm_acessos SET todos_numeros = false, numeros = ARRAY[:'n1']::uuid[], areas = '{"conversas":"editar"}', so_minhas = true
 WHERE user_id = 'bbbbbbbb-0000-0000-0000-000000000001';
\endif

\set Q1 'SELECT * FROM public.whatsapp_contacts ORDER BY updated_at DESC LIMIT 1000 OFFSET 9000'
\set Q2 'SELECT id, contact_phone, body, created_at FROM public.whatsapp_messages ORDER BY created_at DESC LIMIT 2000'
\set Q4 'SELECT * FROM public.crm_conversas_ultimas(now() - interval ''1 day'', ''{}''::jsonb) LIMIT 1000'

SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', false) \g /dev/null
SET ROLE authenticated;
\t on
SELECT teste.tempo('[acesso total] lista: 10a página de 1000 conversas', :'Q1');
SELECT teste.tempo('[acesso total] janela de 2000 mensagens recentes', :'Q2');
SELECT teste.tempo('[acesso total] chat: 50 mensagens de uma conversa',
  format('SELECT * FROM public.whatsapp_messages WHERE numero_id = %L AND contact_phone = %L ORDER BY created_at DESC LIMIT 50', :'n1', :'p1'));
SELECT teste.tempo('[acesso total] resumo crm_conversas_ultimas (1000)', :'Q4');
RESET ROLE;
\if :tem_acessos
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', false) \g /dev/null
SET ROLE authenticated;
SELECT teste.tempo('[restrito 1 número + só as dele] lista 1000 conversas', 'SELECT * FROM public.whatsapp_contacts ORDER BY updated_at DESC LIMIT 1000');
SELECT teste.tempo('[restrito 1 número + só as dele] 2000 mensagens recentes', :'Q2');
SELECT teste.tempo('[restrito 1 número + só as dele] chat 50 mensagens',
  format('SELECT * FROM public.whatsapp_messages WHERE numero_id = %L AND contact_phone = %L ORDER BY created_at DESC LIMIT 50', :'n1', :'p1'));
SELECT teste.tempo('[restrito 1 número + só as dele] resumo (1000)', :'Q4');
RESET ROLE;
\endif
\t off
