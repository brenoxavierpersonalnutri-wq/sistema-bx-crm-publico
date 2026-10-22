ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS whatsapp_clicked_at timestamptz,
  ADD COLUMN IF NOT EXISTS passed_pitch_01 boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_consultations_whatsapp_clicked_at ON public.consultations (whatsapp_clicked_at);
CREATE INDEX IF NOT EXISTS idx_consultations_passed_pitch_01 ON public.consultations (passed_pitch_01) WHERE passed_pitch_01 = true;

-- Public RPC: marca clique no WhatsApp na tela pós-agendamento (chamado sem auth)
CREATE OR REPLACE FUNCTION public.mark_whatsapp_clicked(p_consultation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.consultations
     SET whatsapp_clicked_at = COALESCE(whatsapp_clicked_at, now()),
         updated_at = now()
   WHERE id = p_consultation_id;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_whatsapp_clicked(uuid) TO anon, authenticated;

-- book_public_consultation precisa retornar o id da consulta pro front conseguir marcar o clique depois.
-- Como o retorno atual é boolean, criamos uma variante nova que devolve o UUID.
CREATE OR REPLACE FUNCTION public.book_public_consultation_v2(
  p_client_name text,
  p_client_phone text,
  p_date text,
  p_time text,
  p_funnel text DEFAULT 'trafego',
  p_utm_source text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL,
  p_utm_content text DEFAULT NULL,
  p_utm_term text DEFAULT NULL,
  p_lead_score integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
  v_id uuid;
BEGIN
  v_ok := public.book_public_consultation(
    p_client_name, p_client_phone, p_date, p_time, p_funnel,
    p_utm_source, p_utm_campaign, p_utm_medium, p_utm_content, p_utm_term, p_lead_score
  );
  IF v_ok THEN
    SELECT id INTO v_id
      FROM public.consultations
     WHERE client_phone = p_client_phone
       AND date = p_date::date
       AND to_char(start_time AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') = p_time
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_public_consultation_v2(text,text,text,text,text,text,text,text,text,text,integer) TO anon, authenticated;