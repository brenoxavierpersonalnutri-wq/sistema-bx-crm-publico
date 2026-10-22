CREATE OR REPLACE FUNCTION public.get_public_booking_info(p_date text)
 RETURNS TABLE(booked_slots_map jsonb, capacity_per_slot integer, availability_weekly jsonb, availability_overrides jsonb, slot_gap_minutes integer, max_daily_bookings integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_capacity int;
  v_weekly jsonb;
  v_overrides jsonb;
  v_slot_gap integer;
  v_max_daily integer;
  v_booked jsonb;
BEGIN
  SELECT COALESCE(SUM(p.concurrent_capacity), 1) INTO v_capacity
  FROM public.profiles p
  WHERE p.approved = true
    AND p.is_closer = true;

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
    v_weekly := '{"0":[],"1":[{"start":"09:00","end":"18:00"}],"2":[{"start":"09:00","end":"18:00"}],"3":[{"start":"09:00","end":"18:00"}],"4":[{"start":"09:00","end":"18:00"}],"5":[{"start":"09:00","end":"18:00"}],"6":[]}'::jsonb;
  END IF;

  SELECT
    COALESCE(MAX(p.slot_gap_minutes), 60),
    COALESCE(MAX(p.max_daily_bookings), 100),
    '{}'::jsonb
  INTO v_slot_gap, v_max_daily, v_overrides
  FROM public.profiles p
  WHERE p.approved = true
    AND p.is_closer = true;

  SELECT COALESCE(jsonb_object_agg(slot_time, qtd), '{}'::jsonb) INTO v_booked
  FROM (
    SELECT to_char(c.start_time AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS slot_time,
           COUNT(*) AS qtd
    FROM public.consultations c
    WHERE c.date = p_date::date
      AND c.start_time IS NOT NULL
      AND c.refunded IS NOT TRUE
    GROUP BY 1
  ) agg;

  RETURN QUERY SELECT v_booked, v_capacity, v_weekly, v_overrides, v_slot_gap, v_max_daily;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_next_closer(p_date text, p_time text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_closer UUID;
BEGIN
  WITH active_closers AS (
    SELECT p.id, p.concurrent_capacity, p.full_name
    FROM public.profiles p
    WHERE p.approved = true
      AND p.is_closer = true
  ),
  per_closer_slot AS (
    SELECT ac.id, ac.concurrent_capacity, ac.full_name,
           COUNT(c.id) FILTER (
             WHERE to_char(c.start_time AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') = p_time
           ) AS slot_count,
           COUNT(c.id) AS day_count
    FROM active_closers ac
    LEFT JOIN public.consultations c
      ON c.closer_user_id = ac.id
      AND c.date = p_date::date
      AND c.refunded IS NOT TRUE
    GROUP BY ac.id, ac.concurrent_capacity, ac.full_name
  )
  SELECT id INTO v_closer
  FROM per_closer_slot
  WHERE slot_count < concurrent_capacity
  ORDER BY day_count ASC, full_name ASC
  LIMIT 1;

  RETURN v_closer;
END;
$function$;

NOTIFY pgrst, 'reload schema';