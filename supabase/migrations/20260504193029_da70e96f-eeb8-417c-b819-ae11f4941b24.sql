-- Backfill: cria tarefas de cobrança de resíduo para consultas com signal_follow_up_date
-- pendentes que ainda não têm tarefa criada para os colaboradores aprovados
INSERT INTO public.collaborator_tasks (user_id, title, description, due_date, type, status, metadata)
SELECT 
  p.id AS user_id,
  'Cobrança de Resíduo: ' || c.client_name AS title,
  'Cobrar o restante do valor da venda de ' || c.client_name || '.' AS description,
  (c.signal_follow_up_date::text || 'T09:00:00')::timestamptz AS due_date,
  'manual' AS type,
  'pending' AS status,
  jsonb_build_object('type', 'residuo', 'consultationId', c.id) AS metadata
FROM public.consultations c
CROSS JOIN public.profiles p
WHERE c.gave_signal = true
  AND c.signal_follow_up_date IS NOT NULL
  AND COALESCE(c.signal_residue_paid, false) = false
  AND p.approved = true
  AND NOT EXISTS (
    SELECT 1 FROM public.collaborator_tasks t
    WHERE t.user_id = p.id
      AND t.metadata->>'type' = 'residuo'
      AND t.metadata->>'consultationId' = c.id::text
  );