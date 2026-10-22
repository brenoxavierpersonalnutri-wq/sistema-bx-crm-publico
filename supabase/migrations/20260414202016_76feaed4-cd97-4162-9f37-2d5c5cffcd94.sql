
CREATE POLICY "Users can insert own tasks"
ON public.collaborator_tasks FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own tasks"
ON public.collaborator_tasks FOR DELETE
TO authenticated
USING (user_id = auth.uid());
