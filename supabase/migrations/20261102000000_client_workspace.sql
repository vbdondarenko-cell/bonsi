-- BONSI Studios V0.4: Client Workspace (клієнти, проєкти, чат, комерційні пропозиції).
-- Застосовується ЛИШЕ до окремого проєкту Supabase для BONSI. Міграція адитивна:
-- нічого не видаляє; наявні заявки лишаються чинними (бюджет, терміни й опис стають необов'язковими).
--
-- Модель доступу (ролі розділені на сервері та в RLS):
--  * адміністратор — рядок в `admin_users` + сесія aal2 (is_admin());
--  * клієнт — будь-який інший authenticated користувач; бачить ЛИШЕ рядки своїх проєктів
--    (projects.client_id = auth.uid()). Прямих записів з браузера немає: усе йде через security definer
--    функції, які самі перевіряють належність проєкту й пишуть історію;
--  * внутрішні нотатки адміністраторів лежать в окремій таблиці без клієнтських політик;
--  * журнал погоджень (proposal_decisions) append-only: UPDATE/DELETE заборонені тригером.
-- Статуси заявки (orders.status), проєкту (projects.status), пропозиції/погодження (proposals.status)
-- і платежу (етап 2) — незалежні поля.

-- ---------------------------------------------------------------------------
-- 1. Заявки: бюджет, терміни й опис необов'язкові; уточнення за послугою; посилання; прив'язка до клієнта
-- ---------------------------------------------------------------------------
alter table public.orders alter column idea drop not null;
alter table public.orders alter column budget drop not null;
alter table public.orders alter column deadline drop not null;

alter table public.orders drop constraint if exists orders_idea_check;
alter table public.orders add constraint orders_idea_check
  check (idea is null or char_length(idea) <= 3000);
alter table public.orders drop constraint if exists orders_budget_check;
alter table public.orders add constraint orders_budget_check
  check (budget is null or budget in ('lt-50k', '50-150k', '150-400k', 'gt-400k', 'discuss'));
alter table public.orders drop constraint if exists orders_deadline_check;
alter table public.orders add constraint orders_deadline_check
  check (deadline is null or deadline in ('asap', '1-month', '1-3-months', 'flexible'));

alter table public.orders
  add column if not exists details   jsonb not null default '{}'::jsonb,
  add column if not exists links     text[] not null default '{}',
  add column if not exists client_id uuid references auth.users (id) on delete set null;

alter table public.orders drop constraint if exists orders_links_check;
alter table public.orders add constraint orders_links_check check (cardinality(links) <= 5);
alter table public.orders drop constraint if exists orders_details_check;
alter table public.orders add constraint orders_details_check
  check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 8000);

create index if not exists orders_client_idx on public.orders (client_id);
create index if not exists orders_email_idx on public.orders (email);

-- Адміністратор бачить нові поля (ip_hash та user_agent, як і раніше, недоступні).
grant select (details, links, client_id) on public.orders to authenticated;

