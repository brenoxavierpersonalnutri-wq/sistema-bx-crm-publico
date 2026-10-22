-- "O quanto você gosta e indicaria o nosso programa?" — nota de 0 a 10 no
-- feedback semanal, entre as duas perguntas abertas do final.
alter table public.feedback_semanal_responses
  add column if not exists programa_indicaria integer
    check (programa_indicaria between 0 and 10);

notify pgrst, 'reload schema';
