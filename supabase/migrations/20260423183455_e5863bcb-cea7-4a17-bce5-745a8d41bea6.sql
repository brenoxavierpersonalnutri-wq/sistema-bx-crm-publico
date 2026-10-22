ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS refunded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_reason text;

CREATE INDEX IF NOT EXISTS idx_consultations_refunded ON public.consultations(refunded) WHERE refunded = true;