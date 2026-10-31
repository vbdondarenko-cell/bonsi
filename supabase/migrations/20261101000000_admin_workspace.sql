-- BONSI Studios V0.2: Admin Workspace.
-- Застосовується ЛИШЕ до окремого проєкту Supabase для BONSI. Міграція адитивна:
-- нічого не видаляє й не змінює наявні дані заявок.
--
-- Модель доступу:
--  * адміністратори — явний allowlist `admin_users` (відкритої реєстрації немає; у Supabase
--    Auth вимкніть signups, а акаунти створюйте вручну);
--  * читання й зміни доступні лише активному адміністратору із сесією рівня aal2 (пройдено MFA);
--  * всі записи йдуть через security definer функції, які пишуть історію з auth.uid();
--  * anon не має жодного доступу; service_role використовується тільки сервером для приймання
--    заявок і доставки сповіщень.

-- ---------------------------------------------------------------------------
-- Allowlist адміністраторів
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text not null check (email = lower(email)),
  display_name text not null check (char_length(display_name) between 1 and 80),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Не більше двох адміністраторів: BONSI — студія двох засновників.
create or replace function public.enforce_admin_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.admin_users where user_id <> new.user_id) >= 2 then
    raise exception 'admin_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists admin_users_limit on public.admin_users;
create trigger admin_users_limit
  before insert on public.admin_users
  for each row execute function public.enforce_admin_limit();

-- ---------------------------------------------------------------------------
-- Призначення, нотатки, історія, чергa сповіщень
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists assigned_to uuid references public.admin_users (user_id) on delete set null;

create index if not exists orders_assigned_to_idx on public.orders (assigned_to);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

create table if not exists public.order_notes (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  author_id  uuid references public.admin_users (user_id) on delete set null,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists order_notes_order_idx on public.order_notes (order_id, created_at desc);

create table if not exists public.order_events (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references public.orders (id) on delete cascade,
  actor_id   uuid references public.admin_users (user_id) on delete set null,
  type       text not null check (type in ('created', 'status_changed', 'assigned', 'note_added')),
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, created_at desc, id desc);

-- Transactional outbox: запис про сповіщення створюється в одній транзакції із заявкою,
-- тому заявка не може «загубити» повідомлення, а доставка повторюється до успіху.
create table if not exists public.notification_outbox (
  id              bigint generated always as identity primary key,
  order_id        uuid not null references public.orders (id) on delete cascade,
  channel         text not null check (channel in ('telegram')),
  status          text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'dead')),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until    timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index if not exists notification_outbox_due_idx
  on public.notification_outbox (status, next_attempt_at);

-- ---------------------------------------------------------------------------
-- Перевірки доступу
-- ---------------------------------------------------------------------------
-- Користувач у allowlist (без вимоги MFA): потрібно, щоб показати екран налаштування MFA.
create or replace function public.admin_is_allowlisted()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users where user_id = (select auth.uid()) and active
  );
$$;

-- Повний доступ: активний адміністратор + сесія пройшла MFA (aal2).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.admin_is_allowlisted()
     and coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2';
$$;

-- ---------------------------------------------------------------------------
-- RLS: читати можуть лише адміністратори; прямих записів з браузера/користувача немає
-- ---------------------------------------------------------------------------
alter table public.admin_users enable row level security;
alter table public.order_notes enable row level security;
alter table public.order_events enable row level security;
alter table public.notification_outbox enable row level security;

drop policy if exists admin_read_orders on public.orders;
create policy admin_read_orders on public.orders
  for select to authenticated using ((select public.is_admin()));

drop policy if exists admin_read_admins on public.admin_users;
create policy admin_read_admins on public.admin_users
  for select to authenticated using ((select public.is_admin()));

drop policy if exists admin_read_notes on public.order_notes;
create policy admin_read_notes on public.order_notes
  for select to authenticated using ((select public.is_admin()));

drop policy if exists admin_read_events on public.order_events;
create policy admin_read_events on public.order_events
  for select to authenticated using ((select public.is_admin()));

drop policy if exists admin_read_outbox on public.notification_outbox;
create policy admin_read_outbox on public.notification_outbox
  for select to authenticated using ((select public.is_admin()));

revoke all on public.admin_users, public.order_notes, public.order_events, public.notification_outbox
  from anon, authenticated;
