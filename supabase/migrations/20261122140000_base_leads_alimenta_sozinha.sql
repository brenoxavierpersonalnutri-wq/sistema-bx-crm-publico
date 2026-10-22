-- =============================================================
-- Base de leads se alimenta sozinha (e backfill de 17/10/2026 até agora).
-- Rodar inteiro no SQL editor do Lovable Cloud, DEPOIS da 20261122130000. Idempotente. NÃO apaga dado.
-- Nada aqui envia mensagem: o backfill entra com os eventos de fluxo desligados (ver "EVENTOS" abaixo).
--
-- PROBLEMA (auditoria de 21/10/2026): public.base_leads foi preenchida UMA vez (upsert da 20261021100000) e parou
-- em 17/10 18:07 UTC. Formulário, agendamento, compra, aluna e contato novo de WhatsApp caem nas tabelas de origem,
-- mas nada copiava para a base. A cópia materializada (Banco de dados) era refeita a cada 10 min a partir de uma
-- tabela parada.
--
-- POR QUE UM PASSO NO CRON E NÃO TRIGGER EM CADA TABELA:
--   * Não toca no caminho de gravação do lead. openwa-webhook faz upsert de whatsapp_contacts a cada mensagem e
--     consultations muda a cada clique do time; um trigger lento ou com erro atrasaria (ou derrubaria) essas
--     gravações. O cron roda à parte.
--   * Se conserta sozinho. A janela parte do último sucesso menos 1 hora; se o cron falhar ou o banco cair, a
--     rodada seguinte pega tudo o que ficou para trás. Trigger que falha perde a linha para sempre.
--   * Pega TODAS as portas, inclusive as que não passam por edge function (insert pelo front, import no SQL editor,
--     whatsapp-import-history, backfill), e as mudanças posteriores (agendamento que vira "compareceu"/"comprou").
--   * A regra mora num lugar só (base_leads_sincronizar), a mesma da 20261021100000.
--   * Custo: até 10 min de atraso, que é o mesmo atraso que a tela já tinha, porque ela lê a cópia materializada
--     refeita a cada 10 min. O passo roda logo ANTES do refresh, na mesma chamada.
--
-- CHAVE NATURAL (não duplica): (origem, origem_id), o UNIQUE que a tabela já tem. origem_id = id da linha na
-- tabela de origem. Rodar de novo só atualiza o que mudou (DO UPDATE ... WHERE IS DISTINCT FROM), sem reescrever
-- linha igual.
--
-- REGRAS (iguais às da 20261021100000, com dois acréscimos):
--   formulário  -> origem avaliacao/individual, fora lead de site de cliente (base_leads_form_de_cliente, que
--                  agora também olha host_breno = false; migration 20261122130000)
--   agendamento -> origem agendamento        compra -> origem compra (sales_events)
--   aluna       -> origem aluna, fora is_teste
--   WhatsApp    -> origem crm_whatsapp, fora os que a própria base empurrou (source = 'base_leads') e, NOVO,
--                  fora grupos (is_group ou phone com @), mesmo critério do evento banco_contato_whatsapp
--   fluxo-entrada e link de grupo já gravam direto na base (origens webhook:* e grupo_whatsapp): não mudam.
--
-- EVENTOS: base_leads tem o trigger trg_crm_evt_base_lead (gatilho "Novo lead no banco de dados" dos fluxos).
--   Na rodada normal do cron ele dispara como foi desenhado (lead novo na base = evento, se houver fluxo ligado).
--   No BACKFILL não: base_leads_sincronizar(..., p_sem_evento => true) liga app.base_leads_sem_evento só na
--   transação, e o trigger sai sem gravar evento. Ninguém recebe mensagem por causa dos ~600 atrasados.
-- =============================================================
BEGIN;

