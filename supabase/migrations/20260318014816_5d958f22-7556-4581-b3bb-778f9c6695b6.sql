
ALTER TABLE public.alunas ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativa';
ALTER TABLE public.alunas ADD COLUMN IF NOT EXISTS renovacao_recusada boolean DEFAULT false;
NOTIFY pgrst, 'reload schema';
