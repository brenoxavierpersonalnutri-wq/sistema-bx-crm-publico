-- supabase/migrations/20260321220000_add_advanced_availability.sql

-- Add the JSONB columns with sensible defaults
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS availability_weekly JSONB DEFAULT '{
  "0": [],
  "1": [{"start": "09:00", "end": "18:00"}],
  "2": [{"start": "09:00", "end": "18:00"}],
  "3": [{"start": "09:00", "end": "18:00"}],
  "4": [{"start": "09:00", "end": "18:00"}],
  "5": [{"start": "09:00", "end": "18:00"}],
  "6": []
}'::jsonb;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS availability_overrides JSONB DEFAULT '{}'::jsonb;

-- Update the RPC to return these new structures instead of available_slots_json
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
    COALESCE(ARRAY_AGG(substring(start_time from 1 for 5) ORDER BY start_time)::TEXT[], ARRAY[]::TEXT[]) as booked_slots,
    v_weekly as availability_weekly,
    v_overrides as availability_overrides
  FROM consultations
  WHERE date = p_date AND user_id = v_admin_id AND status != 'cancelado';
END;
$$;
