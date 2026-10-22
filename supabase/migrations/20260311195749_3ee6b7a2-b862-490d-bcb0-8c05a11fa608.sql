ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS gave_signal boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS signal_value numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS signal_follow_up_date date DEFAULT NULL;