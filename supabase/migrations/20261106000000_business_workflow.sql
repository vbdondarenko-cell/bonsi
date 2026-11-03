-- BONSI V0.5, фаза 1: бізнес-процес від заявки до активного проєкту.
-- Адитивна міграція: нічого не видаляє. Існуючі проєкти зберігають чинність (activated_at = created_at, один раз).
--  1. Незалежна активація проєкту: заявка/робочий простір ≠ активний контрактний проєкт.
--  2. Відхилення заявки з причиною; «Мої заявки» для клієнта.
--  3. Документи (ТЗ, договір, додаткова угода, акти, умови гарантії): версії, хеш, погодження, журнал рішень.
--  4. Запити на зміни (Change Requests) і незмінний Scope of Work (базова лінія + погоджені доповнення).

-- ---------------------------------------------------------------------------
-- 1. Активація проєкту
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'activated_at') then
    alter table public.projects add column activated_at timestamptz;
    alter table public.projects add column activated_by uuid references public.admin_users (user_id) on delete set null;
    alter table public.projects add column activation_note text check (activation_note is null or char_length(activation_note) <= 500);
    -- Зворотна сумісність: усі проєкти, що існували до цієї міграції, лишаються активними.
    -- Заповнення не повинно змінювати «останнє оновлення» існуючих проєктів: на час оновлення вимикаємо тригер updated_at
    -- (у межах цієї ж транзакції; після оновлення вмикаємо назад).
    alter table public.projects disable trigger projects_set_updated_at;
    update public.projects set activated_at = created_at;
    alter table public.projects enable trigger projects_set_updated_at;
  end if;
end $$;

alter table public.invoices add column if not exists purpose text not null default 'regular' check (purpose in ('regular', 'prepayment', 'change'));
alter table public.invoices add column if not exists change_request_id uuid;

-- Етапи роботи (дизайн і далі) не починаються, доки проєкт не активовано. Перший етап «бриф»–«договір» — підготовка.
create or replace function public.projects_stage_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage is distinct from old.stage
     and new.stage in ('design', 'development', 'qa', 'delivery', 'support')
     and new.activated_at is null then
    raise exception 'not_activated' using errcode = 'P0001';
  end if;
  if old.activated_at is not null and new.activated_at is distinct from old.activated_at then
    raise exception 'activation_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists projects_stage_guard on public.projects;
create trigger projects_stage_guard before update on public.projects
  for each row execute function public.projects_stage_guard();

-- ---------------------------------------------------------------------------
-- 2. Відхилення заявки
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 1000);
alter table public.order_events drop constraint if exists order_events_type_check;
alter table public.order_events add constraint order_events_type_check
  check (type in ('created', 'status_changed', 'assigned', 'note_added', 'rejected'));

create or replace function public.admin_reject_order(p_order uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_project uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_reason) < 10 or char_length(v_reason) > 1000 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select status into v_old from public.orders where id = p_order for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.orders set status = 'rejected', rejection_reason = v_reason where id = p_order;
  insert into public.order_events (order_id, actor_id, type, data)
  values (p_order, auth.uid(), 'rejected', jsonb_build_object('from', v_old, 'reason', v_reason));
  select id into v_project from public.projects where order_id = p_order;
  if v_project is not null then
    update public.projects set status = 'cancelled', next_action_owner = null, next_action = null where id = v_project and activated_at is null;
    perform public.project_log(v_project, auth.uid(), 'admin', 'order_rejected', jsonb_build_object('reason', v_reason));
  end if;
end;
$$;

