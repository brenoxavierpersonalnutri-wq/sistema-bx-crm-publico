-- Migration to add a booking info RPC that accepts a specific user_id
-- This allows closers to see their own availability instead of the global admin's availability

CREATE OR REPLACE FUNCTION get_closer_booking_info(p_date TEXT, p_user_id UUID)
RETURNS TABLE (
  booked_slots TEXT[],
  availability_weekly JSONB,
  availability_overrides JSONB,
  slot_gap_minutes INTEGER,
  max_daily_bookings INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_weekly JSONB;
  v_overrides JSONB;
  v_gap INTEGER;
  v_max_daily INTEGER;
BEGIN
  -- Search for the specific user's profile
  SELECT p.availability_weekly, p.availability_overrides, p.slot_gap_minutes, p.max_daily_bookings
  INTO v_weekly, v_overrides, v_gap, v_max_daily
  FROM profiles p
  WHERE p.id = p_user_id
  LIMIT 1;

  -- Default fallbacks if the user profile doesn't have the columns correctly initialized yet
  IF v_weekly IS NULL THEN
    v_weekly := '{ "0": [], "1": [{"start": "09:00", "end": "18:00"}], "2": [{"start": "09:00", "end": "18:00"}], "3": [{"start": "09:00", "end": "18:00"}], "4": [{"start": "09:00", "end": "18:00"}], "5": [{"start": "09:00", "end": "18:00"}], "6": [] }'::jsonb;
  END IF;
  
  IF v_overrides IS NULL THEN
    v_overrides := '{}'::jsonb;
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(ARRAY_AGG(substring(start_time from 1 for 5) ORDER BY start_time)::TEXT[], ARRAY[]::TEXT[]) as booked_slots,
    v_weekly as availability_weekly,
    v_overrides as availability_overrides,
    COALESCE(v_gap, 60) as slot_gap_minutes,
    COALESCE(v_max_daily, 12) as max_daily_bookings
  FROM consultations
  WHERE date = p_date AND user_id = p_user_id AND status != 'cancelado';
END;
$$;
