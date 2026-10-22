create or replace function delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  delete from public.user_modules where user_id = target_user_id;
  delete from public.alunas where user_id = target_user_id;
  delete from public.consultations where user_id = target_user_id;
  delete from public.collaborator_tasks where user_id = target_user_id;
  delete from public.user_roles where user_id = target_user_id;
  delete from public.profiles where id = target_user_id;
  delete from auth.users where id = target_user_id;
end;
$$;