CREATE OR REPLACE FUNCTION public.book_public_consultation(p_client_name text, p_client_phone text, p_date text, p_time text, p_funnel text DEFAULT 'trafego'::text, p_utm_source text DEFAULT NULL::text, p_utm_campaign text DEFAULT NULL::text, p_utm_medium text DEFAULT NULL::text, p_utm_content text DEFAULT NULL::text, p_utm_term text DEFAULT NULL::text, p_lead_score integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_full_timestamp timestamp with time zone;
  v_requested_date date;
  v_today_sp date;
  v_dow text;
  v_slot_time time;
  v_slot_available boolean;
  v_booked_count int;
  v_slot_capacity int;
BEGIN
  v_requested_date := p_date::date;
  v_today_sp := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_dow := extract(dow from v_requested_date)::text;
  v_slot_time := (p_time || ':00')::time;

  IF v_requested_date <= v_today_sp THEN
    RAISE EXCEPTION 'Agendamento no mesmo dia não é permitido.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p,
         LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(COALESCE(p.availability_overrides -> p_date, p.availability_weekly -> v_dow, '[]'::jsonb)) = 'array'
                THEN COALESCE(p.availability_overrides -> p_date, p.availability_weekly -> v_dow, '[]'::jsonb)
                ELSE '[]'::jsonb END
         ) AS r
    WHERE p.approved = true AND p.is_closer = true
      AND v_slot_time >= ((r->>'start') || ':00')::time
      AND v_slot_time <  ((r->>'end')   || ':00')::time
  ) INTO v_slot_available;

  IF NOT v_slot_available THEN
    RAISE EXCEPTION 'Horário fora da disponibilidade configurada.';
  END IF;

  SELECT COUNT(*) INTO v_booked_count
  FROM public.consultations
  WHERE date = v_requested_date
    AND to_char(start_time AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') = p_time
    AND refunded IS NOT TRUE;

  SELECT COALESCE(SUM(
    CASE WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(COALESCE(p.availability_overrides -> p_date, p.availability_weekly -> v_dow, '[]'::jsonb)) = 'array'
             THEN COALESCE(p.availability_overrides -> p_date, p.availability_weekly -> v_dow, '[]'::jsonb)
             ELSE '[]'::jsonb END
      ) AS r
      WHERE v_slot_time >= ((r->>'start')||':00')::time
        AND v_slot_time <  ((r->>'end')||':00')::time
    ) THEN p.concurrent_capacity ELSE 0 END
  ), 0)
  INTO v_slot_capacity
  FROM public.profiles p
  WHERE p.approved = true AND p.is_closer = true;

  IF v_booked_count >= GREATEST(v_slot_capacity, 1) THEN
    RAISE EXCEPTION 'Horário já reservado.';
  END IF;

  v_full_timestamp := (p_date || ' ' || p_time || ':00 -03:00')::timestamp with time zone;

  INSERT INTO public.consultations (
    client_name, client_phone, date, start_time, status, via,
    lead_quality, gave_signal, signal_residue_paid,
    utm_source, utm_campaign, utm_medium, utm_content, utm_term, lead_score
  ) VALUES (
    p_client_name, p_client_phone, v_requested_date, v_full_timestamp,
    'pendente', COALESCE(NULLIF(trim(p_funnel), ''), 'trafego'),
    'frio', false, false,
    NULLIF(trim(p_utm_source), ''), NULLIF(trim(p_utm_campaign), ''),
    NULLIF(trim(p_utm_medium), ''), NULLIF(trim(p_utm_content), ''),
    NULLIF(trim(p_utm_term), ''), p_lead_score
  );

  RETURN TRUE;
END;
$function$;