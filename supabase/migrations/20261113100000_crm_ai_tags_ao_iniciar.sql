-- "Tags ao começar" do agente de IA (21/10/2026): tags que o agente põe no contato quando assume a conversa, por
-- qualquer caminho (gatilho, modo "todas"/Ligado, botão "Transferir para IA" e passos de fluxo). Regras em
-- supabase/functions/_shared/iaTagsInicio.ts.
--
--  1) crm_ai_agents.tags_ao_iniciar text[] (padrão vazio = nada muda para os agentes que já existem).
--  2) crm_ai_aplicar_tags_inicio(numero, telefone, agente, origem): junta as tags do agente em whatsapp_contacts.tags
--     num UPDATE só (atômico): só adiciona, nunca remove, não duplica (compara por crm_tag_normalizar, então
--     "Comprou" e "comprou" são a mesma). Grava 'tags_aplicadas' em crm_ai_eventos quando adicionou alguma.
--     O UPDATE em tags dispara o trigger trg_crm_eventos_contato (evento 'tag'), o mesmo de quando a equipe põe a
--     tag à mão: automações e fluxos "recebeu a tag" disparam igual.
--  3) crm_ai_transferir_para_ia (botão "Transferir para IA"): mesma função de antes + as tags do agente, dentro de um
--     bloco protegido (falha ao pôr tag vira evento 'tags_falha' e a transferência continua valendo).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS e CREATE OR REPLACE. Não altera nenhuma conversa nem agente existente.
BEGIN;

-- 1) Coluna -------------------------------------------------------------------------------------
ALTER TABLE public.crm_ai_agents ADD COLUMN IF NOT EXISTS tags_ao_iniciar text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.crm_ai_agents.tags_ao_iniciar IS
  'Tags que o agente põe no contato quando assume a conversa (só adiciona, não duplica). Tela Agente IA > Quando a IA começa a atender.';

-- 2) Aplicar as tags ----------------------------------------------------------------------------
-- Devolve as tags adicionadas (vazio = agente sem tags ou o contato já tinha todas).
-- p_numero_id null = todas as conversas desse telefone (alcance do passo de fluxo "agente_ia").
CREATE OR REPLACE FUNCTION public.crm_ai_aplicar_tags_inicio(p_numero_id uuid, p_phone text, p_agent_slug text, p_origem text DEFAULT NULL)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_ag record;
  v_tags text[];
  v_add text[] := '{}';
  v_novas text[];
  v_r record;
