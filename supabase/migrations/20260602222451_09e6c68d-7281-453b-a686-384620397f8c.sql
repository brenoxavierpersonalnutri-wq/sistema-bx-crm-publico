ALTER TABLE public.collaborator_tasks
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none';

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

NOTIFY pgrst, 'reload schema';