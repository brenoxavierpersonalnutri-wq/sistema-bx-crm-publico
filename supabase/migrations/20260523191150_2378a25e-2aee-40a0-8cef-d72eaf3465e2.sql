CREATE UNIQUE INDEX IF NOT EXISTS alunas_user_nome_normalizado_uniq
ON public.alunas (
  user_id,
  lower(trim(regexp_replace(nome_completo, '\s+', ' ', 'g')))
);