BEGIN
  IF NOT public.crm_ai_pode() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  IF coalesce(p_phone, '') = '' OR p_phone LIKE '%@g.us' THEN RETURN '{}'; END IF;
  SELECT id, slug, nome, numero_id, tags_ao_iniciar INTO v_ag FROM public.crm_ai_agents WHERE slug = p_agent_slug;
  IF v_ag.id IS NULL THEN RETURN '{}'; END IF;
  -- normalizadas, sem vazias, sem repetidas, na ordem da tela, até 20
  SELECT coalesce(array_agg(t ORDER BY pos), '{}') INTO v_tags FROM (
    SELECT DISTINCT ON (public.crm_tag_normalizar(x)) public.crm_tag_normalizar(x) AS t, pos
      FROM unnest(coalesce(v_ag.tags_ao_iniciar, '{}')) WITH ORDINALITY AS u(x, pos)
     WHERE public.crm_tag_normalizar(x) <> ''
     ORDER BY public.crm_tag_normalizar(x), pos
  ) s;
  v_tags := v_tags[1:20];
  IF cardinality(v_tags) = 0 THEN RETURN '{}'; END IF;

  -- linha travada (FOR UPDATE): duas ativações ao mesmo tempo não duplicam nem perdem tag de quem editou junto
  FOR v_r IN
    SELECT c.id, coalesce(c.tags, '{}') AS tags FROM public.whatsapp_contacts c
     WHERE c.phone = p_phone AND (p_numero_id IS NULL OR c.numero_id = p_numero_id)
     FOR UPDATE
  LOOP
    v_novas := ARRAY(
      SELECT n.t FROM unnest(v_tags) WITH ORDINALITY AS n(t, pos)
       WHERE NOT EXISTS (SELECT 1 FROM unnest(v_r.tags) AS e(x) WHERE public.crm_tag_normalizar(e.x) = n.t)
       ORDER BY n.pos);
    CONTINUE WHEN cardinality(v_novas) = 0;
    UPDATE public.whatsapp_contacts SET tags = v_r.tags || v_novas, updated_at = now() WHERE id = v_r.id;
    v_add := v_add || ARRAY(SELECT x FROM unnest(v_novas) AS x WHERE NOT x = ANY (v_add));
  END LOOP;

  IF cardinality(v_add) > 0 THEN
    INSERT INTO public.crm_ai_eventos (contact_phone, numero_id, agent_slug, agent_id, tipo, detalhe, usuario_id)
    VALUES (p_phone, p_numero_id, v_ag.slug, v_ag.id, 'tags_aplicadas',
            left('tags ao começar (' || coalesce(nullif(p_origem, ''), 'ia') || '): ' || array_to_string(v_add, ', '), 1000), auth.uid());
  END IF;
  RETURN v_add;
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_aplicar_tags_inicio(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ai_aplicar_tags_inicio(uuid, text, text, text) TO authenticated, service_role;

-- 3) Botão "Transferir para IA": igual à 20261103100000 + tags (bloco protegido) ----------------------
CREATE OR REPLACE FUNCTION public.crm_ai_transferir_para_ia(p_numero_id uuid, p_phone text, p_agent_slug text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_ag record;
  v_n integer;
BEGIN
  IF NOT public.crm_ai_pode() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  IF p_phone LIKE '%@g.us' THEN RAISE EXCEPTION 'a IA nunca atende grupo'; END IF;
  SELECT id, slug, nome, numero_id, coalesce(tipo, 'atendimento') AS tipo INTO v_ag FROM public.crm_ai_agents WHERE slug = p_agent_slug;
  IF v_ag.id IS NULL THEN RAISE EXCEPTION 'agente não existe'; END IF;
  IF v_ag.tipo <> 'atendimento' THEN RAISE EXCEPTION 'agente de follow-up não atende conversa'; END IF;
  IF p_numero_id IS NOT NULL AND v_ag.numero_id IS DISTINCT FROM p_numero_id THEN
    RAISE EXCEPTION 'o agente % responde em outro número', v_ag.nome;
  END IF;
  UPDATE public.whatsapp_contacts
     SET ai_agent_slug = v_ag.slug, ai_pausado = false, ai_pausado_motivo = null, ai_atribuido_em = now(),
         ai_precisa_humano = false, ai_respostas = 0, ai_falhas = 0, updated_at = now()
   WHERE phone = p_phone AND (p_numero_id IS NULL OR numero_id = p_numero_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'conversa não encontrada'; END IF;
  INSERT INTO public.crm_ai_eventos (contact_phone, numero_id, agent_slug, agent_id, tipo, detalhe, usuario_id)
  VALUES (p_phone, p_numero_id, v_ag.slug, v_ag.id, 'transferido_ia', 'transferido para a IA (' || v_ag.nome || ')', auth.uid());
  -- tags ao começar: falha aqui desfaz só este bloco; a transferência acima continua valendo
  BEGIN
    PERFORM public.crm_ai_aplicar_tags_inicio(p_numero_id, p_phone, v_ag.slug, 'transferencia_manual');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.crm_ai_eventos (contact_phone, numero_id, agent_slug, agent_id, tipo, detalhe, usuario_id)
    VALUES (p_phone, p_numero_id, v_ag.slug, v_ag.id, 'tags_falha', left('tags ao começar não aplicadas: ' || SQLERRM, 1000), auth.uid());
  END;
  RETURN 'ok';
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_ai_transferir_para_ia(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ai_transferir_para_ia(uuid, text, text) TO authenticated, service_role;

COMMIT;

-- =============================================================
-- DEPOIS DE RODAR: publicar as edge functions openwa-webhook (gatilho e modo "todas") e crm-automacoes (passos de
-- fluxo). O botão "Transferir para IA" já passa a aplicar as tags só com esta migration.
-- Desfazer só o efeito (sem apagar a coluna): UPDATE public.crm_ai_agents SET tags_ao_iniciar = '{}';
-- =============================================================