-- 1. Estado (último sucesso = começo da janela da próxima rodada) ----------------------------------------
CREATE TABLE IF NOT EXISTS public.base_leads_sync_estado (
  id               integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultimo_ok        timestamptz,
  ultima_tentativa timestamptz,
  ultimo_erro      text,
  ultimas_linhas   jsonb
);
ALTER TABLE public.base_leads_sync_estado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.base_leads_sync_estado FROM PUBLIC, anon, authenticated;
INSERT INTO public.base_leads_sync_estado (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2. Evento de fluxo pode ser desligado na transação (backfill) -----------------------------------------
CREATE OR REPLACE FUNCTION public.crm_evt_base_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fone text := public.base_leads_tel_e164(NEW.telefone_e164);
BEGIN
  IF coalesce(current_setting('app.base_leads_sem_evento', true), '') = 'on' THEN RETURN NEW; END IF;
  IF v_fone IS NULL THEN RETURN NEW; END IF;
  PERFORM public.crm_evento_banco(v_fone, 'banco_base_leads', 'base_leads', jsonb_build_object(
    'origem', lower(NEW.origem), 'nivel', NEW.nivel, 'nome', nullif(btrim(NEW.nome), ''),
    'email', public.base_leads_email(NEW.email), 'produto', NEW.produto, 'tags', array_to_string(NEW.tags, ',')));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'crm_evt_base_lead: %', SQLERRM;
  RETURN NEW;
END $$;

-- 3. Sincronização ---------------------------------------------------------------------------------------
-- p_desde NULL = último sucesso - 1 h (ou últimas 24 h, na primeira vez). Devolve linhas inseridas+alteradas
-- por origem. Só postgres/service_role executam.
CREATE OR REPLACE FUNCTION public.base_leads_sincronizar(p_desde timestamptz DEFAULT NULL, p_sem_evento boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inicio timestamptz := clock_timestamp();
  v_desde  timestamptz;
  v_n      integer;
  v_out    jsonb := '{}'::jsonb;
BEGIN
  SELECT coalesce(p_desde, e.ultimo_ok - interval '1 hour', now() - interval '24 hours')
    INTO v_desde FROM public.base_leads_sync_estado e WHERE e.id = 1;
  v_desde := coalesce(v_desde, p_desde, now() - interval '24 hours');
  IF p_sem_evento THEN
    PERFORM set_config('app.base_leads_sem_evento', 'on', true);
  END IF;

  -- formulário de avaliação / individual (só do Breno)
  INSERT INTO public.base_leads AS b
    (origem, origem_id, nome, telefone_e164, email, tags, produto, status, nivel, score, criado_origem)
  SELECT
    CASE WHEN l.origem = 'individual' THEN 'individual' ELSE 'avaliacao' END,
    l.id::text,
    nullif(trim(l.nome), ''),
    public.base_leads_tel_e164(l.telefone),
    public.base_leads_email(l.email),
    array_remove(ARRAY[
      CASE WHEN l.origem = 'individual' THEN 'form-individual' ELSE 'form-avaliacao' END,
      CASE WHEN l.nivel IS NOT NULL THEN 'nivel-' || l.nivel END,
      CASE WHEN nullif(trim(l.utm_source), '') IS NOT NULL THEN 'utm-' || lower(trim(l.utm_source)) END,
      CASE WHEN l.p1_objetivo IS NOT NULL THEN 'objetivo-' || l.p1_objetivo END
    ], NULL),
    CASE WHEN l.origem = 'individual' THEN 'consultoria individual' ELSE 'avaliacao gratuita' END,
    l.nivel, l.nivel, l.score, l.created_at
  FROM public.lead_form_responses l
  WHERE (l.created_at >= v_desde OR l.updated_at >= v_desde)
    AND NOT public.base_leads_form_de_cliente(l)
  ON CONFLICT (origem, origem_id) DO UPDATE SET
    nome = EXCLUDED.nome, telefone_e164 = EXCLUDED.telefone_e164, email = EXCLUDED.email,
    tags = EXCLUDED.tags, produto = EXCLUDED.produto, status = EXCLUDED.status,
    nivel = EXCLUDED.nivel, score = EXCLUDED.score, criado_origem = EXCLUDED.criado_origem
  WHERE (b.nome, b.telefone_e164, b.email, b.tags, b.produto, b.status, b.nivel, b.score, b.criado_origem)
        IS DISTINCT FROM (EXCLUDED.nome, EXCLUDED.telefone_e164, EXCLUDED.email, EXCLUDED.tags, EXCLUDED.produto,
                          EXCLUDED.status, EXCLUDED.nivel, EXCLUDED.score, EXCLUDED.criado_origem);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('formulario', v_n);

  -- agenda (consultas marcadas)
  INSERT INTO public.base_leads AS b
    (origem, origem_id, nome, telefone_e164, email, tags, produto, status, criado_origem)
  SELECT
    'agendamento', c.id::text,
    nullif(trim(c.client_name), ''),
    public.base_leads_tel_e164(c.client_phone),
    public.base_leads_email(c.client_email),
    array_remove(ARRAY[
      'agendou',
      CASE WHEN nullif(trim(c.via), '') IS NOT NULL THEN 'via-' || lower(trim(c.via)) END,
      CASE WHEN c.attended THEN 'compareceu' END,
      CASE WHEN c.converted THEN 'comprou' END,
      CASE WHEN c.refunded THEN 'reembolso' END,
      CASE WHEN c.disqualified THEN 'desqualificado' END
    ], NULL),
    nullif(trim(c.event_type_name), ''),
    c.status, c.created_at
  FROM public.consultations c
  WHERE (c.created_at >= v_desde OR c.updated_at >= v_desde)
  ON CONFLICT (origem, origem_id) DO UPDATE SET
    nome = EXCLUDED.nome, telefone_e164 = EXCLUDED.telefone_e164, email = EXCLUDED.email,
    tags = EXCLUDED.tags, produto = EXCLUDED.produto, status = EXCLUDED.status,
    criado_origem = EXCLUDED.criado_origem
  WHERE (b.nome, b.telefone_e164, b.email, b.tags, b.produto, b.status, b.criado_origem)
        IS DISTINCT FROM (EXCLUDED.nome, EXCLUDED.telefone_e164, EXCLUDED.email, EXCLUDED.tags, EXCLUDED.produto,
                          EXCLUDED.status, EXCLUDED.criado_origem);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('agendamento', v_n);

  -- compras (webhooks PagTrust e outras plataformas, sales_events; sem updated_at)
  INSERT INTO public.base_leads AS b
    (origem, origem_id, nome, telefone_e164, email, tags, produto, status, criado_origem)
  SELECT
    'compra', s.id::text, NULL,
    public.base_leads_tel_e164(s.customer_phone),
    public.base_leads_email(s.customer_email),
    array_remove(ARRAY['comprou', CASE WHEN s.source IS NOT NULL THEN 'gateway-' || lower(s.source) END], NULL),
    s.source, 'compra', s.created_at
  FROM public.sales_events s
  WHERE s.created_at >= v_desde
  ON CONFLICT (origem, origem_id) DO UPDATE SET
    telefone_e164 = EXCLUDED.telefone_e164, email = EXCLUDED.email, tags = EXCLUDED.tags,
    produto = EXCLUDED.produto, status = EXCLUDED.status, criado_origem = EXCLUDED.criado_origem
  WHERE (b.telefone_e164, b.email, b.tags, b.produto, b.status, b.criado_origem)
        IS DISTINCT FROM (EXCLUDED.telefone_e164, EXCLUDED.email, EXCLUDED.tags, EXCLUDED.produto,
                          EXCLUDED.status, EXCLUDED.criado_origem);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('compra', v_n);

  -- alunas (fora as de teste)
  INSERT INTO public.base_leads AS b
    (origem, origem_id, nome, telefone_e164, email, tags, produto, status, criado_origem)
  SELECT
    'aluna', a.id::text,
    nullif(trim(a.nome_completo), ''),
    public.base_leads_tel_e164(a.telefone),
    NULL,
    array_remove(ARRAY['comprou', 'aluna', CASE WHEN a.programa IS NOT NULL THEN 'programa-' || lower(a.programa) END], NULL),
    a.programa, a.status,
    coalesce(a.data_compra::timestamptz, a.created_at)
  FROM public.alunas a
  WHERE coalesce(a.is_teste, false) = false
    AND (a.created_at >= v_desde OR a.updated_at >= v_desde)
  ON CONFLICT (origem, origem_id) DO UPDATE SET
    nome = EXCLUDED.nome, telefone_e164 = EXCLUDED.telefone_e164, tags = EXCLUDED.tags,
    produto = EXCLUDED.produto, status = EXCLUDED.status, criado_origem = EXCLUDED.criado_origem
  WHERE (b.nome, b.telefone_e164, b.tags, b.produto, b.status, b.criado_origem)
        IS DISTINCT FROM (EXCLUDED.nome, EXCLUDED.telefone_e164, EXCLUDED.tags, EXCLUDED.produto,
                          EXCLUDED.status, EXCLUDED.criado_origem);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('aluna', v_n);

  -- contatos de WhatsApp (sem grupos; os que a base empurrou para o kanban não voltam)
  INSERT INTO public.base_leads AS b
    (origem, origem_id, nome, telefone_e164, email, tags, produto, status, criado_origem)
  SELECT
    'crm_whatsapp', w.id::text,
    nullif(trim(w.name), ''),
    public.base_leads_tel_e164(w.phone),
    NULL,
    array_remove(ARRAY['crm-whatsapp', CASE WHEN w.stage IS NOT NULL THEN 'crm-' || lower(w.stage) END], NULL)
      || coalesce(w.tags, '{}'),
    NULL, w.stage, w.created_at
  FROM public.whatsapp_contacts w
  WHERE (w.created_at >= v_desde OR w.updated_at >= v_desde)
    AND coalesce(w.source, '') <> 'base_leads'
    AND NOT coalesce(w.is_group, false)
    AND coalesce(w.phone, '') NOT LIKE '%@%'
  ON CONFLICT (origem, origem_id) DO UPDATE SET
    nome = EXCLUDED.nome, telefone_e164 = EXCLUDED.telefone_e164, tags = EXCLUDED.tags,
    status = EXCLUDED.status, criado_origem = EXCLUDED.criado_origem
  WHERE (b.nome, b.telefone_e164, b.tags, b.status, b.criado_origem)
        IS DISTINCT FROM (EXCLUDED.nome, EXCLUDED.telefone_e164, EXCLUDED.tags, EXCLUDED.status, EXCLUDED.criado_origem);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('crm_whatsapp', v_n);

  -- marca o sucesso: a próxima rodada começa 1 h antes deste início (folga para transação que ainda não tinha commitado)
  UPDATE public.base_leads_sync_estado
     SET ultimo_ok = greatest(coalesce(ultimo_ok, v_inicio), v_inicio), ultima_tentativa = v_inicio,
         ultimo_erro = NULL, ultimas_linhas = v_out || jsonb_build_object('desde', v_desde)
   WHERE id = 1;
  IF p_sem_evento THEN
    PERFORM set_config('app.base_leads_sem_evento', 'off', true);
  END IF;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.base_leads_sincronizar(timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.base_leads_sincronizar(timestamptz, boolean) TO service_role;

-- 4. O cron de 10 min (base-leads-unificada-mat) chama esta função: sincroniza ANTES de refazer a cópia ----
-- Falha na sincronização não impede o refresh (subtransação) e fica anotada em base_leads_sync_estado.
CREATE OR REPLACE FUNCTION public.base_leads_unificada_atualizar()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_msg text;
BEGIN
  BEGIN
    PERFORM public.base_leads_sincronizar();
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    UPDATE public.base_leads_sync_estado SET ultima_tentativa = now(), ultimo_erro = left(v_msg, 500) WHERE id = 1;
    RAISE WARNING 'base_leads_sincronizar falhou: %', v_msg;
  END;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.base_leads_unificada_mat;
  UPDATE public.base_leads_unificada_estado
     SET atualizado_em = now(), linhas = (SELECT count(*) FROM public.base_leads_unificada_mat)
   WHERE id = 1;
END $$;
REVOKE ALL ON FUNCTION public.base_leads_unificada_atualizar() FROM PUBLIC, anon, authenticated;

-- 5. BACKFILL: de 17/10/2026 (a base parou em 17/10 18:07 UTC) até agora, sem evento de fluxo --------------
SET LOCAL statement_timeout = '10min';
SELECT public.base_leads_sincronizar('2026-10-17 00:00:00+00', true) AS backfill;

COMMIT;

-- =============================================================
-- CONFERIR (só leitura):
--   SELECT * FROM public.base_leads_sync_estado;                       -- ultimo_ok recente, ultimo_erro vazio
--   SELECT origem, count(*), max(importado_em) FROM public.base_leads GROUP BY 1 ORDER BY 1;
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'base-leads-unificada-mat';
--   -- fluxos LIGADOS que vão receber o evento "Novo lead no banco" a partir de agora (rodada normal do cron):
--   SELECT id, nome FROM public.crm_fluxos WHERE ativo AND excluido_em IS NULL
--      AND gatilhos @> '[{"tipo":"banco","fonte":"base_leads"}]';
-- Desligar só a sincronização (mantendo o refresh): voltar a função base_leads_unificada_atualizar da 20261029110000.
-- =============================================================
