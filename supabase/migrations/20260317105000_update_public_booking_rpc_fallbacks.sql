CREATE OR REPLACE FUNCTION get_public_booking_info(p_date DATE)
RETURNS TABLE (admin_id UUID, booked_slots TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_slots TEXT[];
BEGIN
  -- Search for an approved admin profile
  SELECT p.id INTO v_admin_id 
  FROM profiles p
  JOIN user_roles ur ON p.id = ur.user_id
  WHERE ur.role = 'admin' AND p.approved = true
  LIMIT 1;

  -- Fallback 1: Any admin, even if not approved
  IF v_admin_id IS NULL THEN
    SELECT p.id INTO v_admin_id 
    FROM profiles p
    JOIN user_roles ur ON p.id = ur.user_id
    WHERE ur.role = 'admin'
    LIMIT 1;
  END IF;

  -- Fallback 2: Any profile at all (single seller system assumption)
  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM profiles LIMIT 1;
  END IF;

  IF v_admin_id IS NOT NULL THEN
    -- Get scheduled times for that admin
    SELECT array_agg(left(start_time, 5)) INTO v_slots
    FROM consultations
    WHERE date = p_date AND user_id = v_admin_id AND start_time IS NOT NULL;
  END IF;

  RETURN QUERY SELECT v_admin_id, COALESCE(v_slots, ARRAY[]::TEXT[]);
END;
$$;


CREATE OR REPLACE FUNCTION book_public_consultation(
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
  -- Search for an approved admin profile
  SELECT p.id INTO v_admin_id 
  FROM profiles p
  JOIN user_roles ur ON p.id = ur.user_id
  WHERE ur.role = 'admin' AND p.approved = true
  LIMIT 1;

  -- Fallback 1: Any admin, even if not approved
  IF v_admin_id IS NULL THEN
    SELECT p.id INTO v_admin_id 
    FROM profiles p
    JOIN user_roles ur ON p.id = ur.user_id
    WHERE ur.role = 'admin'
    LIMIT 1;
  END IF;

  -- Fallback 2: Any profile at all (single seller system assumption)
  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM profiles LIMIT 1;
  END IF;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'System error: Nenhum usuário encontrado no sistema base.';
  END IF;

  -- Verify conflict
  SELECT EXISTS(
    SELECT 1 FROM consultations 
    WHERE date = p_date AND start_time LIKE p_time || '%' AND user_id = v_admin_id
  ) INTO v_exists;

  IF v_exists THEN
    RAISE EXCEPTION 'Horário já reservado.';
  END IF;

  -- Insert booking
  INSERT INTO consultations (
    client_name, client_phone, date, start_time, status, user_id, via, gave_signal, signal_residue_paid, converted, attended, received_reminder_messages
  ) VALUES (
    p_client_name, p_client_phone, p_date, p_time, 'Agendado', v_admin_id, 'Site/Formulário', false, false, false, false, false
  );

  RETURN TRUE;
END;
$$;
