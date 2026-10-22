-- Divide a pergunta de consultoria em duas perguntas abertas:
--   consultoria_feedback      -> "O que você está achando do programa?"
--   consultoria_sente_falta   -> "O que você sente falta aqui dentro? O que podemos melhorar?"
alter table public.feedback_semanal_responses
  add column if not exists consultoria_sente_falta text;

-- PostgREST precisa recarregar o cache de schema pra enxergar a coluna nova.
notify pgrst, 'reload schema';
