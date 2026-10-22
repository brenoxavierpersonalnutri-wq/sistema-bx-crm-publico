
ALTER TABLE public.consultations 
  ADD COLUMN attended BOOLEAN DEFAULT NULL,
  ADD COLUMN attended_at TIMESTAMPTZ,
  ADD COLUMN converted BOOLEAN DEFAULT NULL,
  ADD COLUMN converted_at TIMESTAMPTZ,
  ADD COLUMN closer_observation TEXT DEFAULT '';

-- Remove the old status check constraint so we can derive status from attended/converted
ALTER TABLE public.consultations DROP CONSTRAINT IF EXISTS consultations_status_check;
