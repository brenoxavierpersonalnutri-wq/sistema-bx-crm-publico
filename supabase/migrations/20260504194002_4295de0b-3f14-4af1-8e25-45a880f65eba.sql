UPDATE public.collaborator_tasks
SET title = 'Cobrar Restante: ' || regexp_replace(title, '^Cobrança de Resíduo:\s*', '')
WHERE metadata->>'type' = 'residuo'
  AND title LIKE 'Cobrança de Resíduo:%';