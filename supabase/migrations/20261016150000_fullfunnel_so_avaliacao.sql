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

