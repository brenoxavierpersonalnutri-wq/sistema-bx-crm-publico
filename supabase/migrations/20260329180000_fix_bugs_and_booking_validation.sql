-- Drop defaults from columns to prevent auto-filling
ALTER TABLE public.consultations ALTER COLUMN gave_signal DROP DEFAULT;
ALTER TABLE public.consultations ALTER COLUMN signal_residue_paid DROP DEFAULT;

-- Add future reschedule flag
ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS is_future_reschedule BOOLEAN DEFAULT FALSE;

-- Update book_public_consultation RPC to validate day availability and enforce time
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
  v_availability RECORD;
  v_dow INTEGER;
  v_is_available BOOLEAN := FALSE;
  v_booking_info RECORD;
BEGIN
  -- 1) Validate time presence
  IF p_time IS NULL OR btrim(p_time) = '' THEN
    RAISE EXCEPTION 'Horário obrigatório.';
  END IF;

  -- 2) Prevent duplicate time
  SELECT EXISTS(
    SELECT 1 FROM consultations
    WHERE date = p_date::date AND left(start_time::text, 5) = p_time
  ) INTO v_exists;

  IF v_exists THEN 
    RAISE EXCEPTION 'Horário já reservado.'; 
  END IF;

  -- 2.1) Validate Day Availability against Profile Settings
  v_dow := EXTRACT(DOW FROM p_date::date);
  
  -- Assuming single admin profile for this CRM
  SELECT availability_weekly, availability_overrides INTO v_availability
  FROM profiles
  LIMIT 1;

  IF v_availability.availability_overrides ? p_date THEN
    IF jsonb_array_length(v_availability.availability_overrides->p_date) = 0 THEN
      RAISE EXCEPTION 'Este dia está indisponível (exceção).';
    END IF;
  ELSE
    IF v_availability.availability_weekly ? v_dow::text THEN
      IF jsonb_array_length(v_availability.availability_weekly->(v_dow::text)) = 0 THEN
        RAISE EXCEPTION 'Este dia da semana está indisponível.';
      END IF;
    END IF;
  END IF;

  -- 3) Create Timestamp
  v_full_timestamp := (p_date || ' ' || p_time || ':00 -03:00')::TIMESTAMP WITH TIME ZONE;

  -- 4) Insert, passing NULL implicitly to new columns and dropped defaults
  INSERT INTO consultations (
    client_name, client_phone, date, start_time, status, via,
    lead_quality,
    utm_source, utm_campaign, utm_medium, utm_content, utm_term
  ) VALUES (
    p_client_name, p_client_phone, p_date::date, v_full_timestamp, 'pendente', COALESCE(p_funnel, 'trafego'),
    'frio',
    p_utm_source, p_utm_campaign, p_utm_medium, p_utm_content, p_utm_term
  );

  RETURN TRUE;
END;
$function$;
