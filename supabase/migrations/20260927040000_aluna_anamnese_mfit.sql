-- ANAMNESE/MFIT vira um sim/não igual ao "enviou fotos": o Breno marca na mão
-- quando a aluna já preencheu a anamnese e se cadastrou no MFIT.

alter table public.alunas
  add column if not exists anamnese_mfit boolean not null default false;

notify pgrst, 'reload schema';
