-- BONSI V0.5, фаза 3: передача готового продукту, гарантія й підтримка, нові шаблони листів.
-- Адитивна міграція. Нічого не видаляє.

-- ---------------------------------------------------------------------------
-- Захист від збереження секретів у службових полях
-- ---------------------------------------------------------------------------
-- Шукає саме значення, схожі на облікові дані (пароль=..., токен=..., приватний ключ, JWT, ключі популярних сервісів), а не слова «пароль» у тексті.
create or replace function public.looks_like_secret(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p, '') ~* (
    '(password|passwd|pwd|пароль|парол[юяі])\s*[:=]\s*\S{3,}'
    || '|(api[_ -]?key|secret|token|токен|ключ)\s*[:=]\s*\S{8,}'
    || '|-----begin [a-z ]*private key'
    || '|\ysk_(live|test)_[a-z0-9]{10,}'
    || '|\yeyj[a-z0-9_-]{15,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{5,}'
    || '|\ygh[pousr]_[a-z0-9]{20,}'
    || '|\yxox[bp]-[a-z0-9-]{10,}'
    || '|\yAKIA[0-9A-Z]{16}\y'
  );
$$;

-- ---------------------------------------------------------------------------
-- Передача проєкту (Handover)
-- ---------------------------------------------------------------------------
alter table public.projects add column if not exists warranty_until date;

