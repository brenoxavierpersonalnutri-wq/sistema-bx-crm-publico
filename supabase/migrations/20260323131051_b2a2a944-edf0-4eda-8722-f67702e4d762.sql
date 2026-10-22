CREATE OR REPLACE FUNCTION public.get_public_booking_info(p_date text)
 RETURNS TABLE(booked_slots text[], availability_weekly jsonb, availability_overrides jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id UUID;
  v_weekly JSONB;
  v_overrides JSONB;
BEGIN
  SELECT p.id, p.availability_weekly, p.availability_overrides 
  INTO v_admin_id, v_weekly, v_overrides
  FROM profiles p
  JOIN user_roles ur ON p.id = ur.user_id
  WHERE ur.role = 'admin' AND p.approved = true
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    SELECT p.id, p.availability_weekly, p.availability_overrides 
    INTO v_admin_id, v_weekly, v_overrides
    FROM profiles p
    JOIN user_roles ur ON p.id = ur.user_id
    WHERE ur.role = 'admin'
    LIMIT 1;
  END IF;

  IF v_admin_id IS NULL THEN
    SELECT p.id, p.availability_weekly, p.availability_overrides 
    INTO v_admin_id, v_weekly, v_overrides
    FROM profiles p 
    LIMIT 1;
  END IF;

  IF v_admin_id IS NULL THEN
    RETURN QUERY SELECT ARRAY[]::TEXT[], '{}'::jsonb, '{}'::jsonb;
    RETURN;
  END IF;

  IF v_weekly IS NULL THEN
    v_weekly := '{ "0": [], "1": [{"start": "09:00", "end": "18:00"}], "2": [{"start": "09:00", "end": "18:00"}], "3": [{"start": "09:00", "end": "18:00"}], "4": [{"start": "09:00", "end": "18:00"}], "5": [{"start": "09:00", "end": "18:00"}], "6": [] }'::jsonb;
  END IF;
  
  IF v_overrides IS NULL THEN
    v_overrides := '{}'::jsonb;
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(ARRAY_AGG(to_char(c.start_time AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') ORDER BY c.start_time)::TEXT[], ARRAY[]::TEXT[]) as booked_slots,
    v_weekly as availability_weekly,
    v_overrides as availability_overrides
  FROM consultations c
  WHERE c.date = p_date::date AND c.start_time IS NOT NULL AND c.status != 'cancelado';
END;
$function$