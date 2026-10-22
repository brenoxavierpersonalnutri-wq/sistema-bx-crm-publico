-- Create tasks table
CREATE TABLE IF NOT EXISTS public.collaborator_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    due_date TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    type TEXT NOT NULL DEFAULT 'manual' CHECK (type IN ('manual', 'reavaliacao', 'liberacao')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.collaborator_tasks ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own tasks" 
    ON public.collaborator_tasks FOR SELECT 
    USING (
        auth.uid() = user_id 
        OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Users can update their own tasks" 
    ON public.collaborator_tasks FOR UPDATE 
    USING (
        auth.uid() = user_id 
        OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Admins can insert tasks" 
    ON public.collaborator_tasks FOR INSERT 
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Admins can delete tasks" 
    ON public.collaborator_tasks FOR DELETE 
    USING (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    );

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_collaborator_tasks_updated_at
    BEFORE UPDATE ON public.collaborator_tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
