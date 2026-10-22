-- Reestruturação do feedback semanal:
--   - treino_reps_reserva: repetições em reserva (RIR) no fim da série. É o que
--     passa a medir série válida no lugar da nota 0-10.
--     Valores: "1-3" | "4-6" | "7-10" | "10+".
--   - cardio_minutos_semanais: minutos de cardio na semana, separado dos
--     minutos de carga (musculação).
--     Valores: "0" | "<60" | "60-120" | "120-180" | "180-240" | "240+".
--
-- As colunas treino_progressao_carga, treino_series_validas e dieta_nota saíram
-- do formulário mas continuam na tabela: guardam as respostas antigas.
alter table public.feedback_semanal_responses
  add column if not exists treino_reps_reserva text,
  add column if not exists cardio_minutos_semanais text;

-- PostgREST precisa recarregar o cache de schema pra enxergar as colunas novas.
notify pgrst, 'reload schema';
