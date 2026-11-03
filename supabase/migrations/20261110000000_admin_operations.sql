-- BONSI V0.5: захист адмінських операцій від повторного виконання (подвійний клік, повтор запиту).
-- Клієнт надсилає ідентифікатор спроби (UUID); сервер «захоплює» його перед виконанням. Другий запит із тим самим
-- ідентифікатором не виконується. Невдала операція звільняє ідентифікатор.
begin;

create table if not exists public.admin_operations (
  op_id      uuid primary key,
  admin_id   uuid not null references auth.users (id) on delete cascade,
  action     text not null check (char_length(action) between 1 and 80),
  created_at timestamptz not null default now()
);
create index if not exists admin_operations_created_idx on public.admin_operations (created_at);

alter table public.admin_operations enable row level security;
revoke all on public.admin_operations from anon, authenticated;

-- true — перший запит із цим ідентифікатором (можна виконувати); false — дублікат.
create or replace function public.admin_claim_operation(p_op uuid, p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted int;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Записи старші за добу не потрібні: повтор тієї ж спроби через добу неможливий.
  delete from public.admin_operations where created_at < now() - interval '1 day';
  insert into public.admin_operations (op_id, admin_id, action)
  values (p_op, auth.uid(), left(coalesce(nullif(btrim(p_action), ''), 'unknown'), 80))
  on conflict (op_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

-- Звільняє ідентифікатор після невдалої операції (лише власний).
create or replace function public.admin_release_operation(p_op uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.admin_operations where op_id = p_op and admin_id = auth.uid();
end;
$$;

revoke all on function public.admin_claim_operation(uuid, text), public.admin_release_operation(uuid) from public, anon, authenticated;
grant execute on function public.admin_claim_operation(uuid, text), public.admin_release_operation(uuid) to authenticated;

commit;
