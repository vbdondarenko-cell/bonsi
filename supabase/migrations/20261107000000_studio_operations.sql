-- BONSI V0.5, фаза 2: внутрішня робота студії (лише адміністратори).
--  1. Завдання (Kanban): статуси, виконавець, пріоритет, дедлайн, чекліст, посилання, коментарі, журнал, оптимістична конкурентність.
--  2. Кошториси (внутрішній калькулятор) і витрати проєкту.
--  3. Фінансове зведення: договори ≠ рахунки ≠ підтверджені надходження.
-- Клієнт не має жодного доступу до цих таблиць: RLS дозволяє читання лише адміністратору з MFA (aal2).

-- ---------------------------------------------------------------------------
-- 1. Завдання
-- ---------------------------------------------------------------------------
create table if not exists public.studio_tasks (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid references public.projects (id) on delete set null,
  title          text not null check (char_length(title) between 1 and 200),
  description    text not null default '' check (char_length(description) <= 8000),
  status         text not null default 'backlog' check (status in ('backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done')),
  priority       text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee_id    uuid references public.admin_users (user_id) on delete set null,
  deadline       date,
  blocked_reason text check (blocked_reason is null or char_length(blocked_reason) <= 1000),
  risk_note      text check (risk_note is null or char_length(risk_note) <= 1000),
  checklist      jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 50),
  links          jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 20),
  version        int not null default 1,
  created_by     uuid references public.admin_users (user_id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  done_at        timestamptz,
  check (status <> 'blocked' or blocked_reason is not null)
);
create index if not exists studio_tasks_status_idx on public.studio_tasks (status, priority, deadline);
create index if not exists studio_tasks_project_idx on public.studio_tasks (project_id) where project_id is not null;
create index if not exists studio_tasks_assignee_idx on public.studio_tasks (assignee_id) where assignee_id is not null;

create table if not exists public.task_comments (
  id         bigint generated always as identity primary key,
  task_id    uuid not null references public.studio_tasks (id) on delete cascade,
  author_id  uuid references public.admin_users (user_id) on delete set null,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, id);

