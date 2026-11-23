-- BONSI: hardening за результатами аудиту (адитивна міграція).
-- 1) індекс і дешевше прибирання в auth_throttle; 2) індекси на зовнішні ключі;
-- 3) revoke для допоміжних функцій; 4) перевірка існування об'єкта при реєстрації файлу;
-- 5) послідовність замість random() для номера запиту на зміни.

-- 1. auth_throttle ---------------------------------------------------------
create index if not exists auth_throttle_window_idx on public.auth_throttle (window_start);

create or replace function public.auth_throttle_hit(p_key text, p_limit int, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits int;
begin
  insert into public.auth_throttle as t (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case when t.window_start < now() - p_window then 1 else t.hits + 1 end,
        window_start = case when t.window_start < now() - p_window then now() else t.window_start end
  returning hits into v_hits;
  -- Прибирання лише в ~1% викликів: не сканує таблицю при кожній спробі входу.
  if random() < 0.01 then
    delete from public.auth_throttle where window_start < now() - interval '2 days';
  end if;
  return v_hits <= p_limit;
end;
$$;

revoke all on function public.auth_throttle_hit(text, int, interval) from public, anon, authenticated;
grant execute on function public.auth_throttle_hit(text, int, interval) to service_role;

-- 2. Індекси на зовнішні ключі (пропускаємо, якщо таблиці/колонки немає) -------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('notification_outbox', 'order_id'), ('email_outbox', 'order_id'),
      ('proposal_decisions', 'proposal_id'), ('deliverable_decisions', 'deliverable_id'),
      ('payment_events', 'invoice_id'), ('estimates', 'project_id'), ('estimates', 'order_id'),
      ('handover_decisions', 'project_id'), ('support_tickets', 'client_id'),
      ('support_tickets', 'assignee_id'), ('support_tickets', 'change_request_id'),
      ('portfolio_items', 'project_id'), ('project_scope', 'source_proposal_id'),
      ('project_files', 'uploader_id'), ('project_messages', 'author_id')
    ) as t(tbl, col)
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = r.tbl and column_name = r.col
    ) then
      execute format('create index if not exists %I on public.%I (%I)', r.tbl || '_' || r.col || '_idx', r.tbl, r.col);
    end if;
  end loop;
end;
$$;

-- 3. Допоміжні функції не мають бути видимі в REST RPC ------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('valid_task_links', 'valid_task_checklist')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end;
$$;

-- 4. client_register_file: шлях має вказувати на реально завантажений об'єкт -----
create or replace function public.client_register_file(
  p_project uuid, p_category text, p_name text, p_mime text, p_size bigint, p_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_project_client(p_project) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_category not in ('logo', 'text', 'mockup', 'document', 'attachment', 'other') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if not public.file_mime_allowed(p_mime) then
    raise exception 'mime_not_allowed' using errcode = '22023';
  end if;
  -- Не дозволяємо «приписати» собі чужий/службовий файл: об'єкт має існувати в сховищі
  -- (перевірка пропускається лише там, де схеми storage немає, наприклад у чистому Postgres для тестів).
  if to_regclass('storage.objects') is not null then
    if not exists (select 1 from storage.objects where bucket_id = 'project-files' and name = p_path) then
      raise exception 'no_object' using errcode = '22023';
    end if;
  end if;
  if exists (select 1 from public.project_files where storage_path = p_path) then
    raise exception 'path_taken' using errcode = '23505';
  end if;
  insert into public.project_files (project_id, uploader_id, uploader_role, category, display_name, mime, size_bytes, storage_path)
  values (p_project, auth.uid(), 'client', p_category, left(btrim(p_name), 200), p_mime, p_size, p_path)
  returning id into v_id;
  perform public.project_log(p_project, auth.uid(), 'client', 'file_uploaded', jsonb_build_object('name', left(btrim(p_name), 200), 'category', p_category), p_category <> 'attachment');
  return v_id;
end;
$$;

revoke all on function public.client_register_file(uuid, text, text, text, bigint, text) from public, anon;
grant execute on function public.client_register_file(uuid, text, text, text, bigint, text) to authenticated;

-- 5. Номер запиту на зміни: послідовність замість random() (без колізій) -------
create sequence if not exists public.change_request_seq;
alter table public.change_requests
  alter column number set default ('CR-' || to_char(now() at time zone 'utc', 'YYYY') || '-' || lpad(nextval('public.change_request_seq')::text, 6, '0'));
