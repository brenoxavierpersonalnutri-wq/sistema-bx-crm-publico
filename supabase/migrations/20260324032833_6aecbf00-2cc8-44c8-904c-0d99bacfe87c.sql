-- Fix: new bookings should have attended/converted as NULL (pending), not false
-- Update existing pending consultations
UPDATE consultations 
SET attended = NULL, converted = NULL 
WHERE status = 'pendente' AND attended = false AND converted = false;

-- Update the RPC to use NULL defaults
CREATE OR REPLACE FUNCTION public.book_public_consultation(
  p_client_name text, 
  p_client_phone text, 
  p_date text, 
  p_time text, 
  p_funnel text DEFAULT 'trafego'::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_exists BOOLEAN;
  v_full_timestamp TIMESTAMP WITH TIME ZONE;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM consultations
    WHERE date = p_date::date AND left(start_time::text, 5) = p_time
  ) INTO v_exists;

  IF v_exists THEN RAISE EXCEPTION 'Horário já reservado.'; END IF;

  v_full_timestamp := (p_date || ' ' || p_time || ':00 -03:00')::TIMESTAMP WITH TIME ZONE;

  INSERT INTO consultations (
    client_name, client_phone, date, start_time, status, via,
    lead_quality, gave_signal, signal_residue_paid
  ) VALUES (
    p_client_name, p_client_phone, p_date::date, v_full_timestamp, 'pendente', COALESCE(p_funnel, 'trafego'),
    'frio', false, false
  );

  RETURN TRUE;
END;
$$;