create table if not exists public.task_events (
  id         bigint generated always as identity primary key,
  task_id    uuid not null references public.studio_tasks (id) on delete cascade,
  actor_id   uuid references public.admin_users (user_id) on delete set null,
  type       text not null check (type in ('created', 'updated', 'status_changed', 'assigned', 'commented')),
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists task_events_task_idx on public.task_events (task_id, id);
drop trigger if exists task_events_append_only on public.task_events;
create trigger task_events_append_only before update on public.task_events
  for each row execute function public.forbid_mutation();

-- Перевірка посилань: лише https; тип — з переліку (GitHub PR, Figma, тестова версія, інше).
create or replace function public.valid_task_links(p_links jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(
    jsonb_typeof(e) = 'object'
    and (e ->> 'kind') in ('github', 'figma', 'preview', 'other')
    and char_length(e ->> 'url') between 10 and 500
    and (e ->> 'url') ~* '^https://[^\s<>"]+$'
  ), true)
  from jsonb_array_elements(p_links) e;
$$;

create or replace function public.valid_task_checklist(p_list jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(
    jsonb_typeof(e) = 'object'
    and char_length(coalesce(e ->> 'text', '')) between 1 and 300
    and jsonb_typeof(e -> 'done') = 'boolean'
  ), true)
  from jsonb_array_elements(p_list) e;
$$;

alter table public.studio_tasks drop constraint if exists studio_tasks_links_valid;
alter table public.studio_tasks add constraint studio_tasks_links_valid check (public.valid_task_links(links) and public.valid_task_checklist(checklist));

-- Створення
create or replace function public.admin_create_task(
  p_title text, p_description text, p_project uuid, p_assignee uuid, p_priority text, p_deadline date, p_status text default 'backlog'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status = 'blocked' then
    raise exception 'blocked_reason_required' using errcode = '22023';
  end if;
  insert into public.studio_tasks (title, description, project_id, assignee_id, priority, deadline, status, created_by, done_at)
  values (btrim(coalesce(p_title, '')), coalesce(p_description, ''), p_project, p_assignee, coalesce(p_priority, 'normal'), p_deadline, coalesce(p_status, 'backlog'),
          (select user_id from public.admin_users where user_id = auth.uid()), case when p_status = 'done' then now() end)
  returning id into v_id;
  insert into public.task_events (task_id, actor_id, type, data) values (v_id, auth.uid(), 'created', jsonb_build_object('status', coalesce(p_status, 'backlog')));
  return v_id;
end;
$$;

-- Оновлення полів із перевіркою версії: якщо іншого адміністратора вже змінив завдання, повертається stale (дані не перезаписуються мовчки).
create or replace function public.admin_update_task(
  p_id uuid, p_expected int, p_title text, p_description text, p_project uuid, p_assignee uuid, p_priority text, p_deadline date,
  p_risk text, p_checklist jsonb, p_links jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.studio_tasks;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_t from public.studio_tasks where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_t.version <> p_expected then
    raise exception 'stale' using errcode = 'P0001';
  end if;
  update public.studio_tasks
     set title = btrim(coalesce(p_title, title)), description = coalesce(p_description, description), project_id = p_project, assignee_id = p_assignee,
         priority = coalesce(p_priority, priority), deadline = p_deadline, risk_note = nullif(btrim(coalesce(p_risk, '')), ''),
         checklist = coalesce(p_checklist, checklist), links = coalesce(p_links, links), version = version + 1, updated_at = now()
   where id = p_id;
  insert into public.task_events (task_id, actor_id, type, data) values (p_id, auth.uid(), 'updated', '{}'::jsonb);
  if p_assignee is distinct from v_t.assignee_id then
    insert into public.task_events (task_id, actor_id, type, data) values (p_id, auth.uid(), 'assigned', jsonb_build_object('from', v_t.assignee_id, 'to', p_assignee));
  end if;
  return v_t.version + 1;
end;
$$;

create or replace function public.admin_move_task(p_id uuid, p_expected int, p_status text, p_reason text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.studio_tasks;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_status = 'blocked' and v_reason is null then
    raise exception 'blocked_reason_required' using errcode = '22023';
  end if;
  select * into v_t from public.studio_tasks where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_t.version <> p_expected then
    raise exception 'stale' using errcode = 'P0001';
  end if;
  if v_t.status = p_status then
    return v_t.version;
  end if;
  update public.studio_tasks
     set status = p_status, blocked_reason = case when p_status = 'blocked' then left(v_reason, 1000) else null end,
         done_at = case when p_status = 'done' then now() else null end, version = version + 1, updated_at = now()
   where id = p_id;
  insert into public.task_events (task_id, actor_id, type, data) values (p_id, auth.uid(), 'status_changed', jsonb_build_object('from', v_t.status, 'to', p_status, 'reason', left(v_reason, 300)));
  return v_t.version + 1;
end;
$$;

create or replace function public.admin_comment_task(p_id uuid, p_body text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.studio_tasks where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.task_comments (task_id, author_id, body) values (p_id, (select user_id from public.admin_users where user_id = auth.uid()), btrim(coalesce(p_body, '')))
  returning id into v_id;
  insert into public.task_events (task_id, actor_id, type, data) values (p_id, auth.uid(), 'commented', jsonb_build_object('comment', v_id));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Кошториси й витрати
-- ---------------------------------------------------------------------------
create table if not exists public.estimates (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid references public.projects (id) on delete restrict,
  order_id         uuid references public.orders (id) on delete restrict,
  title            text not null check (char_length(title) between 1 and 160),
  currency         text not null default 'UAH' check (currency in ('UAH', 'USD', 'EUR')),
  reserve_percent  numeric(5, 2) not null default 15 check (reserve_percent between 0 and 100),
  margin_percent   numeric(5, 2) not null default 30 check (margin_percent >= 0 and margin_percent < 90),
  other_costs      numeric(12, 2) not null default 0 check (other_costs >= 0),
  final_price      numeric(12, 2) check (final_price is null or final_price >= 0),
  note             text check (note is null or char_length(note) <= 2000),
  status           text not null default 'draft' check (status in ('draft', 'final')),
  created_by       uuid references public.admin_users (user_id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (project_id is not null or order_id is not null)
);
create table if not exists public.estimate_lines (
  id          bigint generated always as identity primary key,
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  category    text not null check (category in ('design', 'frontend', 'backend', 'database', 'android', 'ios', 'integrations', 'qa', 'deployment', 'support')),
  hours       numeric(8, 2) not null check (hours >= 0 and hours <= 5000),
  rate        numeric(10, 2) not null check (rate >= 0),
  note        text check (note is null or char_length(note) <= 300),
  unique (estimate_id, category)
);

create table if not exists public.project_expenses (
  id          bigint generated always as identity primary key,
  project_id  uuid not null references public.projects (id) on delete restrict,
  category    text not null check (char_length(category) between 1 and 60),
  amount      numeric(12, 2) not null check (amount > 0),
  currency    text not null check (currency in ('UAH', 'USD', 'EUR')),
  incurred_on date not null default current_date,
  note        text check (note is null or char_length(note) <= 500),
  created_by  uuid references public.admin_users (user_id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists project_expenses_project_idx on public.project_expenses (project_id, incurred_on);

-- Підсумок кошторису. Це внутрішній розрахунок, а не пропозиція ціни клієнту.
--   собівартість = Σ(години × ставка) + резерв% + інші витрати; рекомендована ціна = собівартість / (1 − маржа%).
create or replace function public.estimate_totals(p_estimate uuid)
returns table (base_cost numeric, reserve numeric, other_costs numeric, total_cost numeric, recommended_price numeric, final_price numeric, hours numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with e as (select * from public.estimates where id = p_estimate and public.is_admin()),
       l as (select coalesce(sum(hours * rate), 0) as base, coalesce(sum(hours), 0) as h from public.estimate_lines where estimate_id = p_estimate)
  select round(l.base, 2),
         round(l.base * e.reserve_percent / 100, 2),
         e.other_costs,
         round(l.base * (1 + e.reserve_percent / 100) + e.other_costs, 2),
         round((l.base * (1 + e.reserve_percent / 100) + e.other_costs) / (1 - e.margin_percent / 100), 2),
         e.final_price,
         l.h
  from e, l;
$$;

create or replace function public.admin_create_estimate(p_title text, p_project uuid, p_order uuid, p_currency text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.estimates (title, project_id, order_id, currency, created_by)
  values (btrim(coalesce(p_title, '')), p_project, p_order, coalesce(p_currency, 'UAH'), (select user_id from public.admin_users where user_id = auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- Збереження параметрів і рядків; погоджений (final) кошторис не змінюється.
create or replace function public.admin_save_estimate(
  p_id uuid, p_reserve numeric, p_margin numeric, p_other numeric, p_final_price numeric, p_note text, p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_line jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select status into v_status from public.estimates where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_status = 'final' then
    raise exception 'estimate_final' using errcode = 'P0001';
  end if;
  update public.estimates
     set reserve_percent = p_reserve, margin_percent = p_margin, other_costs = p_other, final_price = p_final_price,
         note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
   where id = p_id;
  delete from public.estimate_lines where estimate_id = p_id;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    insert into public.estimate_lines (estimate_id, category, hours, rate, note)
    values (p_id, v_line ->> 'category', (v_line ->> 'hours')::numeric, (v_line ->> 'rate')::numeric, nullif(v_line ->> 'note', ''));
  end loop;
end;
$$;

create or replace function public.admin_finalize_estimate(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.estimates set status = 'final', updated_at = now() where id = p_id and status = 'draft';
  if not found then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.admin_add_expense(p_project uuid, p_category text, p_amount numeric, p_currency text, p_on date, p_note text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.project_expenses (project_id, category, amount, currency, incurred_on, note, created_by)
  values (p_project, btrim(coalesce(p_category, '')), p_amount, p_currency, coalesce(p_on, current_date), nullif(btrim(coalesce(p_note, '')), ''),
          (select user_id from public.admin_users where user_id = auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Фінансове зведення (за валютами; не змішує прогноз, виставлене й отримане)
-- ---------------------------------------------------------------------------
create or replace function public.admin_finance_summary(p_month date default null)
returns table (
  currency text,
  contracts_total numeric,   -- прогноз: погоджені пропозиції + погоджені зміни (ще не гроші)
  invoiced numeric,          -- виставлено рахунками (не скасованими)
  received numeric,          -- фактично підтверджені надходження мінус повернення
  unpaid numeric,            -- виставлено − отримано по виставлених рахунках
  overdue numeric,           -- неоплачений залишок прострочених рахунків
  refunds numeric,
  expenses numeric,
  margin numeric,            -- отримано − витрати (попередня маржа, не прибуток)
  month_received numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := date_trunc('month', coalesce(p_month, current_date))::date;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  with cur as (
    select 'UAH'::text as c union select 'USD' union select 'EUR'
  ),
  contracts as (
    select p.currency, sum(p.price_amount) as amount
    from public.proposals p
    where p.status = 'approved' and p.price_amount is not null
      and p.version = (select max(version) from public.proposals q where q.project_id = p.project_id and q.status = 'approved')
    group by p.currency
    union all
    select s.currency, sum(s.price_amount) from public.project_scope s where s.kind = 'amendment' and s.price_amount is not null and s.currency is not null group by s.currency
  ),
  inv as (
    select i.currency, i.id, i.amount, i.status, i.due_date, public.invoice_paid_raw(i.id) as paid
    from public.invoices i where i.status in ('issued')
  ),
  pay as (
    select p.currency,
           sum(case when p.kind = 'payment' then p.amount else -p.amount end) as net,
           sum(case when p.kind = 'refund' then p.amount else 0 end) as refunded,
           sum(case when p.kind = 'payment' and coalesce(p.decided_at, p.created_at) >= v_from and coalesce(p.decided_at, p.created_at) < (v_from + interval '1 month') then p.amount
                    when p.kind = 'refund' and coalesce(p.decided_at, p.created_at) >= v_from and coalesce(p.decided_at, p.created_at) < (v_from + interval '1 month') then -p.amount else 0 end) as month_net
    from public.payments p where p.status = 'confirmed' group by p.currency
  ),
  exp as (select e.currency, sum(e.amount) as amount from public.project_expenses e group by e.currency)
  select cur.c,
         round(coalesce((select sum(amount) from contracts where contracts.currency = cur.c), 0), 2)::numeric(14, 2),
         round(coalesce((select sum(amount) from inv where inv.currency = cur.c), 0), 2)::numeric(14, 2),
         round(coalesce((select net from pay where pay.currency = cur.c), 0), 2)::numeric(14, 2),
         round(coalesce((select sum(greatest(amount - paid, 0)) from inv where inv.currency = cur.c), 0), 2)::numeric(14, 2),
         round(coalesce((select sum(greatest(amount - paid, 0)) from inv where inv.currency = cur.c and inv.due_date is not null and inv.due_date < current_date), 0), 2)::numeric(14, 2),
         round(coalesce((select refunded from pay where pay.currency = cur.c), 0), 2)::numeric(14, 2),
         round(coalesce((select amount from exp where exp.currency = cur.c), 0), 2)::numeric(14, 2),
         round(coalesce((select net from pay where pay.currency = cur.c), 0) - coalesce((select amount from exp where exp.currency = cur.c), 0), 2)::numeric(14, 2),
         round(coalesce((select month_net from pay where pay.currency = cur.c), 0), 2)::numeric(14, 2)
  from cur
  order by cur.c;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: лише адміністратор з MFA
-- ---------------------------------------------------------------------------
alter table public.studio_tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_events enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_lines enable row level security;
alter table public.project_expenses enable row level security;
revoke all on public.studio_tasks, public.task_comments, public.task_events, public.estimates, public.estimate_lines, public.project_expenses from anon, authenticated;
grant select on public.studio_tasks, public.task_comments, public.task_events, public.estimates, public.estimate_lines, public.project_expenses to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['studio_tasks', 'task_comments', 'task_events', 'estimates', 'estimate_lines', 'project_expenses'] loop
    execute format('drop policy if exists admin_read_%1$s on public.%1$s', t);
    execute format('create policy admin_read_%1$s on public.%1$s for select to authenticated using ((select public.is_admin()))', t);
  end loop;
end $$;

revoke all on function
  public.admin_create_task(text, text, uuid, uuid, text, date, text),
  public.admin_update_task(uuid, int, text, text, uuid, uuid, text, date, text, jsonb, jsonb),
  public.admin_move_task(uuid, int, text, text),
  public.admin_comment_task(uuid, text),
  public.estimate_totals(uuid),
  public.admin_create_estimate(text, uuid, uuid, text),
  public.admin_save_estimate(uuid, numeric, numeric, numeric, numeric, text, jsonb),
  public.admin_finalize_estimate(uuid),
  public.admin_add_expense(uuid, text, numeric, text, date, text),
  public.admin_finance_summary(date)
  from public, anon, authenticated;
grant execute on function
  public.admin_create_task(text, text, uuid, uuid, text, date, text),
  public.admin_update_task(uuid, int, text, text, uuid, uuid, text, date, text, jsonb, jsonb),
  public.admin_move_task(uuid, int, text, text),
  public.admin_comment_task(uuid, text),
  public.estimate_totals(uuid),
  public.admin_create_estimate(text, uuid, uuid, text),
  public.admin_save_estimate(uuid, numeric, numeric, numeric, numeric, text, jsonb),
  public.admin_finalize_estimate(uuid),
  public.admin_add_expense(uuid, text, numeric, text, date, text),
  public.admin_finance_summary(date)
  to authenticated;
