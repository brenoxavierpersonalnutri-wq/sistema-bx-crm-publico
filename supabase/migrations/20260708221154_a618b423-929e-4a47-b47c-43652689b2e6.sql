
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS low_income boolean DEFAULT false;

CREATE OR REPLACE FUNCTION public.flag_low_income_on_form_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_phone text;
  v_consultation_id uuid;
BEGIN
  IF NEW.renda_mensal IS DISTINCT FROM 'ate_2k' THEN
    RETURN NEW;
  END IF;

  -- Se já veio linkado via consultation_id
  IF NEW.consultation_id IS NOT NULL THEN
    UPDATE public.consultations
       SET low_income = true, updated_at = now()
     WHERE id = NEW.consultation_id;
    RETURN NEW;
  END IF;

  -- Tenta casar por telefone (últimos 8 dígitos), últimas 48h
  v_clean_phone := regexp_replace(COALESCE(NEW.telefone, ''), '[^0-9]', '', 'g');
  IF length(v_clean_phone) < 8 THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_consultation_id
    FROM public.consultations
   WHERE regexp_replace(COALESCE(client_phone, ''), '[^0-9]', '', 'g') LIKE '%' || right(v_clean_phone, 8)
     AND created_at >= now() - interval '48 hours'
     AND refunded IS NOT TRUE
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_consultation_id IS NOT NULL THEN
    UPDATE public.consultations
       SET low_income = true, updated_at = now()
     WHERE id = v_consultation_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_low_income ON public.lead_form_responses;
CREATE TRIGGER trg_flag_low_income
AFTER INSERT ON public.lead_form_responses
FOR EACH ROW EXECUTE FUNCTION public.flag_low_income_on_form_response();

-- Backfill: marca consultas existentes cujo lead respondeu ate_2k
UPDATE public.consultations c
   SET low_income = true
  FROM public.lead_form_responses r
 WHERE r.renda_mensal = 'ate_2k'
   AND (
     r.consultation_id = c.id
     OR (
       length(regexp_replace(COALESCE(r.telefone,''), '[^0-9]', '', 'g')) >= 8
       AND regexp_replace(COALESCE(c.client_phone,''), '[^0-9]', '', 'g')
           LIKE '%' || right(regexp_replace(COALESCE(r.telefone,''), '[^0-9]', '', 'g'), 8)
     )
   )
   AND c.low_income IS NOT TRUE;
