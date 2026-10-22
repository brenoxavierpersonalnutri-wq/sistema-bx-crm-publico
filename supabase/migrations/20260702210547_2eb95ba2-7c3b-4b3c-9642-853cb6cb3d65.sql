
-- 1) get_public_booking_info: agora agrega OVERRIDES de todos os closers
--    e devolve, para a data pedida, a união dos ranges efetivos
--    (override do dia se existir, senão weekly do dia da semana).
CREATE OR REPLACE FUNCTION public.get_public_booking_info(p_date text)
RETURNS TABLE(
  booked_slots_map jsonb,
  capacity_per_slot integer,
  availability_weekly jsonb,
  availability_overrides jsonb,
  slot_gap_minutes integer,
  max_daily_bookings integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_requested_date date := p_date::date;
  v_dow text := extract(dow from v_requested_date)::text;
  v_capacity int := 0;
  v_effective_ranges jsonb := '[]'::jsonb;
  v_weekly jsonb;
  v_overrides jsonb;
  v_slot_gap integer;
  v_max_daily integer;
  v_booked jsonb;
BEGIN
  -- Ranges efetivos de cada closer para esta data:
  --   override[date] se existir  → senão weekly[dow]  → senão []
  WITH closer_effective AS (
    SELECT
      p.id,
      p.concurrent_capacity,
      COALESCE(
        p.availability_overrides -> p_date,
        p.availability_weekly    -> v_dow,
        '[]'::jsonb
      ) AS ranges
    FROM public.profiles p
    WHERE p.approved = true
      AND p.is_closer = true
  )
  SELECT
    COALESCE(SUM(
      CASE WHEN jsonb_typeof(ranges) = 'array' AND jsonb_array_length(ranges) > 0
           THEN concurrent_capacity ELSE 0 END
    ), 0)::int,
    COALESCE(
      (SELECT jsonb_agg(DISTINCT elem)
         FROM closer_effective ce, jsonb_array_elements(ce.ranges) AS elem
         WHERE jsonb_typeof(ce.ranges) = 'array'),
      '[]'::jsonb
    )
  INTO v_capacity, v_effective_ranges
  FROM closer_effective;

  -- Fallback: se ninguém está configurado, mantém capacidade 1 (não trava sistema)
  IF v_capacity = 0 THEN
    v_capacity := 0; -- 0 força "sem horários" no front
  END IF;

  -- Devolve os ranges efetivos SOB o formato de override[data], para que o
  -- frontend simplesmente use este dia.
  v_overrides := jsonb_build_object(p_date, v_effective_ranges);

  -- Weekly agregado (mantido pra compatibilidade)
  SELECT jsonb_object_agg(dow_key, ranges) INTO v_weekly
  FROM (
    SELECT key AS dow_key, jsonb_agg(elem) AS ranges
    FROM public.profiles p,
         jsonb_each(COALESCE(p.availability_weekly, '{}'::jsonb)) AS aw(key, value),
         jsonb_array_elements(value) AS elem
    WHERE p.approved = true
      AND p.is_closer = true
    GROUP BY key
  ) sub;

  IF v_weekly IS NULL THEN
    v_weekly := '{}'::jsonb;
  END IF;

  SELECT
    COALESCE(MAX(p.slot_gap_minutes), 60),
    COALESCE(MAX(p.max_daily_bookings), 100)
  INTO v_slot_gap, v_max_daily
  FROM public.profiles p
  WHERE p.approved = true AND p.is_closer = true;

  SELECT COALESCE(jsonb_object_agg(slot_time, qtd), '{}'::jsonb) INTO v_booked
  FROM (
    SELECT to_char(c.start_time AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS slot_time,
           COUNT(*) AS qtd
    FROM public.consultations c
    WHERE c.date = v_requested_date
      AND c.start_time IS NOT NULL
      AND c.refunded IS NOT TRUE
    GROUP BY 1
  ) agg;

  RETURN QUERY SELECT v_booked, v_capacity, v_weekly, v_overrides, v_slot_gap, v_max_daily;
END;
$function$;

-- 2) book_public_consultation: valida servidor-side se o horário cai
--    dentro dos ranges efetivos (override do dia ou weekly do DOW) de
--    pelo menos um closer ativo. Bloqueia agendamento fora da agenda.
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
  p_utm_term text DEFAULT NULL::text,
  p_lead_score integer DEFAULT NULL::integer
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
  v_dow text;
  v_slot_time time;
  v_slot_available boolean;
BEGIN
  v_requested_date := p_date::date;
  v_now_sp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_today_sp := v_now_sp::date;
  v_dow := extract(dow from v_requested_date)::text;
  v_slot_time := (p_time || ':00')::time;

  IF v_requested_date <= v_today_sp THEN
    RAISE EXCEPTION 'Agendamento no mesmo dia não é permitido.';
  END IF;

  IF v_now_sp::time >= time '12:00' AND v_requested_date <= (v_today_sp + 1) THEN
    RAISE EXCEPTION 'Após 12h, o próximo dia também fica bloqueado para agendamento.';
  END IF;

  -- Valida que o horário está dentro dos ranges efetivos de algum closer ativo
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p,
         LATERAL jsonb_array_elements(
           COALESCE(
             p.availability_overrides -> p_date,
             p.availability_weekly    -> v_dow,
             '[]'::jsonb
           )
         ) AS r
    WHERE p.approved = true
      AND p.is_closer = true
      AND jsonb_typeof(
            COALESCE(
              p.availability_overrides -> p_date,
              p.availability_weekly    -> v_dow,
              '[]'::jsonb
            )
          ) = 'array'
      AND v_slot_time >= ((r->>'start') || ':00')::time
      AND v_slot_time <  ((r->>'end')   || ':00')::time
  ) INTO v_slot_available;

  IF NOT v_slot_available THEN
    RAISE EXCEPTION 'Horário fora da disponibilidade configurada.';
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.consultations
    WHERE date = v_requested_date
      AND left(start_time::text, 5) = p_time
  ) INTO v_exists;

  IF v_exists THEN
    -- capacidade simultânea: só bloqueia se já atingiu total
    DECLARE
      v_booked_count int;
      v_slot_capacity int;
    BEGIN
      SELECT COUNT(*) INTO v_booked_count
      FROM public.consultations
      WHERE date = v_requested_date
        AND to_char(start_time AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') = p_time
        AND refunded IS NOT TRUE;

      SELECT COALESCE(SUM(
        CASE WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            COALESCE(p.availability_overrides -> p_date, p.availability_weekly -> v_dow, '[]'::jsonb)
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
    END;
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
    NULLIF(trim(p_utm_source), ''),
    NULLIF(trim(p_utm_campaign), ''),
    NULLIF(trim(p_utm_medium), ''),
    NULLIF(trim(p_utm_content), ''),
    NULLIF(trim(p_utm_term), ''),
    p_lead_score
  );

  RETURN TRUE;
END;
$function$;
