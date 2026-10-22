
-- Create user_modules table to control module access per user
CREATE TABLE public.user_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, module)
);

-- Enable RLS
ALTER TABLE public.user_modules ENABLE ROW LEVEL SECURITY;

-- Admins can manage all module permissions
CREATE POLICY "Admins can manage user_modules"
  ON public.user_modules FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Users can read their own modules
CREATE POLICY "Users can read own modules"
  ON public.user_modules FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
