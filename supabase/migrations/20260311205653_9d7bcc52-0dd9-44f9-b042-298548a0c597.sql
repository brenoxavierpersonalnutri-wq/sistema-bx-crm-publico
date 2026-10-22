
-- Add avatar_url to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- Create collaborator_tasks table
CREATE TABLE IF NOT EXISTS public.collaborator_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_by uuid,
  title text NOT NULL,
  description text,
  due_date timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  type text NOT NULL DEFAULT 'manual',
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.collaborator_tasks ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins can manage all tasks"
  ON public.collaborator_tasks FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- Users can read their own tasks
CREATE POLICY "Users can read own tasks"
  ON public.collaborator_tasks FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can update their own tasks (e.g. mark complete)
CREATE POLICY "Users can update own tasks"
  ON public.collaborator_tasks FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());
