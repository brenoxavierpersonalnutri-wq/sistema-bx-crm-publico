
ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS program_value text;

INSERT INTO public.custom_programs (value, label, price, programa, duracao, active)
VALUES
  ('mgmd-12m', 'MGMD 12M', 997, 'menos_gordura', '12', true),
  ('elite-6m-default', 'ELITE 6M', 1500, 'elite', '6', true),
  ('elite-2m', 'ELITE 2M', 1997, 'elite', '2', true),
  ('plataforma', 'PLATAFORMA', 297, 'plataforma_magra', '12', true),
  ('mgmd-quadrimestral', 'MGMD QUADRIMESTRAL', 497, 'menos_gordura', '4', true),
  ('slim-definida-6m', '6 MESES 497 - SLIM DEFINIDA', 497, 'menos_gordura', '6', true)
ON CONFLICT (value) DO UPDATE
  SET label = EXCLUDED.label,
      price = EXCLUDED.price,
      programa = EXCLUDED.programa,
      duracao = EXCLUDED.duracao,
      active = true;
