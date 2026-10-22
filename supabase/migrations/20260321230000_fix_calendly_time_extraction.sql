-- 1. Fix get_public_booking_info to extract correct HH24:MI timezone instead of just left(5)
CREATE OR REPLACE FUNCTION get_public_booking_info(p_date TEXT)
RETURNS TABLE (
  booked_slots TEXT[],
  availability_weekly JSONB,
  availability_overrides JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_weekly JSONB;
  v_overrides JSONB;
BEGIN
  -- Search for an approved admin profile
  SELECT p.id, p.availability_weekly, p.availability_overrides 
  INTO v_admin_id, v_weekly, v_overrides
  FROM profiles p
  JOIN user_roles ur ON p.id = ur.user_id
  WHERE ur.role = 'admin' AND p.approved = true
  LIMIT 1;

  -- Fallback 1: Any admin, even if not approved
  IF v_admin_id IS NULL THEN
    SELECT p.id, p.availability_weekly, p.availability_overrides 
    INTO v_admin_id, v_weekly, v_overrides
    FROM profiles p
    JOIN user_roles ur ON p.id = ur.user_id
    WHERE ur.role = 'admin'
    LIMIT 1;
  END IF;

  -- Fallback 2: Any profile at all
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

  -- Default fallbacks if the user profile doesn't have the columns correctly initialized yet
  IF v_weekly IS NULL THEN
    v_weekly := '{ "0": [], "1": [{"start": "09:00", "end": "18:00"}], "2": [{"start": "09:00", "end": "18:00"}], "3": [{"start": "09:00", "end": "18:00"}], "4": [{"start": "09:00", "end": "18:00"}], "5": [{"start": "09:00", "end": "18:00"}], "6": [] }'::jsonb;
  END IF;
  
  IF v_overrides IS NULL THEN
    v_overrides := '{}'::jsonb;
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(ARRAY_AGG(to_char(start_time::TIMESTAMPTZ AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') ORDER BY start_time)::TEXT[], ARRAY[]::TEXT[]) as booked_slots,
    v_weekly as availability_weekly,
    v_overrides as availability_overrides
  FROM consultations
  WHERE date = p_date AND user_id = v_admin_id AND status != 'cancelado';
END;
$$;

-- 2. Fix book_public_consultation logic for conflict checking
CREATE OR REPLACE FUNCTION public.book_public_consultation(
  p_client_name text,
  p_client_phone text,
  p_date text,
  p_time text,
  p_funnel text DEFAULT 'site'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists BOOLEAN;
  v_full_timestamp TIMESTAMP WITH TIME ZONE;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM consultations
    WHERE date = p_date::date AND to_char(start_time::TIMESTAMPTZ AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') = p_time
  ) INTO v_exists;

  IF v_exists THEN RAISE EXCEPTION 'Horário já reservado.'; END IF;

  v_full_timestamp := (p_date || ' ' || p_time || ':00 -03:00')::TIMESTAMP WITH TIME ZONE;

  INSERT INTO consultations (
    client_name, client_phone, date, start_time, status, via,
    lead_quality, gave_signal, signal_residue_paid, converted, attended, received_reminder_messages
  ) VALUES (
    p_client_name, p_client_phone, p_date::date, v_full_timestamp, 'pendente', COALESCE(p_funnel, 'site'),
    'frio', false, false, NULL, NULL, NULL
  );

  RETURN TRUE;
END;
$$;
