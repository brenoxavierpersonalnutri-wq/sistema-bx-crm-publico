ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS ticket_value numeric DEFAULT NULL;
ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS payment_method text DEFAULT NULL;