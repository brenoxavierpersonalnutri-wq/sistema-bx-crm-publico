-- Cenário do teste do ROLLBACK, montado ANTES das migrations de permissão (como a produção de hoje). Só banco descartável.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

-- No Supabase, anon/authenticated/service_role têm GRANT em storage.objects (quem barra é o RLS); o stub não tem.
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;

-- identidades: ADMIN (Breno), COMUM (aprovado comum, já existia), PEND (pendente), NOVO (aprovado; depois das
-- migrations o rollback.sh o desaprova e reaprova, e ele ganha o acesso PADRÃO do usuário novo: nenhum).
INSERT INTO auth.users (id, email) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'comum@t'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'pend@t'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'novo@t')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, approved) VALUES
  ('00000000-0000-0000-0000-0000000000ad', 'Admin Breno', true),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Comum', true),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Pendente', false),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'Novo', true)
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, approved = EXCLUDED.approved;
UPDATE public.profiles SET meta_access_token = 'tok-comum' WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';

-- dados: conversas em 3 números, mensagens, eventos, IA, automação, grupos, base, tags, mídia
INSERT INTO public.whatsapp_contacts (numero_id, phone, name, ai_agent_slug)
SELECT n.id, v.phone, v.name, v.slug
  FROM (VALUES ('comercial-fit-2', '5511900000001', 'c1', NULL), ('comercial-fit-2', '5511900000002', 'c2', NULL),
               ('suporte-consultoria-1', '5511900000006', 'c6 suporte', NULL), ('closer', '5511900000007', 'c7 closer', NULL),
               ('comercial-fit-2', '5511900000008', 'c8 com IA', 'agente-teste')) v(chave, phone, name, slug)
  JOIN public.crm_numeros n ON n.chave = v.chave
ON CONFLICT DO NOTHING;
INSERT INTO public.whatsapp_messages (numero_id, contact_phone, body, message_id)
SELECT c.numero_id, c.phone, 'oi ' || g, 'msg-' || c.phone || '-' || g FROM public.whatsapp_contacts c, generate_series(1, 2) g
 WHERE c.phone LIKE '55119000000%' ON CONFLICT DO NOTHING;
INSERT INTO public.crm_contato_eventos (contact_phone, tipo, valor)
SELECT phone, 'tag', 'x' FROM public.whatsapp_contacts WHERE phone LIKE '55119000000%';
INSERT INTO public.crm_automacoes (nome, gatilho_tipo) VALUES ('auto teste', 'tag');
INSERT INTO public.crm_ai_agents (slug, nome, numero_id)
SELECT 'agente-teste', 'Agente Teste', id FROM public.crm_numeros WHERE chave = 'comercial-fit-2' ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.crm_ai_conhecimento (agent_id, tipo) SELECT id, 'texto' FROM public.crm_ai_agents WHERE slug = 'agente-teste';
INSERT INTO public.crm_ai_eventos (contact_phone, numero_id, tipo, detalhe)
SELECT phone, numero_id, 'teste', 'x' FROM public.whatsapp_contacts WHERE phone LIKE '55119000000%';
INSERT INTO public.grupos_campanhas (slug, nome) VALUES ('camp-teste', 'Campanha teste') ON CONFLICT DO NOTHING;
INSERT INTO public.grupos_mensagens (campanha_id, tipo, texto, agendado_para)
SELECT id, 'texto', 'x', now() + interval '1 day' FROM public.grupos_campanhas WHERE slug = 'camp-teste';
INSERT INTO public.base_leads (origem, origem_id, nome) VALUES ('teste', 'bl-1', 'Lead base') ON CONFLICT DO NOTHING;
INSERT INTO public.crm_tags (nome) VALUES ('vip') ON CONFLICT DO NOTHING;
INSERT INTO public.whatsapp_wa_nomes (wid, nome, telefone) VALUES ('5511900000006@c.us', 'Nome WA', '5511900000006') ON CONFLICT DO NOTHING;
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('whatsapp-media', '5511900000006/a.jpg'), ('whatsapp-media', '5511900000001/b.jpg'),
  ('whatsapp-media', 'roteiros/r1/c.jpg'), ('whatsapp-media', 'ia/agente-teste/d.pdf');

-- tabelas da matriz: o mapa da 20261123110000 + as que a 130000 acrescentou + profiles; só as que existem AGORA (antes)
INSERT INTO teste.tabelas (tabela, coluna)
SELECT c.relname, (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                     AND a.attgenerated = '' AND a.attidentity <> 'a' ORDER BY a.attnum LIMIT 1)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
 WHERE c.relkind = 'r' AND c.relname = ANY (ARRAY[
   'whatsapp_contacts','whatsapp_messages','crm_contato_eventos','crm_roteiro_envios','crm_ai_eventos','crm_ai_fila',
   'crm_automacao_fila','crm_automacao_log','crm_fluxo_execucoes','whatsapp_backfill_jobs','whatsapp_backfill_chats',
   'whatsapp_wa_nomes','crm_numeros','crm_automacoes','crm_campanhas','crm_envio_config','crm_wa_templates','crm_fluxos',
   'crm_fluxo_pastas','crm_fluxo_base_vistos','crm_fluxo_entradas','crm_roteiros','crm_roteiro_passos','crm_ai_agents',
   'crm_ai_conhecimento','crm_ai_exemplos','crm_ai_prompt_versoes','ai_agent_settings','crm_segmentos','base_leads',
   'crm_grupo_links','grupos_campanhas','grupos_campanha_grupos','grupos_cliques','grupos_criacoes','grupos_disparo_estado',
   'grupos_envios','grupos_membros_eventos','grupos_mensagens','ig_contas','ig_kanban','ig_mensagens','live_rooms',
   'live_destinations','live_invites','live_overlays','live_reprise_series','live_semanas','live_videos','webinars',
   'webinar_sessions','webinar_registrations','webinar_attendance','webinar_chat_messages','webinar_chat_script',
   'webinar_offers','webinar_reminders_queue','webinar_analytics','ig_contatos','base_leads_segmentos','crm_tags','profiles'])
ON CONFLICT DO NOTHING;
