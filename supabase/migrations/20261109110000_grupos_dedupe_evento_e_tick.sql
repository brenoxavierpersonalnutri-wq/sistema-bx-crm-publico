-- =============================================================
-- GRUPOS: entrada/saída contada UMA vez por grupo do WhatsApp e tick sem acordar à toa (revisão 20/10/2026).
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente (só CREATE OR REPLACE de funções).
--
-- 1) grupos_registrar_evento_membros: o mesmo chat_id em duas campanhas (ex.: importado nos Avulsos e numa
--    campanha) gerava DOIS eventos -> boas-vindas em dobro e entradas/saídas contadas duas vezes. Agora o evento
--    vai para UMA linha: grupo ativo, de campanha não avulsa, com boas-vindas ligada, a mais nova. A recontagem
--    de participantes continua pedida para todas as linhas do grupo.
-- 2) grupos_disparo_tick: campanha com auto_criar num número que não cria grupo (só sessão grupos-N, a mesma
--    regra de numeroCriaGrupo em _shared/grupos.ts) acordava a função todo minuto para nada. Agora não acorda;
--    volta sozinho quando o número da campanha (ou a sessão dele) mudar para um que cria.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.grupos_registrar_evento_membros(
  p_chat_id text, p_tipo text, p_participantes text[], p_chave text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g     record;
  v_ids text[];
  v_qtd int;
BEGIN
  IF p_chat_id !~ '^\d{5,25}(-\d{5,15})?@g\.us$' OR p_tipo NOT IN ('entrada', 'saida') THEN RETURN 0; END IF;
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_ids
    FROM unnest(coalesce(p_participantes, '{}')) AS x WHERE x ~ '^(\d{8,15}@c\.us|\d{5,25}@lid)$';
  v_ids := v_ids[1:256];
  v_qtd := greatest(cardinality(v_ids), 1);

  -- uma linha só por grupo do WhatsApp (dedupe por chat_id)
  SELECT gr.id, gr.campanha_id, c.boas_vindas_ligada INTO g
    FROM public.grupos_campanha_grupos gr JOIN public.grupos_campanhas c ON c.id = gr.campanha_id
   WHERE gr.chat_id = p_chat_id AND NOT c.encerrada
   ORDER BY gr.ativo DESC, c.avulsa ASC, c.boas_vindas_ligada DESC, gr.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;

  INSERT INTO public.grupos_membros_eventos (campanha_id, grupo_id, tipo, quantidade, participantes, boas_vindas_pendente, chave)
  VALUES (g.campanha_id, g.id, p_tipo, v_qtd,
          CASE WHEN p_tipo = 'entrada' AND g.boas_vindas_ligada THEN v_ids ELSE '{}' END,
          p_tipo = 'entrada' AND g.boas_vindas_ligada AND cardinality(v_ids) > 0,
          md5(left(coalesce(p_chave, ''), 4000)))
  ON CONFLICT (grupo_id, chave) DO NOTHING;
  IF NOT FOUND THEN RETURN 0; END IF;

  UPDATE public.grupos_campanha_grupos
     SET entradas = entradas + CASE WHEN p_tipo = 'entrada' THEN v_qtd ELSE 0 END,
         saidas   = saidas   + CASE WHEN p_tipo = 'saida'   THEN v_qtd ELSE 0 END
   WHERE id = g.id;
  -- pede recontagem logo (no máximo 1 a cada 2 min por grupo), em todas as campanhas que têm o grupo
  UPDATE public.grupos_campanha_grupos
     SET participantes_em = NULL
   WHERE chat_id = p_chat_id AND participantes_em < now() - interval '2 minutes';
  RETURN 1;
END $$;
REVOKE ALL ON FUNCTION public.grupos_registrar_evento_membros(text, text, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grupos_registrar_evento_membros(text, text, text[], text) TO service_role;

CREATE OR REPLACE FUNCTION public.grupos_disparo_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url     text;
  v_segredo text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.grupos_mensagens m JOIN public.grupos_campanhas c ON c.id = m.campanha_id
                  WHERE m.status = 'agendada' AND m.agendado_para <= now() + interval '1 minute'
                    AND NOT c.disparos_pausados AND NOT c.encerrada)
     AND NOT EXISTS (SELECT 1 FROM public.grupos_envios WHERE status = 'pendente')
     AND NOT EXISTS (SELECT 1 FROM public.grupos_campanha_grupos g JOIN public.grupos_campanhas c ON c.id = g.campanha_id
                      WHERE NOT c.encerrada AND NOT c.link_pausado AND g.ativo AND g.chat_id IS NOT NULL
                        AND (g.participantes_em IS NULL OR g.participantes_em < now() - interval '10 minutes'))
     AND NOT EXISTS (SELECT 1 FROM public.grupos_campanhas c
                      WHERE c.auto_criar AND NOT c.encerrada AND NOT c.link_pausado
                        -- só número que cria grupo (sessão grupos-N, igual numeroCriaGrupo)
                        AND EXISTS (SELECT 1 FROM public.crm_numeros n
                                     WHERE n.id = c.numero_id AND n.sessao_openwa ~ '^grupos-\d{1,3}$')
                        AND public.grupos_vagas(c.id) < c.folga_vagas
                        AND (SELECT count(*) FROM public.grupos_campanha_grupos g WHERE g.campanha_id = c.id) < c.max_grupos)
     AND NOT EXISTS (SELECT 1 FROM public.grupos_campanhas c
                      WHERE c.criacao_agendada_para IS NOT NULL AND c.criacao_agendada_para <= now() AND NOT c.encerrada)
     AND NOT EXISTS (SELECT 1 FROM public.grupos_membros_eventos e
                      WHERE e.boas_vindas_pendente AND e.created_at > now() - interval '6 hours') THEN
    RETURN 'nada a fazer';
  END IF;

  SELECT valor INTO v_url FROM public.integracao_config WHERE chave = 'grupos_disparo_fn_url';
  SELECT valor INTO v_segredo FROM public.integracao_config WHERE chave = 'grupos_disparo_segredo';
  IF v_url IS NULL OR v_url !~ '^https://' OR v_segredo IS NULL THEN
    RETURN 'sem url/segredo';
  END IF;

  PERFORM net.http_post(
    url                  := v_url,
    body                 := jsonb_build_object('modo', 'tick'),
    headers              := jsonb_build_object('Content-Type', 'application/json', 'x-grupos-segredo', v_segredo),
    timeout_milliseconds := 150000
  );
  RETURN 'chamado';
END;
$$;
REVOKE ALL ON FUNCTION public.grupos_disparo_tick() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Conferir (só leitura): SELECT public.grupos_disparo_tick();  -> 'nada a fazer' ou 'chamado'