-- «Мої заявки»: лише безпечні поля власних заявок (таблиця orders клієнту напряму недоступна).
create or replace function public.client_requests()
returns table (
  order_id uuid, ticket text, service text, order_status text, rejection_reason text, created_at timestamptz,
  project_id uuid, activated boolean, project_status text, stage text, next_action_owner text, next_action text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.ticket_number, o.service, o.status, o.rejection_reason, o.created_at,
         p.id, p.activated_at is not null, p.status, p.stage, p.next_action_owner, p.next_action
  from public.orders o
  left join public.projects p on p.order_id = o.id
  where o.client_id = (select auth.uid())
  order by o.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- 3. Запити на зміни (спершу таблиця без зв'язку з документом, бо документи посилаються на неї)
-- ---------------------------------------------------------------------------
create table if not exists public.change_requests (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete restrict,
  number          text not null unique default ('CR-' || to_char(now() at time zone 'utc', 'YYYY') || '-' || lpad(floor(random() * 1000000)::text, 6, '0')),
  title           text not null check (char_length(title) between 3 and 160),
  description     text not null check (char_length(description) between 10 and 4000),
  status          text not null default 'submitted' check (status in (
    'submitted', 'quoted', 'approved', 'rejected', 'withdrawn', 'in_progress', 'done'
  )),
  requested_by    uuid references auth.users (id) on delete set null,
  quote_summary   text check (quote_summary is null or char_length(quote_summary) <= 4000),
  quote_price     numeric(12, 2) check (quote_price is null or quote_price >= 0),
  quote_currency  text check (quote_currency is null or quote_currency in ('UAH', 'USD', 'EUR')),
  quote_days      int check (quote_days is null or quote_days between 0 and 1000),
  quote_document_id uuid,
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 1000),
  created_at      timestamptz not null default now(),
  quoted_at       timestamptz,
  decided_at      timestamptz,
  updated_at      timestamptz not null default now()
);
create index if not exists change_requests_project_idx on public.change_requests (project_id, created_at desc);
alter table public.invoices drop constraint if exists invoices_change_request_fk;
alter table public.invoices add constraint invoices_change_request_fk foreign key (change_request_id) references public.change_requests (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 4. Документи
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete restrict,
  kind              text not null check (kind in (
    'tech_spec', 'contract', 'amendment', 'stage_act', 'handover_act', 'access_handover', 'warranty_terms', 'other'
  )),
  title             text not null check (char_length(title) between 1 and 160),
  status            text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'changes_requested', 'void')),
  current_version   int not null default 1,
  change_request_id uuid references public.change_requests (id) on delete restrict,
  created_by        uuid references public.admin_users (user_id) on delete set null,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  decided_at        timestamptz,
  updated_at        timestamptz not null default now()
);
create index if not exists documents_project_idx on public.documents (project_id, created_at desc);
create index if not exists documents_change_request_idx on public.documents (change_request_id) where change_request_id is not null;
alter table public.change_requests drop constraint if exists change_requests_quote_document_fk;
alter table public.change_requests add constraint change_requests_quote_document_fk foreign key (quote_document_id) references public.documents (id) on delete restrict;

