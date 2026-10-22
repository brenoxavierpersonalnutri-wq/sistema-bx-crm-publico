
-- Add UTM columns to consultations table
ALTER TABLE public.consultations 
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS utm_term text;

-- Update book_public_consultation RPC to accept UTM params
CREATE OR REPLACE FUNCTION public.book_public_consultation(
  p_client_name text, 
  p_client_phone text, 
  p_date text, 
  p_time text, 
  p_funnel text DEFAULT 'trafego'::text,
  p_utm_source text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL,
  p_utm_content text DEFAULT NULL,
  p_utm_term text DEFAULT NULL
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    lead_quality, gave_signal, signal_residue_paid,
    utm_source, utm_campaign, utm_medium, utm_content, utm_term
  ) VALUES (
    p_client_name, p_client_phone, p_date::date, v_full_timestamp, 'pendente', COALESCE(p_funnel, 'trafego'),
    'frio', false, false,
    p_utm_source, p_utm_campaign, p_utm_medium, p_utm_content, p_utm_term
  );

  RETURN TRUE;
END;
$function$;
