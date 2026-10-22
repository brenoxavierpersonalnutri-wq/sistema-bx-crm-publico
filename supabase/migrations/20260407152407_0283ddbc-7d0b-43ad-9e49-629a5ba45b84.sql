DROP FUNCTION IF EXISTS public.book_public_consultation(text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.book_public_consultation(
  p_client_name text,
  p_client_phone text,
  p_date text,
  p_time text,
  p_funnel text DEFAULT 'trafego'::text,
  p_utm_source text DEFAULT NULL::text,
  p_utm_campaign text DEFAULT NULL::text,
  p_utm_medium text DEFAULT NULL::text,
  p_utm_content text DEFAULT NULL::text,
  p_utm_term text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_exists boolean;
  v_full_timestamp timestamp with time zone;
  v_requested_date date;
  v_now_sp timestamp without time zone;
  v_today_sp date;
BEGIN
  v_requested_date := p_date::date;
  v_now_sp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_today_sp := v_now_sp::date;

  IF v_requested_date <= v_today_sp THEN
    RAISE EXCEPTION 'Agendamento no mesmo dia não é permitido.';
  END IF;

  IF v_now_sp::time >= time '12:00' AND v_requested_date <= (v_today_sp + 1) THEN
    RAISE EXCEPTION 'Após 12h, o próximo dia também fica bloqueado para agendamento.';
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.consultations
    WHERE date = v_requested_date
      AND left(start_time::text, 5) = p_time
  ) INTO v_exists;

  IF v_exists THEN
    RAISE EXCEPTION 'Horário já reservado.';
  END IF;

  v_full_timestamp := (p_date || ' ' || p_time || ':00 -03:00')::timestamp with time zone;

  INSERT INTO public.consultations (
    client_name,
    client_phone,
    date,
    start_time,
    status,
    via,
    lead_quality,
    gave_signal,
    signal_residue_paid,
    utm_source,
    utm_campaign,
    utm_medium,
    utm_content,
    utm_term
  ) VALUES (
    p_client_name,
    p_client_phone,
    v_requested_date,
    v_full_timestamp,
    'pendente',
    COALESCE(NULLIF(trim(p_funnel), ''), 'trafego'),
    'frio',
    false,
    false,
    NULLIF(trim(p_utm_source), ''),
    NULLIF(trim(p_utm_campaign), ''),
    NULLIF(trim(p_utm_medium), ''),
    NULLIF(trim(p_utm_content), ''),
    NULLIF(trim(p_utm_term), '')
  );

  RETURN TRUE;
END;
$function$;