ALTER TABLE public.consultations ALTER COLUMN passed_pitch_01 DROP NOT NULL;
ALTER TABLE public.consultations ALTER COLUMN passed_pitch_01 DROP DEFAULT;
UPDATE public.consultations SET passed_pitch_01 = NULL WHERE passed_pitch_01 = false;