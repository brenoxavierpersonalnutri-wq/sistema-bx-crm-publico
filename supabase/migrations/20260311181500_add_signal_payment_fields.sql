-- Add signal_residue_paid column to consultations table
ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS signal_residue_paid BOOLEAN DEFAULT FALSE;

-- Add signal payment columns to alunas table if they don't exist
ALTER TABLE public.alunas ADD COLUMN IF NOT EXISTS deu_sinal BOOLEAN DEFAULT FALSE;
ALTER TABLE public.alunas ADD COLUMN IF NOT EXISTS valor_sinal NUMERIC DEFAULT 0;
ALTER TABLE public.alunas ADD COLUMN IF NOT EXISTS data_cobranca_sinal DATE;
ALTER TABLE public.alunas ADD COLUMN IF NOT EXISTS residuo_pago BOOLEAN DEFAULT FALSE;