create table if not exists public.handover_records (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null unique references public.projects (id) on delete restrict,
  product_kind   text not null check (product_kind in ('website', 'mobile', 'other')),
  status         text not null default 'draft' check (status in ('draft', 'submitted', 'accepted', 'changes_requested')),
  production_url text check (production_url is null or production_url ~* '^https://[^\s<>"]+$'),
  domain         text check (domain is null or char_length(domain) <= 200),
  domain_owner   text check (domain_owner is null or char_length(domain_owner) <= 300),
  hosting        text check (hosting is null or char_length(hosting) <= 300),
  repository_url text check (repository_url is null or repository_url ~* '^https://[^\s<>"]+$'),
  docs_url       text check (docs_url is null or docs_url ~* '^https://[^\s<>"]+$'),
  manual_url     text check (manual_url is null or manual_url ~* '^https://[^\s<>"]+$'),
  backup_note    text check (backup_note is null or char_length(backup_note) <= 1000),
  app_version    text check (app_version is null or char_length(app_version) <= 60),
  store_state    text check (store_state is null or char_length(store_state) <= 300),
  backend_note   text check (backend_note is null or char_length(backend_note) <= 1000),
  rights_note    text check (rights_note is null or char_length(rights_note) <= 1000),
  artifacts      jsonb not null default '[]'::jsonb check (jsonb_typeof(artifacts) = 'array' and jsonb_array_length(artifacts) <= 20),
  created_by     uuid references public.admin_users (user_id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  accepted_at    timestamptz,
  check (not public.looks_like_secret(concat_ws(' ', domain, domain_owner, hosting, backup_note, app_version, store_state, backend_note, rights_note, artifacts::text, production_url, repository_url, docs_url, manual_url)))
);

create or replace function public.handover_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if tg_op = 'UPDATE' and old.status = 'accepted' then
    raise exception 'handover_locked' using errcode = 'P0001';
  end if;
  select coalesce(bool_and(
    jsonb_typeof(e) = 'object'
    and (e ->> 'kind') in ('apk', 'aab', 'testflight', 'release', 'other')
    and char_length(coalesce(e ->> 'label', '')) between 1 and 120
    and char_length(coalesce(e ->> 'url', '')) between 10 and 500
    and (e ->> 'url') ~* '^https://[^\s<>"]+$'
  ), true) into v_ok from jsonb_array_elements(new.artifacts) e;
  if not v_ok then
    raise exception 'invalid_artifacts' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists handover_guard on public.handover_records;
create trigger handover_guard before insert or update on public.handover_records
  for each row execute function public.handover_guard();

create table if not exists public.handover_decisions (
  id          bigint generated always as identity primary key,
  project_id  uuid not null references public.projects (id) on delete restrict,
  decision    text not null check (decision in ('approved', 'changes_requested')),
  comment     text check (comment is null or char_length(comment) <= 2000),
  snapshot    jsonb not null,
  decided_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
drop trigger if exists handover_decisions_append_only on public.handover_decisions;
create trigger handover_decisions_append_only before update or delete on public.handover_decisions
  for each row execute function public.forbid_mutation();

create or replace function public.admin_save_handover(p_project uuid, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.handover_records;
  f jsonb := coalesce(p_fields, '{}'::jsonb);
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.projects where id = p_project;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into v_existing from public.handover_records where project_id = p_project for update;
  if found and v_existing.status in ('submitted', 'accepted') then
    raise exception 'handover_locked' using errcode = 'P0001';
  end if;
  insert into public.handover_records (
    project_id, product_kind, production_url, domain, domain_owner, hosting, repository_url, docs_url, manual_url, backup_note,
    app_version, store_state, backend_note, rights_note, artifacts, created_by
  ) values (
    p_project, f ->> 'product_kind', nullif(f ->> 'production_url', ''), nullif(f ->> 'domain', ''), nullif(f ->> 'domain_owner', ''), nullif(f ->> 'hosting', ''),
    nullif(f ->> 'repository_url', ''), nullif(f ->> 'docs_url', ''), nullif(f ->> 'manual_url', ''), nullif(f ->> 'backup_note', ''),
    nullif(f ->> 'app_version', ''), nullif(f ->> 'store_state', ''), nullif(f ->> 'backend_note', ''), nullif(f ->> 'rights_note', ''),
    coalesce(f -> 'artifacts', '[]'::jsonb), (select user_id from public.admin_users where user_id = auth.uid())
  )
  on conflict (project_id) do update set
    product_kind = excluded.product_kind, production_url = excluded.production_url, domain = excluded.domain, domain_owner = excluded.domain_owner,
    hosting = excluded.hosting, repository_url = excluded.repository_url, docs_url = excluded.docs_url, manual_url = excluded.manual_url,
    backup_note = excluded.backup_note, app_version = excluded.app_version, store_state = excluded.store_state, backend_note = excluded.backend_note,
    rights_note = excluded.rights_note, artifacts = excluded.artifacts, status = 'draft', updated_at = now();
end;
$$;

create or replace function public.admin_submit_handover(p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.handover_records;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into h from public.handover_records where project_id = p_project for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if h.status not in ('draft', 'changes_requested') then
    raise exception 'handover_locked' using errcode = 'P0001';
  end if;
  if (h.product_kind = 'website' and (h.production_url is null or h.docs_url is null and h.manual_url is null))
     or (h.product_kind = 'mobile' and (h.app_version is null or jsonb_array_length(h.artifacts) = 0))
     or (h.product_kind = 'other' and h.backend_note is null and h.docs_url is null) then
    raise exception 'handover_incomplete' using errcode = 'P0001';
  end if;
  update public.handover_records set status = 'submitted', submitted_at = now(), updated_at = now() where project_id = p_project;
  update public.projects set next_action_owner = 'client', next_action = 'Перевірте передачу проєкту й підтвердіть приймання' where id = p_project;
  perform public.project_log(p_project, auth.uid(), 'admin', 'handover_submitted', jsonb_build_object('kind', h.product_kind));
end;
$$;

create or replace function public.client_decide_handover(p_project uuid, p_decision text, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.handover_records;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if p_decision not in ('approved', 'changes_requested') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if not public.is_project_client(p_project) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into h from public.handover_records where project_id = p_project for update;
  if not found or h.status <> 'submitted' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  if p_decision = 'changes_requested' and v_comment is null then
    raise exception 'comment_required' using errcode = '22023';
  end if;
  insert into public.handover_decisions (project_id, decision, comment, snapshot, decided_by)
  values (p_project, p_decision, left(v_comment, 2000), to_jsonb(h) - 'created_by', auth.uid());
  update public.handover_records
     set status = case p_decision when 'approved' then 'accepted' else 'changes_requested' end,
         accepted_at = case p_decision when 'approved' then now() end, updated_at = now()
   where project_id = p_project;
  update public.projects
     set next_action_owner = 'studio', next_action = case p_decision when 'approved' then 'Клієнт прийняв передачу проєкту' else 'Студія опрацьовує зауваження до передачі' end
   where id = p_project;
  perform public.project_log(p_project, auth.uid(), 'client', 'handover_' || p_decision, '{}'::jsonb);
end;
$$;

-- Завершення проєкту: лише після прийнятої передачі. Гарантійний строк визначає власник студії явно (за замовчуванням не встановлений).
create or replace function public.admin_complete_project(p_project uuid, p_warranty_until date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select status into v_status from public.handover_records where project_id = p_project;
  if v_status is distinct from 'accepted' then
    raise exception 'handover_not_accepted' using errcode = 'P0001';
  end if;
  perform 1 from public.projects where id = p_project and status = 'active' for update;
  if not found then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  update public.projects set status = 'completed', warranty_until = p_warranty_until, next_action_owner = null, next_action = null where id = p_project;
  perform public.admin_set_project_stage(p_project, 'support');
  perform public.project_log(p_project, auth.uid(), 'admin', 'project_completed', jsonb_build_object('warranty_until', p_warranty_until));
end;
$$;

-- ---------------------------------------------------------------------------
-- Підтримка
-- ---------------------------------------------------------------------------
create sequence if not exists public.support_ticket_seq;

create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique default ('SUP-' || to_char(now() at time zone 'utc', 'YYYY') || '-' || lpad(nextval('public.support_ticket_seq')::text, 5, '0')),
  project_id  uuid not null references public.projects (id) on delete restrict,
  client_id   uuid not null references auth.users (id) on delete restrict,
  category    text not null check (category in ('bug', 'warranty_fix', 'paid_work', 'tech_question', 'hosting', 'post_update', 'other')),
  priority    text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  subject     text not null check (char_length(subject) between 3 and 160),
  description text not null check (char_length(description) between 10 and 4000),
  status      text not null default 'new' check (status in ('new', 'in_progress', 'waiting_client', 'resolved', 'closed')),
  assignee_id uuid references public.admin_users (user_id) on delete set null,
  result      text check (result is null or char_length(result) <= 4000),
  change_request_id uuid references public.change_requests (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz,
  check (status not in ('resolved', 'closed') or result is not null)
);
create index if not exists support_tickets_project_idx on public.support_tickets (project_id, created_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets (status, priority);

create table if not exists public.support_messages (
  id         bigint generated always as identity primary key,
  ticket_id  uuid not null references public.support_tickets (id) on delete restrict,
  author_id  uuid references auth.users (id) on delete set null,
  author_role text not null check (author_role in ('client', 'admin')),
  body       text not null check (char_length(body) between 1 and 4000),
  internal   boolean not null default false,
  created_at timestamptz not null default now(),
  check (not internal or author_role = 'admin')
);
create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, id);

create table if not exists public.support_events (
  id         bigint generated always as identity primary key,
  ticket_id  uuid not null references public.support_tickets (id) on delete restrict,
  actor_id   uuid references auth.users (id) on delete set null,
  type       text not null check (type in ('created', 'status_changed', 'assigned', 'priority_changed', 'replied', 'converted_to_change', 'closed_by_client')),
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists support_events_ticket_idx on public.support_events (ticket_id, id);
drop trigger if exists support_events_append_only on public.support_events;
create trigger support_events_append_only before update or delete on public.support_events
  for each row execute function public.forbid_mutation();

alter table public.project_files add column if not exists ticket_id uuid references public.support_tickets (id) on delete restrict;
alter table public.change_requests add column if not exists ticket_id uuid references public.support_tickets (id) on delete set null;

create or replace function public.client_create_ticket(p_project uuid, p_category text, p_priority text, p_subject text, p_description text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.projects;
  v_id uuid;
begin
  select * into v_p from public.projects where id = p_project;
  if not found or not public.is_project_client(p_project) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_p.activated_at is null then
    raise exception 'project_not_active' using errcode = 'P0001';
  end if;
  insert into public.support_tickets (project_id, client_id, category, priority, subject, description)
  values (p_project, auth.uid(), p_category, coalesce(p_priority, 'normal'), btrim(coalesce(p_subject, '')), btrim(coalesce(p_description, '')))
  returning id into v_id;
  insert into public.support_events (ticket_id, actor_id, type, data) values (v_id, auth.uid(), 'created', jsonb_build_object('category', p_category));
  perform public.project_log(p_project, auth.uid(), 'client', 'support_created', jsonb_build_object('ticket', v_id), false);
  return v_id;
end;
$$;

create or replace function public.client_ticket_reply(p_ticket uuid, p_body text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.support_tickets;
  v_id bigint;
begin
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found or t.client_id <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if t.status = 'closed' then
    raise exception 'ticket_closed' using errcode = 'P0001';
  end if;
  insert into public.support_messages (ticket_id, author_id, author_role, body) values (p_ticket, auth.uid(), 'client', btrim(coalesce(p_body, ''))) returning id into v_id;
  update public.support_tickets
     set status = case when status in ('waiting_client', 'resolved') then 'in_progress' else status end,
         result = case when status = 'resolved' then null else result end, resolved_at = case when status = 'resolved' then null else resolved_at end, updated_at = now()
   where id = p_ticket;
  insert into public.support_events (ticket_id, actor_id, type, data) values (p_ticket, auth.uid(), 'replied', jsonb_build_object('role', 'client'));
  return v_id;
end;
$$;

create or replace function public.client_close_ticket(p_ticket uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found or t.client_id <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if t.status <> 'resolved' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  update public.support_tickets set status = 'closed', updated_at = now() where id = p_ticket;
  insert into public.support_events (ticket_id, actor_id, type, data) values (p_ticket, auth.uid(), 'closed_by_client', '{}'::jsonb);
end;
$$;

create or replace function public.attach_files_to_ticket(p_ticket uuid, p_files uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.support_tickets;
  v_count int;
begin
  select * into t from public.support_tickets where id = p_ticket;
  if not found or (t.client_id <> auth.uid() and not public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(array_length(p_files, 1), 0) > 5 then
    raise exception 'too_many_files' using errcode = '22023';
  end if;
  update public.project_files
     set ticket_id = p_ticket
   where id = any (p_files) and project_id = t.project_id and uploader_id = auth.uid() and ticket_id is null and message_id is null and deleted_at is null;
  get diagnostics v_count = row_count;
  if v_count <> coalesce(array_length(p_files, 1), 0) then
    raise exception 'invalid_files' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.admin_ticket_reply(p_ticket uuid, p_body text, p_internal boolean default false)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.support_tickets;
  v_id bigint;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.support_messages (ticket_id, author_id, author_role, body, internal)
  values (p_ticket, auth.uid(), 'admin', btrim(coalesce(p_body, '')), coalesce(p_internal, false)) returning id into v_id;
  if not coalesce(p_internal, false) and t.status = 'new' then
    update public.support_tickets set status = 'in_progress', updated_at = now() where id = p_ticket;
  end if;
  insert into public.support_events (ticket_id, actor_id, type, data) values (p_ticket, auth.uid(), 'replied', jsonb_build_object('role', 'admin', 'internal', coalesce(p_internal, false)));
  return v_id;
end;
$$;

create or replace function public.admin_update_ticket(p_ticket uuid, p_status text, p_assignee uuid, p_priority text, p_result text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.support_tickets;
  v_result text := nullif(btrim(coalesce(p_result, '')), '');
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('new', 'in_progress', 'waiting_client', 'resolved', 'closed') or p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_status in ('resolved', 'closed') and v_result is null and t.result is null then
    raise exception 'result_required' using errcode = '22023';
  end if;
  update public.support_tickets
     set status = p_status, assignee_id = p_assignee, priority = p_priority, result = coalesce(v_result, result),
         resolved_at = case when p_status in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end, updated_at = now()
   where id = p_ticket;
  if p_status is distinct from t.status then
    insert into public.support_events (ticket_id, actor_id, type, data) values (p_ticket, auth.uid(), 'status_changed', jsonb_build_object('from', t.status, 'to', p_status));
  end if;
  if p_assignee is distinct from t.assignee_id then
    insert into public.support_events (ticket_id, actor_id, type, data) values (p_ticket, auth.uid(), 'assigned', jsonb_build_object('from', t.assignee_id, 'to', p_assignee));
  end if;
  if p_priority is distinct from t.priority then
    insert into public.support_events (ticket_id, actor_id, type, data) values (p_ticket, auth.uid(), 'priority_changed', jsonb_build_object('from', t.priority, 'to', p_priority));
  end if;
end;
$$;

-- Платне доопрацювання з підтримки оформлюється як окремий запит на зміну (оцінка → додаткова угода → погодження).
create or replace function public.admin_ticket_to_change(p_ticket uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.support_tickets;
  v_cr uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if t.change_request_id is not null then
    raise exception 'already_converted' using errcode = 'P0001';
  end if;
  insert into public.change_requests (project_id, title, description, requested_by, ticket_id)
  values (t.project_id, left(t.subject, 160), t.description, t.client_id, p_ticket) returning id into v_cr;
  update public.support_tickets set change_request_id = v_cr, status = case when status = 'new' then 'in_progress' else status end, updated_at = now() where id = p_ticket;
  insert into public.support_events (ticket_id, actor_id, type, data) values (p_ticket, auth.uid(), 'converted_to_change', jsonb_build_object('change_request', v_cr));
  return v_cr;
end;
$$;

-- Гарантійний статус звернення на дату створення (інформація для студії; рішення про гарантійний випадок ухвалює адміністратор).
create or replace function public.ticket_warranty_state(p_ticket uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.warranty_until is null then 'not_set' when t.created_at::date <= p.warranty_until then 'in_warranty' else 'out_of_warranty' end
  from public.support_tickets t join public.projects p on p.id = t.project_id
  where t.id = p_ticket and public.is_admin();
$$;

-- ---------------------------------------------------------------------------
-- Нові шаблони листів BONSI Mail
-- ---------------------------------------------------------------------------
alter table public.email_outbox drop constraint if exists email_outbox_template_check;
alter table public.email_outbox add constraint email_outbox_template_check check (template in (
  'order_received', 'login_code', 'cabinet_invite', 'new_message', 'new_proposal',
  'proposal_decision', 'deliverable_decision', 'invoice_issued', 'payment_confirmed', 'project_completed',
  'document_for_approval', 'budget_change', 'stage_completed', 'handover_ready', 'support_update', 'order_rejected'
));

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.handover_records enable row level security;
alter table public.handover_decisions enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_events enable row level security;
revoke all on public.handover_records, public.handover_decisions, public.support_tickets, public.support_messages, public.support_events from anon, authenticated;
grant select on public.handover_records, public.handover_decisions, public.support_tickets, public.support_messages, public.support_events to authenticated;

drop policy if exists read_handover on public.handover_records;
create policy read_handover on public.handover_records
  for select to authenticated using ((status <> 'draft' and (select public.is_project_client(project_id))) or (select public.is_admin()));
drop policy if exists read_handover_decisions on public.handover_decisions;
create policy read_handover_decisions on public.handover_decisions
  for select to authenticated using ((select public.is_project_client(project_id)) or (select public.is_admin()));
drop policy if exists read_tickets on public.support_tickets;
create policy read_tickets on public.support_tickets
  for select to authenticated using (client_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists read_ticket_messages on public.support_messages;
create policy read_ticket_messages on public.support_messages
  for select to authenticated using (
    (select public.is_admin())
    or (not internal and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.client_id = (select auth.uid())))
  );
drop policy if exists admin_read_ticket_events on public.support_events;
create policy admin_read_ticket_events on public.support_events
  for select to authenticated using ((select public.is_admin()));

revoke all on function
  public.looks_like_secret(text),
  public.admin_save_handover(uuid, jsonb),
  public.admin_submit_handover(uuid),
  public.client_decide_handover(uuid, text, text),
  public.admin_complete_project(uuid, date),
  public.client_create_ticket(uuid, text, text, text, text),
  public.client_ticket_reply(uuid, text),
  public.client_close_ticket(uuid),
  public.attach_files_to_ticket(uuid, uuid[]),
  public.admin_ticket_reply(uuid, text, boolean),
  public.admin_update_ticket(uuid, text, uuid, text, text),
  public.admin_ticket_to_change(uuid),
  public.ticket_warranty_state(uuid)
  from public, anon, authenticated;
grant execute on function
  public.admin_save_handover(uuid, jsonb),
  public.admin_submit_handover(uuid),
  public.client_decide_handover(uuid, text, text),
  public.admin_complete_project(uuid, date),
  public.client_create_ticket(uuid, text, text, text, text),
  public.client_ticket_reply(uuid, text),
  public.client_close_ticket(uuid),
  public.attach_files_to_ticket(uuid, uuid[]),
  public.admin_ticket_reply(uuid, text, boolean),
  public.admin_update_ticket(uuid, text, uuid, text, text),
  public.admin_ticket_to_change(uuid),
  public.ticket_warranty_state(uuid)
  to authenticated;
