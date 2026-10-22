
-- Add missing signal columns to consultations table
ALTER TABLE public.consultations 
ADD COLUMN IF NOT EXISTS gave_signal boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS signal_value numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS signal_follow_up_date date;
