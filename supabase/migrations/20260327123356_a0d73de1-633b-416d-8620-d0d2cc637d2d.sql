
-- Add is_closer column
ALTER TABLE profiles ADD COLUMN is_closer boolean NOT NULL DEFAULT false;

-- Set Gabi as closer (the only non-admin approved user named Gabriele)
UPDATE profiles SET is_closer = true 
WHERE full_name ILIKE '%gabriele%' 
  AND approved = true;

-- Update RPC to use is_closer flag
CREATE OR REPLACE FUNCTION public.get_public_booking_info(p_date text)
 RETURNS TABLE(booked_slots text[], availability_weekly jsonb, availability_overrides jsonb, slot_gap_minutes integer, max_daily_bookings integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_closer_id UUID;
  v_weekly JSONB;
  v_overrides JSONB;
  v_slot_gap integer;
  v_max_daily integer;
BEGIN
  SELECT p.id, p.availability_weekly, p.availability_overrides, p.slot_gap_minutes, p.max_daily_bookings
  INTO v_closer_id, v_weekly, v_overrides, v_slot_gap, v_max_daily
  FROM profiles p
  WHERE p.approved = true AND p.is_closer = true
  ORDER BY p.updated_at DESC
  LIMIT 1;

  IF v_closer_id IS NULL THEN
    RETURN QUERY SELECT ARRAY[]::TEXT[], '{}'::jsonb, '{}'::jsonb, 60::integer, 12::integer;
    RETURN;
  END IF;

  IF v_weekly IS NULL THEN
    v_weekly := '{ "0": [], "1": [{"start": "09:00", "end": "18:00"}], "2": [{"start": "09:00", "end": "18:00"}], "3": [{"start": "09:00", "end": "18:00"}], "4": [{"start": "09:00", "end": "18:00"}], "5": [{"start": "09:00", "end": "18:00"}], "6": [] }'::jsonb;
  END IF;
  
  IF v_overrides IS NULL THEN
    v_overrides := '{}'::jsonb;
  END IF;

  v_slot_gap := COALESCE(v_slot_gap, 60);
  v_max_daily := COALESCE(v_max_daily, 12);

  RETURN QUERY
  SELECT 
    COALESCE(ARRAY_AGG(to_char(c.start_time AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') ORDER BY c.start_time)::TEXT[], ARRAY[]::TEXT[]) as booked_slots,
    v_weekly as availability_weekly,
    v_overrides as availability_overrides,
    v_slot_gap as slot_gap_minutes,
    v_max_daily as max_daily_bookings
  FROM consultations c
  WHERE c.date = p_date::date AND c.start_time IS NOT NULL AND c.status != 'cancelado';
END;
$function$;
