-- =============================================================
-- URGENTE (privacidade): lead de site de cliente da BG Implementação NÃO vai para o Full Funnel do Breno.
-- Rodar inteiro no SQL editor do Lovable Cloud. Idempotente. NÃO apaga dado. NÃO envia mensagem.
-- Pode rodar sozinha, antes das outras migrations deste lote. RODAR ANTES de publicar a edge function
-- submit-form-response nova (ela grava as duas colunas abaixo; sem elas, cai no insert antigo, mas é mais lento).
--
-- PROBLEMA (auditoria de 21/10/2026): o trigger trg_fullfunnel_lead_qualificado mandou 8 leads de site de
-- cliente ao Full Funnel em 7 dias. O SellFlux tem filtro por host (SELLFLUX_HOSTS_PERMITIDOS na edge function),
-- o Full Funnel não tinha nenhum: o host não era gravado na linha.
--
-- CONSERTO (duas camadas, a mesma regra para SellFlux, Full Funnel, base de leads e eventos de fluxo):
--   1. lead_form_responses ganha origem_host (host do Origin/Referer) e host_breno (true/false = o host está na
--      MESMA allowlist do SellFlux; NULL = linha antiga ou gravada sem a edge function). Quem decide é a edge
--      function, com a lista única dela (supabase/functions/_shared/hostsBreno.ts).
--   2. public.base_leads_form_de_cliente(r) passa a ser verdadeiro também quando host_breno = false, além da
--      regra antiga (sufixo da conta de anúncio do cliente nas UTMs e respostas do quiz de joelho do Jhonny).
--      Essa função já é usada pela base de leads, pela visão unificada e pelos eventos de fluxo; agora também
--      pelo Full Funnel.
--   3. fullfunnel_enfileirar não enfileira lead de cliente: grava só uma linha 'bloqueado_cliente' (sem telefone
--      e sem payload) para dar para conferir que o filtro age. fullfunnel_disparar confere de novo antes de cada
--      envio e reenvio (pega o que já estava na fila em 'erro').
--
-- Enquanto a edge function nova não for publicada, vale a camada da regra antiga (que é a que achou os 8).
-- =============================================================
BEGIN;

-- 1. Colunas -------------------------------------------------------------------------------------------
ALTER TABLE public.lead_form_responses ADD COLUMN IF NOT EXISTS origem_host text;
ALTER TABLE public.lead_form_responses ADD COLUMN IF NOT EXISTS host_breno boolean;
COMMENT ON COLUMN public.lead_form_responses.origem_host IS
  'Host do Origin/Referer de quem chamou submit-form-response (NULL = linha antiga ou insert fora da edge function).';
COMMENT ON COLUMN public.lead_form_responses.host_breno IS
  'true = host na allowlist do Breno (mesma do SellFlux); false = site de cliente/desconhecido; NULL = não medido.';

-- 2. Regra única de "lead de site de cliente" -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.base_leads_form_de_cliente(r public.lead_form_responses)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT r.host_breno IS FALSE
      OR concat_ws(' ', r.utm_campaign, r.utm_content, r.utm_term, r.utm_medium)
           ~ '(^|\D)120\d{11}(0608|0464|0226|0698)(\D|$)'
      OR coalesce(r.p1_objetivo, '') IN ('reduzir_dores', 'intensificar_rotina', 'treinar_sem_risco', 'emagrecer_rapido')
$$;

