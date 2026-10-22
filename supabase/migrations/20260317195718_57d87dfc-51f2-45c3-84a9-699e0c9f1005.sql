CREATE OR REPLACE FUNCTION book_public_consultation(
  p_client_name TEXT, p_client_phone TEXT, p_date DATE, p_time TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_exists BOOLEAN;
  v_full_timestamp TIMESTAMP WITH TIME ZONE;
BEGIN
  SELECT p.id INTO v_admin_id FROM profiles p JOIN user_roles ur ON p.id = ur.user_id WHERE ur.role = 'admin' AND p.approved = true LIMIT 1;
  IF v_admin_id IS NULL THEN SELECT p.id INTO v_admin_id FROM profiles p JOIN user_roles ur ON p.id = ur.user_id WHERE ur.role = 'admin' LIMIT 1; END IF;
  IF v_admin_id IS NULL THEN SELECT id INTO v_admin_id FROM profiles LIMIT 1; END IF;
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Erro: Banco vazio.'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM consultations
    WHERE date = p_date AND left(start_time::text, 5) = p_time
  ) INTO v_exists;

  IF v_exists THEN RAISE EXCEPTION 'Horário já reservado.'; END IF;

  v_full_timestamp := (p_date || ' ' || p_time || ':00 -03:00')::TIMESTAMP WITH TIME ZONE;

  INSERT INTO consultations (
    client_name, client_phone, date, start_time, status, via,
    lead_quality, gave_signal, signal_residue_paid, converted, attended, received_reminder_messages
  ) VALUES (
    p_client_name, p_client_phone, p_date, v_full_timestamp, 'Aguardando', 'Site/Formulário',
    'Frio', false, false, false, false, false
  );

  RETURN TRUE;
END;
$$;