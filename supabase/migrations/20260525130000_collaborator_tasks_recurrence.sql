-- Adiciona coluna de recorrência em collaborator_tasks pra suportar tarefas
-- repetidas ao estilo do calendário da Apple: Nunca / Diária / Semanal /
-- Mensal / Anual. A expansão das ocorrências é feita no client (TaskCalendar).
-- A coluna guarda só a REGRA — uma única row por tarefa recorrente.

ALTER TABLE public.collaborator_tasks
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none';

-- Garantir valores válidos. Se já existir uma constraint igual, ignora.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collaborator_tasks_recurrence_check'
  ) THEN
    ALTER TABLE public.collaborator_tasks
      ADD CONSTRAINT collaborator_tasks_recurrence_check
      CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly', 'yearly'));
  END IF;
END $$;