-- 3. Full Funnel: enfileirar com o filtro ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fullfunnel_enfileirar(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        public.lead_form_responses;
  v_tel    text;
  v_envio  bigint;
BEGIN
  IF coalesce((SELECT valor FROM public.integracao_config WHERE chave = 'fullfunnel_ativo'), 'false') <> 'true' THEN
    RETURN;
  END IF;

  SELECT * INTO r FROM public.lead_form_responses WHERE id = p_lead_id;
  IF NOT FOUND OR r.nivel IS NULL OR r.nivel = 'DQ' THEN
    RETURN;
  END IF;

  -- 16/10/2026 (Breno): só leads da AVALIAÇÃO. Acompanhamento individual não vai ao Full Funnel.
  IF coalesce(nullif(btrim(r.origem), ''), 'avaliacao') <> 'avaliacao' THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.fullfunnel_envios WHERE lead_id = p_lead_id) THEN
    RETURN;
  END IF;

  -- 21/10/2026 (privacidade): lead de site de cliente da BG Implementação não sai para o Full Funnel do Breno.
  -- Fica só o registro do bloqueio, sem telefone e sem payload.
  IF public.base_leads_form_de_cliente(r) THEN
    INSERT INTO public.fullfunnel_envios (lead_id, telefone_e164, payload, status, erro)
    VALUES (r.id, NULL, '{}'::jsonb, 'bloqueado_cliente', 'lead de site de cliente');
    RETURN;
  END IF;

  v_tel := public.telefone_e164(r.telefone);

  IF v_tel IS NULL THEN
    INSERT INTO public.fullfunnel_envios (lead_id, telefone_e164, payload, status, erro)
    VALUES (r.id, NULL, public.fullfunnel_payload(r), 'sem_telefone', left(coalesce(r.telefone, '(vazio)'), 40));
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.fullfunnel_envios
     WHERE telefone_e164 = v_tel
       AND status IN ('pendente', 'enviado', 'ok', 'erro')
       AND criado_em > now() - interval '24 hours'
  ) THEN
    INSERT INTO public.fullfunnel_envios (lead_id, telefone_e164, payload, status)
    VALUES (r.id, v_tel, public.fullfunnel_payload(r), 'duplicado');
    RETURN;
  END IF;

  INSERT INTO public.fullfunnel_envios (lead_id, telefone_e164, payload, status)
  VALUES (r.id, v_tel, public.fullfunnel_payload(r), 'pendente')
  RETURNING id INTO v_envio;

  BEGIN
    PERFORM public.fullfunnel_disparar(v_envio);
  EXCEPTION WHEN OTHERS THEN
    -- pg_net fora do ar: a linha fica em erro e o pg_cron reenvia.
    UPDATE public.fullfunnel_envios
       SET status = 'erro', erro = left(SQLERRM, 300), atualizado_em = now()
     WHERE id = v_envio;
  END;
END;
$$;

-- 4. Full Funnel: disparar confere de novo (vale para os reenvios do pg_cron) ----------------------------
CREATE OR REPLACE FUNCTION public.fullfunnel_disparar(p_envio_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text;
  v_req bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.fullfunnel_envios e
      JOIN public.lead_form_responses r ON r.id = e.lead_id
     WHERE e.id = p_envio_id AND public.base_leads_form_de_cliente(r)
  ) THEN
    UPDATE public.fullfunnel_envios
       SET status = 'bloqueado_cliente', erro = 'lead de site de cliente', payload = '{}'::jsonb,
           telefone_e164 = NULL, atualizado_em = now()
     WHERE id = p_envio_id;
    RETURN;
  END IF;

  SELECT valor INTO v_url FROM public.integracao_config WHERE chave = 'fullfunnel_webhook_url';
  IF v_url IS NULL OR v_url !~ '^https://[^/]+/' THEN
    UPDATE public.fullfunnel_envios
       SET status = CASE WHEN status = 'amostra' THEN 'amostra_sem_url' ELSE 'erro' END,
           erro = 'sem URL https em integracao_config.fullfunnel_webhook_url',
           atualizado_em = now()
     WHERE id = p_envio_id;
    RETURN;
  END IF;

  SELECT net.http_post(
           url                  := v_url,
           body                 := e.payload,
           headers              := '{"Content-Type": "application/json"}'::jsonb,
           timeout_milliseconds := 10000
         )
    INTO v_req
    FROM public.fullfunnel_envios e
   WHERE e.id = p_envio_id;

  UPDATE public.fullfunnel_envios
     SET status = CASE WHEN status = 'amostra' THEN 'amostra_enviada' ELSE 'enviado' END,
         request_id = v_req, tentativas = tentativas + 1, erro = NULL, atualizado_em = now()
   WHERE id = p_envio_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fullfunnel_disparar(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fullfunnel_enfileirar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fullfunnel_enfileirar(uuid) TO service_role;

COMMIT;

-- =============================================================
-- CONFERIR DEPOIS DE RODAR (só leitura):
--
-- a) Leads de cliente que JÁ foram ao Full Funnel (sem nome/telefone na saída; troque count por e.lead_id
--    para ter os ids que serão procurados no Full Funnel):
--   SELECT e.status, count(*) AS envios, min(e.criado_em) AS primeiro, max(e.criado_em) AS ultimo
--     FROM public.fullfunnel_envios e JOIN public.lead_form_responses r ON r.id = e.lead_id
--    WHERE public.base_leads_form_de_cliente(r)
--    GROUP BY 1 ORDER BY 1;
--   -- 'ok' / 'enviado' = chegou ao Full Funnel; 'duplicado' / 'sem_telefone' = não saiu; 'bloqueado_cliente' = barrado
--
-- b) O filtro está agindo (aparece depois do próximo lead de cliente):
--   SELECT status, count(*) FROM public.fullfunnel_envios WHERE criado_em > now() - interval '1 day' GROUP BY 1;
--
-- c) Depois de publicar a edge function: hosts que chegaram (ninguém de fora da lista deve ter host_breno = true):
--   SELECT origem_host, host_breno, count(*) FROM public.lead_form_responses
--    WHERE created_at > now() - interval '1 day' GROUP BY 1, 2 ORDER BY 3 DESC;
-- =============================================================
