-- Resumo do feedback escrito por IA.
alter table public.feedback_semanal_responses
  add column if not exists resumo_ia text,
  add column if not exists resumo_ia_at timestamptz;

-- O resumo é escrito pela edge function feedback-semanal-resumo (service role)
-- e lido no dashboard por quem está logado.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'feedback_semanal_responses'
      and policyname = 'feedback_semanal_update_resumo'
  ) then
    create policy feedback_semanal_update_resumo
      on public.feedback_semanal_responses
      for update
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