create table if not exists public.document_versions (
  id           bigint generated always as identity primary key,
  document_id  uuid not null references public.documents (id) on delete restrict,
  version      int not null,
  body         text not null check (char_length(body) between 1 and 60000),
  content_hash text not null default '',
  frozen_at    timestamptz,
  created_by   uuid references public.admin_users (user_id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (document_id, version)
);

-- Хеш рахує база, а не клієнт; після фіксації (відправки клієнту) версію не можна змінити взагалі.
create or replace function public.document_version_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.frozen_at is not null then
      raise exception 'document_frozen' using errcode = 'P0001';
    end if;
    if new.document_id is distinct from old.document_id or new.version is distinct from old.version or new.created_at is distinct from old.created_at then
      raise exception 'append_only' using errcode = '42501';
    end if;
  end if;
  new.content_hash := encode(sha256(convert_to(new.body, 'UTF8')), 'hex');
  return new;
end;
$$;
drop trigger if exists document_version_guard on public.document_versions;
create trigger document_version_guard before insert or update on public.document_versions
  for each row execute function public.document_version_guard();

create table if not exists public.document_decisions (
  id           bigint generated always as identity primary key,
  document_id  uuid not null references public.documents (id) on delete restrict,
  version      int not null,
  content_hash text not null,
  decision     text not null check (decision in ('approved', 'changes_requested', 'rejected')),
  comment      text check (comment is null or char_length(comment) <= 2000),
  decided_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists document_decisions_doc_idx on public.document_decisions (document_id, id);
drop trigger if exists document_decisions_append_only on public.document_decisions;
create trigger document_decisions_append_only before update or delete on public.document_decisions
  for each row execute function public.forbid_mutation();

-- Scope of Work: базова лінія (знімок погодженої пропозиції при активації) + погоджені доповнення. Лише додається.
create table if not exists public.project_scope (
  id                 bigint generated always as identity primary key,
  project_id         uuid not null references public.projects (id) on delete restrict,
  kind               text not null check (kind in ('baseline', 'amendment')),
  title              text not null check (char_length(title) between 1 and 200),
  items              jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  price_amount       numeric(12, 2),
  currency           text check (currency is null or currency in ('UAH', 'USD', 'EUR')),
  duration_days      int,
  source_proposal_id uuid references public.proposals (id) on delete restrict,
  change_request_id  uuid references public.change_requests (id) on delete restrict,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now()
);
create unique index if not exists project_scope_one_baseline on public.project_scope (project_id) where kind = 'baseline';
create unique index if not exists project_scope_one_per_change on public.project_scope (change_request_id) where change_request_id is not null;
drop trigger if exists project_scope_append_only on public.project_scope;
create trigger project_scope_append_only before update or delete on public.project_scope
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.change_requests enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_decisions enable row level security;
alter table public.project_scope enable row level security;
revoke all on public.change_requests, public.documents, public.document_versions, public.document_decisions, public.project_scope from anon, authenticated;
grant select on public.change_requests, public.documents, public.document_versions, public.document_decisions, public.project_scope to authenticated;

drop policy if exists read_change_requests on public.change_requests;
create policy read_change_requests on public.change_requests
  for select to authenticated using ((select public.is_project_client(project_id)) or (select public.is_admin()));

drop policy if exists read_documents on public.documents;
create policy read_documents on public.documents
  for select to authenticated using ((status <> 'draft' and (select public.is_project_client(project_id))) or (select public.is_admin()));

-- Клієнт бачить лише відправлені (зафіксовані) версії своїх документів.
drop policy if exists read_document_versions on public.document_versions;
create policy read_document_versions on public.document_versions
  for select to authenticated using (
    (select public.is_admin())
    or (frozen_at is not null and exists (
      select 1 from public.documents d where d.id = document_id and d.status <> 'draft' and (select public.is_project_client(d.project_id))
    ))
  );

drop policy if exists read_document_decisions on public.document_decisions;
create policy read_document_decisions on public.document_decisions
  for select to authenticated using (
    (select public.is_admin())
    or exists (select 1 from public.documents d where d.id = document_id and (select public.is_project_client(d.project_id)))
  );

drop policy if exists read_project_scope on public.project_scope;
create policy read_project_scope on public.project_scope
  for select to authenticated using ((select public.is_project_client(project_id)) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Умови активації
-- ---------------------------------------------------------------------------
create or replace function public.project_activation_status(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p public.projects;
  v_proposal boolean;
  v_contract boolean;
  v_pre_required boolean;
  v_pre_paid boolean;
begin
  select * into v_p from public.projects where id = p_project;
  if not found or not (public.is_admin() or v_p.client_id = (select auth.uid())) then
    return null;
  end if;
  select exists (select 1 from public.proposals where project_id = p_project and status = 'approved') into v_proposal;
  select exists (select 1 from public.documents where project_id = p_project and kind = 'contract' and status = 'approved') into v_contract;
  select exists (select 1 from public.invoices where project_id = p_project and purpose = 'prepayment' and status <> 'void') into v_pre_required;
  select v_pre_required and not exists (
    select 1 from public.invoices i
    where i.project_id = p_project and i.purpose = 'prepayment' and i.status <> 'void'
      and (i.status <> 'issued' or public.invoice_paid_raw(i.id) < i.amount)
  ) into v_pre_paid;
  return jsonb_build_object(
    'activated', v_p.activated_at is not null,
    'proposal_approved', v_proposal,
    'contract_approved', v_contract,
    'prepayment_required', v_pre_required,
    'prepayment_paid', coalesce(v_pre_paid, false),
    'ready', v_p.activated_at is null and v_proposal and v_contract and (not v_pre_required or coalesce(v_pre_paid, false))
  );
end;
$$;

create or replace function public.admin_set_invoice_purpose(p_invoice uuid, p_purpose text)
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
  if p_purpose not in ('regular', 'prepayment', 'change') then
    raise exception 'invalid_purpose' using errcode = '22023';
  end if;
  select status into v_status from public.invoices where id = p_invoice for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'invoice_frozen' using errcode = 'P0001';
  end if;
  update public.invoices set purpose = p_purpose where id = p_invoice;
end;
$$;

create or replace function public.admin_activate_project(p_project uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
  v_prop public.proposals;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.projects where id = p_project for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_status := public.project_activation_status(p_project);
  if (v_status ->> 'activated')::boolean then
    raise exception 'already_active' using errcode = 'P0001';
  end if;
  if not (v_status ->> 'ready')::boolean then
    raise exception 'conditions_not_met' using errcode = 'P0001';
  end if;
  select * into v_prop from public.proposals where project_id = p_project and status = 'approved' order by version desc limit 1;

  update public.projects
     set activated_at = now(), activated_by = auth.uid(), activation_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''),
         status = 'active', next_action_owner = 'studio', next_action = 'Проєкт активовано, студія починає роботу'
   where id = p_project;
  insert into public.project_scope (project_id, kind, title, items, price_amount, currency, duration_days, source_proposal_id, created_by)
  values (p_project, 'baseline', v_prop.title, v_prop.features, v_prop.price_amount, v_prop.currency, v_prop.duration_days, v_prop.id, auth.uid());
  perform public.admin_set_project_stage(p_project, 'design');
  perform public.project_log(p_project, auth.uid(), 'admin', 'project_activated', jsonb_build_object('proposal_version', v_prop.version));
end;
$$;

-- ---------------------------------------------------------------------------
-- Документи: операції адміністратора
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_document(p_project uuid, p_kind text, p_title text, p_body text)
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
  perform 1 from public.projects where id = p_project;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.documents (project_id, kind, title, created_by)
  values (p_project, p_kind, btrim(coalesce(p_title, '')), (select user_id from public.admin_users where user_id = auth.uid()))
  returning id into v_id;
  insert into public.document_versions (document_id, version, body, created_by)
  values (v_id, 1, coalesce(p_body, ''), (select user_id from public.admin_users where user_id = auth.uid()));
  return v_id;
end;
$$;

-- Збереження: у чернетці правимо поточну версію; після «потрібні зміни» створюється НОВА версія; погоджений документ змінити не можна.
create or replace function public.admin_save_document(p_doc uuid, p_title text, p_body text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.documents;
  v_frozen timestamptz;
  v_next int;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_d from public.documents where id = p_doc for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_d.status in ('approved', 'void', 'sent') then
    raise exception 'document_locked' using errcode = 'P0001';
  end if;
  select frozen_at into v_frozen from public.document_versions where document_id = p_doc and version = v_d.current_version;
  if v_frozen is not null then
    v_next := v_d.current_version + 1;
    insert into public.document_versions (document_id, version, body, created_by)
    values (p_doc, v_next, coalesce(p_body, ''), (select user_id from public.admin_users where user_id = auth.uid()));
    update public.documents set current_version = v_next, status = 'draft', title = btrim(coalesce(p_title, title)), updated_at = now() where id = p_doc;
    return v_next;
  end if;
  update public.document_versions set body = coalesce(p_body, '') where document_id = p_doc and version = v_d.current_version;
  update public.documents set title = btrim(coalesce(p_title, title)), updated_at = now() where id = p_doc;
  return v_d.current_version;
end;
$$;

create or replace function public.admin_send_document(p_doc uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.documents;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_d from public.documents where id = p_doc for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_d.status <> 'draft' then
    raise exception 'document_locked' using errcode = 'P0001';
  end if;
  update public.document_versions set frozen_at = now() where document_id = p_doc and version = v_d.current_version and frozen_at is null;
  update public.documents set status = 'sent', sent_at = now(), updated_at = now() where id = p_doc;
  update public.projects set next_action_owner = 'client', next_action = 'Перегляньте документ і ухваліть рішення' where id = v_d.project_id;
  perform public.project_log(v_d.project_id, auth.uid(), 'admin', 'document_sent', jsonb_build_object('document', p_doc, 'kind', v_d.kind, 'version', v_d.current_version));
end;
$$;

create or replace function public.admin_void_document(p_doc uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.documents;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_d from public.documents where id = p_doc for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_d.status = 'approved' then
    raise exception 'document_locked' using errcode = 'P0001'; -- погоджений документ скасовується лише новою додатковою угодою
  end if;
  update public.documents set status = 'void', updated_at = now() where id = p_doc;
  perform public.project_log(v_d.project_id, auth.uid(), 'admin', 'document_voided', jsonb_build_object('document', p_doc, 'reason', left(coalesce(p_reason, ''), 500)));
end;
$$;

-- Рішення клієнта. Фіксується версія й хеш змісту, який бачив клієнт. Це погодження в системі, а не кваліфікований електронний підпис.
create or replace function public.client_decide_document(p_doc uuid, p_decision text, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.documents;
  v_v public.document_versions;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_cr public.change_requests;
begin
  if p_decision not in ('approved', 'changes_requested', 'rejected') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  select * into v_d from public.documents where id = p_doc for update;
  if not found or not public.is_project_client(v_d.project_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_d.status <> 'sent' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  if p_decision in ('changes_requested', 'rejected') and v_comment is null then
    raise exception 'comment_required' using errcode = '22023';
  end if;
  select * into v_v from public.document_versions where document_id = p_doc and version = v_d.current_version and frozen_at is not null;
  if not found then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;

  insert into public.document_decisions (document_id, version, content_hash, decision, comment, decided_by)
  values (p_doc, v_v.version, v_v.content_hash, p_decision, left(v_comment, 2000), auth.uid());

  update public.documents
     set status = case p_decision when 'approved' then 'approved' when 'changes_requested' then 'changes_requested' else 'void' end,
         decided_at = now(), updated_at = now()
   where id = p_doc;

  if v_d.change_request_id is not null then
    select * into v_cr from public.change_requests where id = v_d.change_request_id for update;
    if p_decision = 'approved' then
      update public.change_requests set status = 'approved', decided_at = now(), updated_at = now() where id = v_cr.id and status = 'quoted';
      insert into public.project_scope (project_id, kind, title, items, price_amount, currency, duration_days, change_request_id, created_by)
      values (v_cr.project_id, 'amendment', v_cr.title, jsonb_build_array(v_cr.title), v_cr.quote_price, v_cr.quote_currency, v_cr.quote_days, v_cr.id, auth.uid())
      on conflict do nothing;
    elsif p_decision = 'rejected' then
      update public.change_requests set status = 'rejected', rejection_reason = left(v_comment, 1000), decided_at = now(), updated_at = now()
       where id = v_cr.id and status = 'quoted';
    end if;
  end if;

  update public.projects
     set next_action_owner = 'studio',
         next_action = case p_decision when 'approved' then 'Клієнт погодив документ' else 'Студія опрацьовує відповідь клієнта' end
   where id = v_d.project_id;
  perform public.project_log(v_d.project_id, auth.uid(), 'client', 'document_' || p_decision, jsonb_build_object('document', p_doc, 'kind', v_d.kind, 'version', v_v.version));
end;
$$;

-- ---------------------------------------------------------------------------
-- Запити на зміни
-- ---------------------------------------------------------------------------
create or replace function public.client_submit_change_request(p_project uuid, p_title text, p_description text)
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
  if v_p.activated_at is null or v_p.status <> 'active' then
    raise exception 'project_not_active' using errcode = 'P0001';
  end if;
  insert into public.change_requests (project_id, title, description, requested_by)
  values (p_project, btrim(coalesce(p_title, '')), btrim(coalesce(p_description, '')), auth.uid())
  returning id into v_id;
  update public.projects set next_action_owner = 'studio', next_action = 'Студія оцінює запит на зміну' where id = p_project;
  perform public.project_log(p_project, auth.uid(), 'client', 'change_requested', jsonb_build_object('change_request', v_id));
  return v_id;
end;
$$;

create or replace function public.client_withdraw_change_request(p_cr uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cr public.change_requests;
begin
  select * into v_cr from public.change_requests where id = p_cr for update;
  if not found or not public.is_project_client(v_cr.project_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_cr.status not in ('submitted', 'quoted') then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  update public.change_requests set status = 'withdrawn', decided_at = now(), updated_at = now() where id = p_cr;
  if v_cr.quote_document_id is not null then
    update public.documents set status = 'void', updated_at = now() where id = v_cr.quote_document_id and status in ('draft', 'sent');
  end if;
  perform public.project_log(v_cr.project_id, auth.uid(), 'client', 'change_withdrawn', jsonb_build_object('change_request', p_cr));
end;
$$;

-- Оцінка: створює додаткову угоду (документ) із ціною й термінами та відправляє її клієнту. Без погодження зміна не потрапляє в роботу.
create or replace function public.admin_quote_change_request(p_cr uuid, p_summary text, p_price numeric, p_currency text, p_days int)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cr public.change_requests;
  v_doc uuid;
  v_body text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_cr from public.change_requests where id = p_cr for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_cr.status <> 'submitted' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  if p_price is null or p_price < 0 or p_currency not in ('UAH', 'USD', 'EUR') or p_days is null or p_days < 0 or char_length(btrim(coalesce(p_summary, ''))) < 10 then
    raise exception 'invalid_quote' using errcode = '22023';
  end if;
  v_body := '# Додаткова угода: ' || v_cr.title || E'\n\n'
         || '## Запит клієнта' || E'\n' || v_cr.description || E'\n\n'
         || '## Пропозиція студії' || E'\n' || btrim(p_summary) || E'\n\n'
         || '- Додаткова вартість: ' || to_char(round(p_price, 2), 'FM999999999990.00') || ' ' || p_currency || E'\n'
         || '- Додатковий термін: ' || p_days || ' дн.' || E'\n\n'
         || 'Первинний обсяг робіт (Scope of Work) не змінюється. Зміна набуває чинності лише після погодження цієї угоди клієнтом.';

  insert into public.documents (project_id, kind, title, change_request_id, created_by)
  values (v_cr.project_id, 'amendment', 'Додаткова угода ' || v_cr.number, p_cr, (select user_id from public.admin_users where user_id = auth.uid()))
  returning id into v_doc;
  insert into public.document_versions (document_id, version, body, frozen_at, created_by)
  values (v_doc, 1, v_body, now(), (select user_id from public.admin_users where user_id = auth.uid()));
  update public.documents set status = 'sent', sent_at = now() where id = v_doc;

  update public.change_requests
     set status = 'quoted', quote_summary = btrim(p_summary), quote_price = round(p_price, 2), quote_currency = p_currency, quote_days = p_days,
         quote_document_id = v_doc, quoted_at = now(), updated_at = now()
   where id = p_cr;
  update public.projects set next_action_owner = 'client', next_action = 'Погодьте або відхиліть додаткову угоду' where id = v_cr.project_id;
  perform public.project_log(v_cr.project_id, auth.uid(), 'admin', 'change_quoted', jsonb_build_object('change_request', p_cr, 'document', v_doc));
  return v_doc;
end;
$$;

create or replace function public.admin_reject_change_request(p_cr uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cr public.change_requests;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_reason) < 10 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select * into v_cr from public.change_requests where id = p_cr for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_cr.status not in ('submitted', 'quoted') then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  update public.change_requests set status = 'rejected', rejection_reason = left(v_reason, 1000), decided_at = now(), updated_at = now() where id = p_cr;
  if v_cr.quote_document_id is not null then
    update public.documents set status = 'void', updated_at = now() where id = v_cr.quote_document_id and status in ('draft', 'sent');
  end if;
  perform public.project_log(v_cr.project_id, auth.uid(), 'admin', 'change_rejected', jsonb_build_object('change_request', p_cr, 'reason', left(v_reason, 500)));
end;
$$;

-- Лише погоджена зміна може перейти у роботу / бути виконана.
create or replace function public.admin_set_change_request_status(p_cr uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cr public.change_requests;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('in_progress', 'done') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select * into v_cr from public.change_requests where id = p_cr for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not ((p_status = 'in_progress' and v_cr.status = 'approved') or (p_status = 'done' and v_cr.status = 'in_progress')) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  update public.change_requests set status = p_status, updated_at = now() where id = p_cr;
  perform public.project_log(v_cr.project_id, auth.uid(), 'admin', 'change_' || p_status, jsonb_build_object('change_request', p_cr));
end;
$$;

-- Рахунок на погоджену зміну (чернетка; виставляється стандартним admin_issue_invoice).
create or replace function public.admin_create_change_invoice(p_cr uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cr public.change_requests;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_cr from public.change_requests where id = p_cr for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_cr.status not in ('approved', 'in_progress', 'done') or coalesce(v_cr.quote_price, 0) <= 0 then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.invoices where change_request_id = p_cr and status <> 'void') then
    raise exception 'invoice_exists' using errcode = 'P0001';
  end if;
  insert into public.invoices (project_id, label, amount, currency, purpose, change_request_id, created_by)
  values (v_cr.project_id, left('Зміна ' || v_cr.number || ': ' || v_cr.title, 120), v_cr.quote_price, v_cr.quote_currency, 'change', p_cr,
          (select user_id from public.admin_users where user_id = auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Права виконання
-- ---------------------------------------------------------------------------
revoke all on function
  public.admin_reject_order(uuid, text),
  public.client_requests(),
  public.project_activation_status(uuid),
  public.admin_set_invoice_purpose(uuid, text),
  public.admin_activate_project(uuid, text),
  public.admin_create_document(uuid, text, text, text),
  public.admin_save_document(uuid, text, text),
  public.admin_send_document(uuid),
  public.admin_void_document(uuid, text),
  public.client_decide_document(uuid, text, text),
  public.client_submit_change_request(uuid, text, text),
  public.client_withdraw_change_request(uuid),
  public.admin_quote_change_request(uuid, text, numeric, text, int),
  public.admin_reject_change_request(uuid, text),
  public.admin_set_change_request_status(uuid, text),
  public.admin_create_change_invoice(uuid)
  from public, anon, authenticated;
grant execute on function
  public.admin_reject_order(uuid, text),
  public.client_requests(),
  public.project_activation_status(uuid),
  public.admin_set_invoice_purpose(uuid, text),
  public.admin_activate_project(uuid, text),
  public.admin_create_document(uuid, text, text, text),
  public.admin_save_document(uuid, text, text),
  public.admin_send_document(uuid),
  public.admin_void_document(uuid, text),
  public.client_decide_document(uuid, text, text),
  public.client_submit_change_request(uuid, text, text),
  public.client_withdraw_change_request(uuid),
  public.admin_quote_change_request(uuid, text, numeric, text, int),
  public.admin_reject_change_request(uuid, text),
  public.admin_set_change_request_status(uuid, text),
  public.admin_create_change_invoice(uuid)
  to authenticated;