-- Нова версія приймання заявки: той самий атомарний ліміт, але з необов'язковими полями й уточненнями.
create or replace function public.create_order_v2(
  p_service                text,
  p_idea                   text,
  p_budget                 text,
  p_deadline               text,
  p_name                   text,
  p_email                  text,
  p_phone                  text,
  p_details                jsonb,
  p_links                  text[],
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
    service, idea, budget, deadline, name, email, phone, details, links,
    ip_hash, user_agent, consent_at, consent_policy_version
  ) values (
    p_service, nullif(btrim(p_idea), ''), nullif(p_budget, ''), nullif(p_deadline, ''), p_name, v_email,
    nullif(p_phone, ''), coalesce(p_details, '{}'::jsonb), coalesce(p_links, '{}'),
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

revoke all on function public.create_order_v2(text, text, text, text, text, text, text, jsonb, text[], text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.create_order_v2(text, text, text, text, text, text, text, jsonb, text[], text, text, text, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Профіль клієнта і проєкти
-- ---------------------------------------------------------------------------
create table if not exists public.client_profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  phone        text check (phone is null or char_length(phone) <= 30),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.projects (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid unique references public.orders (id) on delete set null,
  client_id        uuid not null references auth.users (id) on delete restrict,
  title            text not null check (char_length(title) between 1 and 160),
  service          text not null,
  -- Незалежні статуси: життєвий цикл проєкту ≠ статус заявки ≠ статус пропозиції ≠ платежу.
  status           text not null default 'active' check (status in ('active', 'on_hold', 'completed', 'cancelled')),
  stage            text not null default 'brief' check (stage in (
    'brief', 'proposal', 'agreement', 'design', 'development', 'qa', 'delivery', 'support'
  )),
  assignee_id      uuid references public.admin_users (user_id) on delete set null,
  -- Наступна дія, видима клієнту: хто має діяти й що саме.
  next_action_owner text check (next_action_owner in ('client', 'studio')),
  next_action      text check (next_action is null or char_length(next_action) <= 300),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists projects_client_idx on public.projects (client_id, created_at desc);
create index if not exists projects_assignee_idx on public.projects (assignee_id);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
drop trigger if exists client_profiles_set_updated_at on public.client_profiles;
create trigger client_profiles_set_updated_at before update on public.client_profiles
  for each row execute function public.set_updated_at();

-- Етапи проєкту: прогрес = реально завершені етапи, а не вигадані відсотки.
create table if not exists public.project_stages (
  project_id   uuid not null references public.projects (id) on delete cascade,
  stage        text not null check (stage in (
    'brief', 'proposal', 'agreement', 'design', 'development', 'qa', 'delivery', 'support'
  )),
  position     int not null,
  state        text not null default 'pending' check (state in ('pending', 'in_progress', 'done')),
  completed_at timestamptz,
  primary key (project_id, stage)
);

-- Історія подій проєкту. client_visible = false — службові записи, які клієнт не бачить.
create table if not exists public.project_events (
  id             bigint generated always as identity primary key,
  project_id     uuid not null references public.projects (id) on delete cascade,
  actor_id       uuid references auth.users (id) on delete set null,
  actor_role     text not null check (actor_role in ('client', 'admin', 'system')),
  type           text not null check (char_length(type) between 1 and 60),
  data           jsonb not null default '{}'::jsonb,
  client_visible boolean not null default true,
  created_at     timestamptz not null default now()
);
create index if not exists project_events_project_idx on public.project_events (project_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- 3. Чат проєкту; внутрішні нотатки — в окремій таблиці лише для адміністраторів
-- ---------------------------------------------------------------------------
create table if not exists public.project_messages (
  id          bigint generated always as identity primary key,
  project_id  uuid not null references public.projects (id) on delete cascade,
  author_id   uuid references auth.users (id) on delete set null,
  author_role text not null check (author_role in ('client', 'admin')),
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists project_messages_project_idx on public.project_messages (project_id, id);

create table if not exists public.project_message_reads (
  project_id   uuid not null references public.projects (id) on delete cascade,
  reader_role  text not null check (reader_role in ('client', 'admin')),
  last_read_id bigint not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (project_id, reader_role)
);

create table if not exists public.project_internal_notes (
  id         bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  author_id  uuid references public.admin_users (user_id) on delete set null,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists project_internal_notes_idx on public.project_internal_notes (project_id, id);

-- ---------------------------------------------------------------------------
-- 4. Комерційні пропозиції (версіоновані) і журнал погоджень
-- ---------------------------------------------------------------------------
create table if not exists public.proposals (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  version            int not null,
  status             text not null default 'draft' check (status in (
    'draft', 'sent', 'approved', 'changes_requested', 'superseded'
  )),
  title              text not null check (char_length(title) between 1 and 160),
  summary            text not null default '' check (char_length(summary) <= 4000),
  features           jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),
  price_amount       numeric(12, 2) check (price_amount is null or price_amount >= 0),
  currency           text not null default 'UAH' check (currency in ('UAH', 'USD', 'EUR')),
  duration_days      int check (duration_days is null or duration_days between 1 and 1000),
  -- [{ "label": "Аванс", "percent": 30, "milestone": "agreement" }, ...]; сума відсотків = 100 перевіряється при відправці
  payment_schedule   jsonb not null default '[]'::jsonb check (jsonb_typeof(payment_schedule) = 'array'),
  included_revisions int not null default 2 check (included_revisions between 0 and 50),
  acceptance_terms   text not null default '' check (char_length(acceptance_terms) <= 4000),
  created_by         uuid references public.admin_users (user_id) on delete set null,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz,
  decided_at         timestamptz,
  unique (project_id, version)
);
create index if not exists proposals_project_idx on public.proposals (project_id, version desc);

create table if not exists public.proposal_decisions (
  id               bigint generated always as identity primary key,
  proposal_id      uuid not null references public.proposals (id) on delete restrict,
  project_id       uuid not null references public.projects (id) on delete restrict,
  proposal_version int not null,
  decision         text not null check (decision in ('approved', 'changes_requested')),
  comment          text check (comment is null or char_length(comment) <= 2000),
  actor_id         uuid references auth.users (id) on delete set null,
  -- Хеш змісту пропозиції в момент рішення: доказ того, що саме було погоджено.
  content_hash     text not null,
  created_at       timestamptz not null default now()
);
create index if not exists proposal_decisions_project_idx on public.proposal_decisions (project_id, id);

create or replace function public.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'append_only' using errcode = '42501';
end;
$$;

drop trigger if exists proposal_decisions_append_only on public.proposal_decisions;
create trigger proposal_decisions_append_only
  before update or delete on public.proposal_decisions
  for each row execute function public.forbid_mutation();

drop trigger if exists project_messages_append_only on public.project_messages;
create trigger project_messages_append_only
  before update on public.project_messages
  for each row execute function public.forbid_mutation();

-- Зміст надісланої пропозиції незмінний: правки роблять новою версією.
create or replace function public.proposal_freeze()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
    new.title, new.summary, new.features, new.price_amount, new.currency, new.duration_days,
    new.payment_schedule, new.included_revisions, new.acceptance_terms, new.version, new.project_id
  ) is distinct from (
    old.title, old.summary, old.features, old.price_amount, old.currency, old.duration_days,
    old.payment_schedule, old.included_revisions, old.acceptance_terms, old.version, old.project_id
  ) then
    raise exception 'proposal_frozen' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists proposals_freeze on public.proposals;
create trigger proposals_freeze before update on public.proposals
  for each row execute function public.proposal_freeze();

-- ---------------------------------------------------------------------------
-- 5. Перевірки доступу
-- ---------------------------------------------------------------------------
create or replace function public.is_project_client(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects where id = p_project and client_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS: клієнт читає лише своє; адміністратор (aal2) читає все; записів напряму немає
-- ---------------------------------------------------------------------------
alter table public.client_profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_stages enable row level security;
alter table public.project_events enable row level security;
alter table public.project_messages enable row level security;
alter table public.project_message_reads enable row level security;
alter table public.project_internal_notes enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_decisions enable row level security;

revoke all on public.client_profiles, public.projects, public.project_stages, public.project_events,
  public.project_messages, public.project_message_reads, public.project_internal_notes,
  public.proposals, public.proposal_decisions from anon, authenticated;
grant select on public.client_profiles, public.projects, public.project_stages, public.project_events,
  public.project_messages, public.project_message_reads, public.project_internal_notes,
  public.proposals, public.proposal_decisions to authenticated;

drop policy if exists client_read_profile on public.client_profiles;
create policy client_read_profile on public.client_profiles
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists client_read_projects on public.projects;
create policy client_read_projects on public.projects
  for select to authenticated using (client_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists client_read_stages on public.project_stages;
create policy client_read_stages on public.project_stages
  for select to authenticated using ((select public.is_project_client(project_id)) or (select public.is_admin()));

drop policy if exists client_read_events on public.project_events;
create policy client_read_events on public.project_events
  for select to authenticated using (
    (client_visible and (select public.is_project_client(project_id))) or (select public.is_admin())
  );

drop policy if exists client_read_messages on public.project_messages;
create policy client_read_messages on public.project_messages
  for select to authenticated using ((select public.is_project_client(project_id)) or (select public.is_admin()));

drop policy if exists client_read_reads on public.project_message_reads;
create policy client_read_reads on public.project_message_reads
  for select to authenticated using ((select public.is_project_client(project_id)) or (select public.is_admin()));

-- Внутрішні нотатки: лише адміністратор. Жодної клієнтської політики.
drop policy if exists admin_read_internal_notes on public.project_internal_notes;
create policy admin_read_internal_notes on public.project_internal_notes
  for select to authenticated using ((select public.is_admin()));

drop policy if exists client_read_proposals on public.proposals;
create policy client_read_proposals on public.proposals
  for select to authenticated using (
    (status <> 'draft' and (select public.is_project_client(project_id))) or (select public.is_admin())
  );

drop policy if exists client_read_decisions on public.proposal_decisions;
create policy client_read_decisions on public.proposal_decisions
  for select to authenticated using ((select public.is_project_client(project_id)) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 7. Операції клієнта (єдиний шлях запису; належність перевіряється всередині)
-- ---------------------------------------------------------------------------
create or replace function public.project_log(
  p_project uuid, p_actor uuid, p_role text, p_type text, p_data jsonb, p_visible boolean default true
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.project_events (project_id, actor_id, actor_role, type, data, client_visible)
  values (p_project, p_actor, p_role, p_type, coalesce(p_data, '{}'::jsonb), p_visible);
$$;

create or replace function public.create_project_stages(p_project uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.project_stages (project_id, stage, position, state)
  select p_project, s.stage, s.position, case when s.position = 1 then 'in_progress' else 'pending' end
  from (values
    ('brief', 1), ('proposal', 2), ('agreement', 3), ('design', 4),
    ('development', 5), ('qa', 6), ('delivery', 7), ('support', 8)
  ) as s(stage, position)
  on conflict do nothing;
$$;

-- Після входу за підтвердженою поштою прив'язує до користувача всі заявки з цією адресою й створює проєкти.
-- Ідемпотентна. Не довіряє email із клієнта: адреса береться з auth.users і має бути підтверджена.
create or replace function public.client_claim_orders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_claimed int := 0;
  v_order   record;
  v_project uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if public.admin_is_allowlisted() then
    return 0; -- адміністратори не є клієнтами
  end if;

  select lower(email) into v_email from auth.users where id = v_uid and email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;

  insert into public.client_profiles (user_id) values (v_uid) on conflict do nothing;

  for v_order in
    select id, ticket_number, service, name from public.orders
    where email = v_email and client_id is null
    for update
  loop
    update public.orders set client_id = v_uid where id = v_order.id;
    insert into public.projects (order_id, client_id, title, service, next_action_owner, next_action)
    values (v_order.id, v_uid, v_order.ticket_number, v_order.service, 'studio', 'Студія опрацьовує вашу заявку')
    returning id into v_project;
    perform public.create_project_stages(v_project);
    perform public.project_log(v_project, v_uid, 'system', 'project_created', jsonb_build_object('ticket', v_order.ticket_number));
    if (select display_name from public.client_profiles where user_id = v_uid) = '' then
      update public.client_profiles set display_name = left(v_order.name, 100) where user_id = v_uid;
    end if;
    v_claimed := v_claimed + 1;
  end loop;
  return v_claimed;
end;
$$;

create or replace function public.client_update_profile(p_name text, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  insert into public.client_profiles (user_id, display_name, phone)
  values (auth.uid(), left(btrim(coalesce(p_name, '')), 100), nullif(left(btrim(coalesce(p_phone, '')), 30), ''))
  on conflict (user_id) do update
    set display_name = excluded.display_name, phone = excluded.phone;
end;
$$;

create or replace function public.client_send_message(p_project uuid, p_body text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_project_client(p_project) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  insert into public.project_messages (project_id, author_id, author_role, body)
  values (p_project, auth.uid(), 'client', v_body)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.client_mark_read(p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_project_client(p_project) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.project_message_reads (project_id, reader_role, last_read_id)
  select p_project, 'client', coalesce(max(id), 0) from public.project_messages where project_id = p_project
  on conflict (project_id, reader_role)
  do update set last_read_id = greatest(public.project_message_reads.last_read_id, excluded.last_read_id), updated_at = now();
end;
$$;

-- Рішення клієнта щодо пропозиції: лише для надісланої версії свого проєкту; фіксується в журналі разом із хешем змісту.
create or replace function public.proposal_content_hash(p public.proposals)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'v', p.version, 'title', p.title, 'summary', p.summary, 'features', p.features,
    'price', p.price_amount, 'currency', p.currency, 'days', p.duration_days,
    'schedule', p.payment_schedule, 'revisions', p.included_revisions, 'terms', p.acceptance_terms
  )::text, 'UTF8')), 'hex');
$$;

create or replace function public.client_decide_proposal(p_proposal uuid, p_decision text, p_comment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop public.proposals;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if p_decision not in ('approved', 'changes_requested') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  select * into v_prop from public.proposals where id = p_proposal for update;
  if not found or not public.is_project_client(v_prop.project_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_prop.status <> 'sent' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  if p_decision = 'changes_requested' and v_comment is null then
    raise exception 'comment_required' using errcode = '22023';
  end if;
  if v_comment is not null and char_length(v_comment) > 2000 then
    raise exception 'invalid_comment' using errcode = '22023';
  end if;

  update public.proposals set status = p_decision, decided_at = now() where id = p_proposal;
  insert into public.proposal_decisions (proposal_id, project_id, proposal_version, decision, comment, actor_id, content_hash)
  values (v_prop.id, v_prop.project_id, v_prop.version, p_decision, v_comment, auth.uid(), public.proposal_content_hash(v_prop));

  if p_decision = 'approved' then
    update public.projects
       set next_action_owner = 'studio', next_action = 'Студія готує договір і графік оплати'
     where id = v_prop.project_id;
  else
    update public.projects
       set next_action_owner = 'studio', next_action = 'Студія опрацьовує ваші зауваження до пропозиції'
     where id = v_prop.project_id;
  end if;
  perform public.project_log(v_prop.project_id, auth.uid(), 'client',
    case when p_decision = 'approved' then 'proposal_approved' else 'proposal_changes_requested' end,
    jsonb_build_object('version', v_prop.version));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Операції адміністратора
-- ---------------------------------------------------------------------------
create or replace function public.admin_send_message(p_project uuid, p_body text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  insert into public.project_messages (project_id, author_id, author_role, body)
  values (p_project, auth.uid(), 'admin', v_body)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_mark_read(p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.project_message_reads (project_id, reader_role, last_read_id)
  select p_project, 'admin', coalesce(max(id), 0) from public.project_messages where project_id = p_project
  on conflict (project_id, reader_role)
  do update set last_read_id = greatest(public.project_message_reads.last_read_id, excluded.last_read_id), updated_at = now();
end;
$$;

create or replace function public.admin_add_internal_note(p_project uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;
  insert into public.project_internal_notes (project_id, author_id, body) values (p_project, auth.uid(), v_body);
  perform public.project_log(p_project, auth.uid(), 'admin', 'internal_note_added', '{}'::jsonb, false);
end;
$$;

create or replace function public.admin_update_project(
  p_project uuid, p_status text, p_assignee uuid, p_next_owner text, p_next_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.projects;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('active', 'on_hold', 'completed', 'cancelled')
     or (p_next_owner is not null and p_next_owner not in ('client', 'studio')) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into v_old from public.projects where id = p_project for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.projects
     set status = p_status, assignee_id = p_assignee,
         next_action_owner = p_next_owner, next_action = nullif(left(btrim(coalesce(p_next_action, '')), 300), '')
   where id = p_project;
  if v_old.status is distinct from p_status then
    perform public.project_log(p_project, auth.uid(), 'admin', 'status_changed',
      jsonb_build_object('from', v_old.status, 'to', p_status));
  end if;
  if v_old.assignee_id is distinct from p_assignee then
    perform public.project_log(p_project, auth.uid(), 'admin', 'assigned', jsonb_build_object('to', p_assignee), false);
  end if;
end;
$$;

-- Перехід на етап: усі попередні етапи стають завершеними, обраний — поточним. Прогрес = кількість done.
create or replace function public.admin_set_project_stage(p_project uuid, p_stage text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pos int;
  v_old text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select stage into v_old from public.projects where id = p_project for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select position into v_pos from public.project_stages where project_id = p_project and stage = p_stage;
  if v_pos is null then
    raise exception 'invalid_stage' using errcode = '22023';
  end if;
  update public.project_stages
     set state = case when position < v_pos then 'done' when position = v_pos then 'in_progress' else 'pending' end,
         completed_at = case when position < v_pos then coalesce(completed_at, now()) else null end
   where project_id = p_project;
  update public.projects set stage = p_stage where id = p_project;
  if v_old <> p_stage then
    perform public.project_log(p_project, auth.uid(), 'admin', 'stage_changed', jsonb_build_object('from', v_old, 'to', p_stage));
  end if;
end;
$$;

-- Чернетка пропозиції: нова версія = max+1; можна стартувати з копії попередньої.
create or replace function public.admin_create_proposal(p_project uuid, p_copy_from uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_version int;
  v_src public.proposals;
  v_title text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.projects where id = p_project for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.proposals where project_id = p_project and status = 'draft') then
    raise exception 'draft_exists' using errcode = 'P0001';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.proposals where project_id = p_project;
  if p_copy_from is not null then
    select * into v_src from public.proposals where id = p_copy_from and project_id = p_project;
  end if;
  select title into v_title from public.projects where id = p_project;
  insert into public.proposals (
    project_id, version, title, summary, features, price_amount, currency, duration_days,
    payment_schedule, included_revisions, acceptance_terms, created_by
  ) values (
    p_project, v_version, coalesce(v_src.title, v_title), coalesce(v_src.summary, ''), coalesce(v_src.features, '[]'::jsonb),
    v_src.price_amount, coalesce(v_src.currency, 'UAH'), v_src.duration_days,
    coalesce(v_src.payment_schedule, '[]'::jsonb), coalesce(v_src.included_revisions, 2),
    coalesce(v_src.acceptance_terms, ''), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_update_proposal(
  p_proposal uuid, p_title text, p_summary text, p_features jsonb, p_price numeric, p_currency text,
  p_duration_days int, p_schedule jsonb, p_revisions int, p_terms text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.proposals
     set title = btrim(p_title), summary = coalesce(p_summary, ''), features = coalesce(p_features, '[]'::jsonb),
         price_amount = p_price, currency = p_currency, duration_days = p_duration_days,
         payment_schedule = coalesce(p_schedule, '[]'::jsonb), included_revisions = p_revisions,
         acceptance_terms = coalesce(p_terms, '')
   where id = p_proposal and status = 'draft';
  if not found then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;
end;
$$;

-- Відправка клієнту: повна перевірка (ціна, терміни, графік платежів = 100%), попередня надіслана версія -> superseded.
create or replace function public.admin_send_proposal(p_proposal uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop public.proposals;
  v_total numeric;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_prop from public.proposals where id = p_proposal for update;
  if not found or v_prop.status <> 'draft' then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;
  if v_prop.price_amount is null or v_prop.duration_days is null or jsonb_array_length(v_prop.features) = 0 then
    raise exception 'incomplete' using errcode = '22023';
  end if;
  select coalesce(sum((e ->> 'percent')::numeric), 0) into v_total from jsonb_array_elements(v_prop.payment_schedule) e;
  if jsonb_array_length(v_prop.payment_schedule) = 0 or v_total <> 100 then
    raise exception 'schedule_must_total_100' using errcode = '22023';
  end if;

  update public.proposals set status = 'superseded'
   where project_id = v_prop.project_id and status in ('sent', 'changes_requested') and id <> p_proposal;
  update public.proposals set status = 'sent', sent_at = now() where id = p_proposal;
  update public.projects
     set stage = case when stage = 'brief' then 'proposal' else stage end,
         next_action_owner = 'client', next_action = 'Перегляньте комерційну пропозицію та погодьте її або попросіть змін'
   where id = v_prop.project_id;
  update public.project_stages set state = 'done', completed_at = coalesce(completed_at, now())
   where project_id = v_prop.project_id and stage = 'brief';
  update public.project_stages set state = 'in_progress'
   where project_id = v_prop.project_id and stage = 'proposal' and state = 'pending';
  perform public.project_log(v_prop.project_id, auth.uid(), 'admin', 'proposal_sent', jsonb_build_object('version', v_prop.version));
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Права на виконання: лише authenticated; перевірки ролей — всередині функцій
-- ---------------------------------------------------------------------------
revoke all on function
  public.project_log(uuid, uuid, text, text, jsonb, boolean),
  public.create_project_stages(uuid),
  public.proposal_content_hash(public.proposals),
  public.is_project_client(uuid),
  public.client_claim_orders(),
  public.client_update_profile(text, text),
  public.client_send_message(uuid, text),
  public.client_mark_read(uuid),
  public.client_decide_proposal(uuid, text, text),
  public.admin_send_message(uuid, text),
  public.admin_mark_read(uuid),
  public.admin_add_internal_note(uuid, text),
  public.admin_update_project(uuid, text, uuid, text, text),
  public.admin_set_project_stage(uuid, text),
  public.admin_create_proposal(uuid, uuid),
  public.admin_update_proposal(uuid, text, text, jsonb, numeric, text, int, jsonb, int, text),
  public.admin_send_proposal(uuid)
  from public, anon, authenticated;

-- Внутрішні помічники не викликаються з браузера; політики RLS викликають is_project_client від імені власника функції.
grant execute on function public.is_project_client(uuid) to authenticated;
grant execute on function
  public.client_claim_orders(),
  public.client_update_profile(text, text),
  public.client_send_message(uuid, text),
  public.client_mark_read(uuid),
  public.client_decide_proposal(uuid, text, text),
  public.admin_send_message(uuid, text),
  public.admin_mark_read(uuid),
  public.admin_add_internal_note(uuid, text),
  public.admin_update_project(uuid, text, uuid, text, text),
  public.admin_set_project_stage(uuid, text),
  public.admin_create_proposal(uuid, uuid),
  public.admin_update_proposal(uuid, text, text, jsonb, numeric, text, int, jsonb, int, text),
  public.admin_send_proposal(uuid)
  to authenticated;
