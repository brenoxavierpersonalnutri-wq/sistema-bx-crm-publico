-- supabase/migrations/20260321210000_add_availability_to_profiles.sql

-- Add available_slots_json column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS available_slots_json JSONB DEFAULT '["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"]';

-- Update the get_public_booking_info RPC to also return the available slots for the user
CREATE OR REPLACE FUNCTION get_public_booking_info(p_date TEXT)
RETURNS TABLE (
  booked_slots TEXT[],
  available_slots_json JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_available_slots JSONB;
BEGIN
  -- Search for an approved admin profile
  SELECT p.id, COALESCE(p.available_slots_json, '["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"]'::jsonb) 
  INTO v_admin_id, v_available_slots
  FROM profiles p
  JOIN user_roles ur ON p.id = ur.user_id
  WHERE ur.role = 'admin' AND p.approved = true
  LIMIT 1;

  -- Fallback 1: Any admin, even if not approved
  IF v_admin_id IS NULL THEN
    SELECT p.id, COALESCE(p.available_slots_json, '["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"]'::jsonb) 
    INTO v_admin_id, v_available_slots
    FROM profiles p
    JOIN user_roles ur ON p.id = ur.user_id
    WHERE ur.role = 'admin'
    LIMIT 1;
  END IF;

  -- Fallback 2: Any profile at all
  IF v_admin_id IS NULL THEN
    SELECT p.id, COALESCE(p.available_slots_json, '["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"]'::jsonb) 
    INTO v_admin_id, v_available_slots
    FROM profiles p 
    LIMIT 1;
  END IF;

  IF v_admin_id IS NULL THEN
    RETURN QUERY SELECT ARRAY[]::TEXT[], '[]'::jsonb;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(ARRAY_AGG(substring(start_time from 1 for 5) ORDER BY start_time)::TEXT[], ARRAY[]::TEXT[]) as booked_slots,
    v_available_slots as available_slots_json
  FROM consultations
  WHERE date = p_date AND user_id = v_admin_id AND status != 'cancelado';
END;
$$;
