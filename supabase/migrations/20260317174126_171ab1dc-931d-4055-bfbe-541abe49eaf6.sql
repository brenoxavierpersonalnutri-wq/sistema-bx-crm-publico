
-- Drop existing versions if any
DROP FUNCTION IF EXISTS public.get_public_booking_info(DATE);
DROP FUNCTION IF EXISTS public.book_public_consultation(TEXT, TEXT, DATE, TEXT);

-- 1) get_public_booking_info: returns admin id + booked time slots (HH:MM) for a given date
CREATE OR REPLACE FUNCTION public.get_public_booking_info(p_date DATE)
RETURNS TABLE (admin_id UUID, booked_slots TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_slots TEXT[];
BEGIN
  -- Find the approved admin
  SELECT p.id INTO v_admin_id
  FROM profiles p
  JOIN user_roles ur ON p.id = ur.user_id
  WHERE ur.role = 'admin' AND p.approved = true
  LIMIT 1;

  -- Fallback: any admin
  IF v_admin_id IS NULL THEN
    SELECT p.id INTO v_admin_id
    FROM profiles p
    JOIN user_roles ur ON p.id = ur.user_id
    WHERE ur.role = 'admin'
    LIMIT 1;
  END IF;

  -- Fallback: any profile
  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM profiles LIMIT 1;
  END IF;

  IF v_admin_id IS NOT NULL THEN
    SELECT array_agg(left(start_time::text, 5)) INTO v_slots
    FROM consultations
    WHERE date = p_date AND start_time IS NOT NULL;
  END IF;

  RETURN QUERY SELECT v_admin_id, COALESCE(v_slots, ARRAY[]::TEXT[]);
END;
$$;

-- 2) book_public_consultation: inserts a new consultation for the admin
CREATE OR REPLACE FUNCTION public.book_public_consultation(
  p_client_name TEXT,
  p_client_phone TEXT,
  p_date DATE,
  p_time TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_exists BOOLEAN;
BEGIN
  -- Find the approved admin
  SELECT p.id INTO v_admin_id
  FROM profiles p
  JOIN user_roles ur ON p.id = ur.user_id
  WHERE ur.role = 'admin' AND p.approved = true
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    SELECT p.id INTO v_admin_id
    FROM profiles p
    JOIN user_roles ur ON p.id = ur.user_id
    WHERE ur.role = 'admin'
    LIMIT 1;
  END IF;

  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM profiles LIMIT 1;
  END IF;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum administrador encontrado no sistema.';
  END IF;

  -- Check if slot is already taken
  SELECT EXISTS(
    SELECT 1 FROM consultations
    WHERE date = p_date AND left(start_time::text, 5) = p_time
  ) INTO v_exists;

  IF v_exists THEN
    RAISE EXCEPTION 'Horário já reservado.';
  END IF;

  -- Insert the consultation
  INSERT INTO consultations (
    client_name, client_phone, date, start_time, status,
    lead_quality, via, gave_signal, signal_residue_paid,
    converted, attended, received_reminder_messages
  ) VALUES (
    p_client_name, p_client_phone, p_date, p_time, 'Scheduled',
    'morno', 'Site/Formulário', false, false,
    false, false, false
  );

  RETURN TRUE;
END;
$$;

-- Grant execute to anon so unauthenticated users can call these RPCs
GRANT EXECUTE ON FUNCTION public.get_public_booking_info(DATE) TO anon;
GRANT EXECUTE ON FUNCTION public.book_public_consultation(TEXT, TEXT, DATE, TEXT) TO anon;
