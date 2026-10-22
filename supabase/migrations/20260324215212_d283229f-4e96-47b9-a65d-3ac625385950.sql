
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS slot_gap_minutes integer DEFAULT 60,
  ADD COLUMN IF NOT EXISTS max_daily_bookings integer DEFAULT 12;
