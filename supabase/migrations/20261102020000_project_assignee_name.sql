-- BONSI V0.4: клієнт бачить ім'я виконавця свого проєкту, не маючи доступу до таблиці admin_users.
create or replace function public.project_assignee_name(p_project uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.display_name
  from public.projects p
  join public.admin_users a on a.user_id = p.assignee_id
  where p.id = p_project
    and (p.client_id = (select auth.uid()) or public.is_admin());
$$;

revoke all on function public.project_assignee_name(uuid) from public, anon, authenticated;
grant execute on function public.project_assignee_name(uuid) to authenticated;