revoke all on public.orders from anon, authenticated;
grant select on public.admin_users, public.order_notes, public.order_events,
  public.notification_outbox to authenticated;
-- PII-мінімізація: адміністратору не потрібні ip_hash та user_agent, тож вони недоступні.
grant select (
  id, ticket_number, service, idea, budget, deadline, name, email, phone, status,
  assigned_to, consent_at, consent_policy_version, created_at, updated_at
) on public.orders to authenticated;

revoke all on sequence public.order_ticket_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Операції адміністратора (єдиний шлях запису; історія пишеться тут)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_order_status(p_order uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('new', 'in_review', 'accepted', 'in_progress', 'done', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select status into v_old from public.orders where id = p_order for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_old = p_status then
    return;
  end if;

  update public.orders set status = p_status where id = p_order;
  insert into public.order_events (order_id, actor_id, type, data)
  values (p_order, auth.uid(), 'status_changed', jsonb_build_object('from', v_old, 'to', p_status));
end;
$$;

create or replace function public.admin_assign_order(p_order uuid, p_assignee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_assignee is not null
     and not exists (select 1 from public.admin_users where user_id = p_assignee and active) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;

  select assigned_to into v_old from public.orders where id = p_order for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_old is not distinct from p_assignee then
    return;
  end if;

  update public.orders set assigned_to = p_assignee where id = p_order;
  insert into public.order_events (order_id, actor_id, type, data)
  values (p_order, auth.uid(), 'assigned', jsonb_build_object('from', v_old, 'to', p_assignee));
end;
$$;

create or replace function public.admin_add_note(p_order uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_body text := btrim(p_body);
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;
  if not exists (select 1 from public.orders where id = p_order) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into public.order_notes (order_id, author_id, body)
  values (p_order, auth.uid(), v_body)
  returning id into v_id;

  insert into public.order_events (order_id, actor_id, type, data)
  values (p_order, auth.uid(), 'note_added', jsonb_build_object('note_id', v_id));
  return v_id;
end;
$$;

-- Пошук і фільтри. security invoker: RLS застосовується до виклику користувача.
-- Параметри не конкатенуються в SQL, спецсимволи LIKE екрануються.
create or replace function public.admin_search_orders(
  p_q        text default null,
  p_status   text default null,
  p_service  text default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null,
  p_limit    int default 20,
  p_offset   int default 0
)
returns table (
  id uuid, ticket_number text, service text, name text, email text, status text,
  assigned_to uuid, created_at timestamptz, total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select '%' || replace(replace(replace(lower(btrim(coalesce(p_q, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           btrim(coalesce(p_q, '')) = '' as no_q
  )
  select o.id, o.ticket_number, o.service, o.name, o.email, o.status, o.assigned_to, o.created_at,
         count(*) over () as total_count
  from public.orders o, params
  where (params.no_q
         or lower(o.ticket_number) like params.pat
         or lower(o.name) like params.pat
         or o.email like params.pat)
    and (p_status is null or o.status = p_status)
    and (p_service is null or o.service = p_service)
    and (p_from is null or o.created_at >= p_from)
    and (p_to is null or o.created_at < p_to)
  order by o.created_at desc, o.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

create or replace function public.admin_dashboard_stats()
returns table (status text, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.status, count(*) from public.orders o group by o.status;
$$;

revoke all on function public.admin_is_allowlisted(), public.is_admin(),
  public.admin_set_order_status(uuid, text), public.admin_assign_order(uuid, uuid),
  public.admin_add_note(uuid, text),
  public.admin_search_orders(text, text, text, timestamptz, timestamptz, int, int),
  public.admin_dashboard_stats()
  from public, anon, authenticated;
grant execute on function public.admin_is_allowlisted(), public.is_admin(),
  public.admin_set_order_status(uuid, text), public.admin_assign_order(uuid, uuid),
  public.admin_add_note(uuid, text),
  public.admin_search_orders(text, text, text, timestamptz, timestamptz, int, int),
  public.admin_dashboard_stats()
  to authenticated;

-- ---------------------------------------------------------------------------
-- Доставка сповіщень (лише service_role)
-- ---------------------------------------------------------------------------
-- Бере порцію готових до відправки повідомлень і «замикає» їх на 2 хв.; skip locked
-- дозволяє кільком воркерам не дублювати відправку. Потім повертає дані для повідомлення.
create or replace function public.claim_notifications(p_limit int default 10)
returns table (
  outbox_id bigint, attempts int, order_id uuid, ticket_number text, service text, name text, created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select n.id
    from public.notification_outbox n
    where n.channel = 'telegram'
      and ((n.status = 'pending' and n.next_attempt_at <= now())
        or (n.status = 'sending' and n.locked_until < now()))
    order by n.next_attempt_at, n.id
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  ), claimed as (
    update public.notification_outbox n
       set status = 'sending', locked_until = now() + interval '2 minutes', attempts = n.attempts + 1
      from due
     where n.id = due.id
    returning n.id, n.attempts, n.order_id
  )
  select c.id, c.attempts, c.order_id, o.ticket_number, o.service, o.name, o.created_at
  from claimed c join public.orders o on o.id = c.order_id;
end;
$$;

create or replace function public.complete_notification(p_id bigint, p_error text default null, p_max_attempts int default 8)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
begin
  if p_error is null then
    update public.notification_outbox
       set status = 'sent', sent_at = now(), locked_until = null, last_error = null
     where id = p_id;
    return;
  end if;

  select attempts into v_attempts from public.notification_outbox where id = p_id;
  if v_attempts >= p_max_attempts then
    update public.notification_outbox
       set status = 'dead', locked_until = null, last_error = left(p_error, 300)
     where id = p_id;
  else
    -- Експоненційна затримка: 1, 2, 4, 8… хв., не більше 60 хв.
    update public.notification_outbox
       set status = 'pending', locked_until = null, last_error = left(p_error, 300),
           next_attempt_at = now() + least(interval '60 minutes', (interval '1 minute') * power(2, greatest(v_attempts - 1, 0)))
     where id = p_id;
  end if;
end;
$$;

revoke all on function public.claim_notifications(int), public.complete_notification(bigint, text, int)
  from public, anon, authenticated;
grant execute on function public.claim_notifications(int), public.complete_notification(bigint, text, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- create_order: тепер також пише подію «created» і (за потреби) ставить сповіщення в чергу
-- ---------------------------------------------------------------------------
drop function if exists public.create_order(text, text, text, text, text, text, text, text, text, text);

create or replace function public.create_order(
  p_service                text,
  p_idea                   text,
  p_budget                 text,
  p_deadline               text,
  p_name                   text,
  p_email                  text,
  p_phone                  text,
  p_ip_hash                text,
  p_user_agent             text,
  p_consent_policy_version text,
  p_notify                 boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window            constant interval := interval '1 hour';
  v_ip_limit          constant int := 5;
  v_unknown_ip_limit  constant int := 30;
  v_email_limit       constant int := 3;
  v_global_limit      constant int := 200;
  v_email             text := lower(p_email);
  v_ticket            text;
  v_id                uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('bonsi:order:ip:' || coalesce(p_ip_hash, 'unknown'), 0));
  perform pg_advisory_xact_lock(hashtextextended('bonsi:order:email:' || v_email, 0));

  if (
    select count(*) from public.orders
    where ip_hash is not distinct from p_ip_hash and created_at > now() - v_window
  ) >= (case when p_ip_hash is null then v_unknown_ip_limit else v_ip_limit end) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  if (select count(*) from public.orders where email = v_email and created_at > now() - v_window) >= v_email_limit then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  if (select count(*) from public.orders where created_at > now() - v_window) >= v_global_limit then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.orders (
    service, idea, budget, deadline, name, email, phone,
    ip_hash, user_agent, consent_at, consent_policy_version
  ) values (
    p_service, p_idea, p_budget, p_deadline, p_name, v_email, nullif(p_phone, ''),
    p_ip_hash, left(p_user_agent, 300), now(), p_consent_policy_version
  )
  returning id, ticket_number into v_id, v_ticket;

  insert into public.order_events (order_id, actor_id, type) values (v_id, null, 'created');

  if p_notify then
    insert into public.notification_outbox (order_id, channel) values (v_id, 'telegram');
  end if;

  return v_ticket;
end;
$$;

revoke all on function public.create_order(text, text, text, text, text, text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.create_order(text, text, text, text, text, text, text, text, text, text, boolean)
  to service_role;
