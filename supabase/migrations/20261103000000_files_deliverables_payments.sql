-- BONSI Studios V0.4, етап 2: результати етапів і погодження, приватні файли, рахунки й облік оплат.
-- Лише для окремого проєкту Supabase BONSI. Міграція адитивна й спирається на 20261102*.
--
-- Принципи:
--  * Статуси незалежні: заявка (orders.status) ≠ проєкт (projects.status) ≠ результат етапу (deliverables.status)
--    ≠ рахунок (invoices.status) ≠ оплата (обчислюється з журналу payments).
--  * «Оплачено» ніколи не зберігається: це похідне значення з підтверджених записів журналу. Клієнт не може
--    підтвердити платіж; підтверджує адміністратор (банківський переказ) або перевірена подія провайдера.
--  * Файли лежать у приватному бакеті; доступ — лише через рядок project_files, видимий за RLS, і короткоживучі
--    підписані посилання, які видає сервер.
--  * Журнали рішень і платежів незмінні (append-only / тільки нові записи).

-- ---------------------------------------------------------------------------
-- 1. Результати етапів (Design review, Preview, QA, Delivery) і погодження
-- ---------------------------------------------------------------------------
create table if not exists public.deliverables (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  stage        text not null check (stage in (
    'brief', 'proposal', 'agreement', 'design', 'development', 'qa', 'delivery', 'support'
  )),
  version      int not null,
  status       text not null default 'draft' check (status in (
    'draft', 'submitted', 'approved', 'changes_requested', 'superseded'
  )),
  title        text not null check (char_length(title) between 1 and 160),
  description  text not null default '' check (char_length(description) <= 4000),
  -- Посилання на прев'ю (стейджинг, Figma-прототип): лише http(s).
  preview_url  text check (preview_url is null or (preview_url ~* '^https?://' and char_length(preview_url) <= 500)),
  created_by   uuid references public.admin_users (user_id) on delete set null,
  created_at   timestamptz not null default now(),
  submitted_at timestamptz,
  decided_at   timestamptz,
  unique (project_id, stage, version)
);
create index if not exists deliverables_project_idx on public.deliverables (project_id, stage, version desc);

create table if not exists public.deliverable_decisions (
  id             bigint generated always as identity primary key,
  deliverable_id uuid not null references public.deliverables (id) on delete restrict,
  project_id     uuid not null references public.projects (id) on delete restrict,
  stage          text not null,
  version        int not null,
  decision       text not null check (decision in ('approved', 'changes_requested')),
  comment        text check (comment is null or char_length(comment) <= 2000),
  actor_id       uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists deliverable_decisions_project_idx on public.deliverable_decisions (project_id, id);

drop trigger if exists deliverable_decisions_append_only on public.deliverable_decisions;
create trigger deliverable_decisions_append_only
  before update or delete on public.deliverable_decisions
  for each row execute function public.forbid_mutation();

create or replace function public.deliverable_freeze()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (new.title, new.description, new.preview_url, new.version, new.stage, new.project_id)
     is distinct from (old.title, old.description, old.preview_url, old.version, old.stage, old.project_id) then
    raise exception 'deliverable_frozen' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists deliverables_freeze on public.deliverables;
create trigger deliverables_freeze before update on public.deliverables
  for each row execute function public.deliverable_freeze();

-- ---------------------------------------------------------------------------
-- 2. Файли проєкту (приватне сховище) і вкладення в чаті
-- ---------------------------------------------------------------------------
create table if not exists public.project_files (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  uploader_id    uuid references auth.users (id) on delete set null,
  uploader_role  text not null check (uploader_role in ('client', 'admin')),
  category       text not null check (category in ('logo', 'text', 'mockup', 'document', 'final', 'handover', 'attachment', 'other')),
  display_name   text not null check (char_length(display_name) between 1 and 200),
  mime           text not null,
  size_bytes     bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  storage_path   text not null unique,
  message_id     bigint references public.project_messages (id) on delete set null,
  deliverable_id uuid references public.deliverables (id) on delete set null,
  client_visible boolean not null default true,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  check (storage_path like project_id::text || '/%')
);
create index if not exists project_files_project_idx on public.project_files (project_id, created_at desc);
create index if not exists project_files_message_idx on public.project_files (message_id);

-- Дозволені типи файлів на рівні бази (друга лінія захисту після перевірки на сервері).
create or replace function public.file_mime_allowed(p_mime text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_mime in (
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword', 'application/vnd.ms-excel',
    'application/vnd.figma', 'application/json'
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Рахунки й журнал оплат
-- ---------------------------------------------------------------------------
create sequence if not exists public.invoice_number_seq;

create table if not exists public.payment_settings (
  id             boolean primary key default true check (id),
  recipient      text not null default '',
  iban           text not null default '' check (char_length(iban) <= 40),
  bank_name      text not null default '',
  tax_id         text not null default '',
  purpose_hint   text not null default 'Оплата за розробку, рахунок {number}',
  -- Онлайн-еквайринг не активний, поки немає налаштованого мерчант-акаунта: значення null.
  online_provider text check (online_provider is null or online_provider in ('monobank', 'liqpay')),
  updated_at     timestamptz not null default now()
);
insert into public.payment_settings (id) values (true) on conflict do nothing;

create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique default (
    'INV-' || to_char(now() at time zone 'utc', 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 5, '0')
  ),
  project_id    uuid not null references public.projects (id) on delete restrict,
  proposal_id   uuid references public.proposals (id) on delete restrict,
  schedule_index int,
  label         text not null check (char_length(label) between 1 and 120),
  amount        numeric(12, 2) not null check (amount > 0),
  currency      text not null check (currency in ('UAH', 'USD', 'EUR')),
  due_date      date,
  -- Життєвий цикл документа (не платежу): чернетка → виставлено → анульовано.
  status        text not null default 'draft' check (status in ('draft', 'issued', 'void')),
  issued_at     timestamptz,
  created_by    uuid references public.admin_users (user_id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (proposal_id, schedule_index)
);
create index if not exists invoices_project_idx on public.invoices (project_id, created_at);

create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  invoice_id          uuid not null references public.invoices (id) on delete restrict,
  project_id          uuid not null references public.projects (id) on delete restrict,
  kind                text not null default 'payment' check (kind in ('payment', 'refund')),
  method              text not null check (method in ('bank_transfer', 'monobank', 'liqpay')),
  amount              numeric(12, 2) not null check (amount > 0),
  currency            text not null check (currency in ('UAH', 'USD', 'EUR')),
  -- pending: клієнт повідомив про оплату, студія ще не перевірила надходження; confirmed: надходження підтверджено;
  -- failed: відхилено або помилка провайдера.
  status              text not null default 'pending' check (status in ('pending', 'confirmed', 'failed')),
  reference           text check (reference is null or char_length(reference) <= 200),
  note                text check (note is null or char_length(note) <= 1000),
  provider_payment_id text,
  reported_by         uuid references auth.users (id) on delete set null,
  decided_by          uuid references public.admin_users (user_id) on delete set null,
  created_at          timestamptz not null default now(),
  decided_at          timestamptz,
  unique (method, provider_payment_id)
);
create index if not exists payments_invoice_idx on public.payments (invoice_id, created_at);

-- Журнал подій провайдера: унікальність (provider, event_id) робить обробку повторів ідемпотентною.
create table if not exists public.payment_events (
  id          bigint generated always as identity primary key,
  provider    text not null,
  event_id    text not null,
  invoice_id  uuid references public.invoices (id) on delete set null,
  outcome     text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (provider, event_id)
);

drop trigger if exists payment_events_append_only on public.payment_events;
create trigger payment_events_append_only
  before update or delete on public.payment_events
  for each row execute function public.forbid_mutation();

-- Сума й валюта виставленого рахунку незмінні; платежі не можна ні змінювати за межами рішення, ні видаляти.
create or replace function public.invoice_freeze()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (new.amount, new.currency, new.label, new.project_id, new.number)
     is distinct from (old.amount, old.currency, old.label, old.project_id, old.number) then
    raise exception 'invoice_frozen' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists invoices_freeze on public.invoices;
create trigger invoices_freeze before update on public.invoices
  for each row execute function public.invoice_freeze();

create or replace function public.payments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'append_only' using errcode = '42501';
  end if;
  if old.status <> 'pending' then
    raise exception 'payment_decided' using errcode = '42501';
  end if;
  if (new.invoice_id, new.project_id, new.kind, new.method, new.amount, new.currency)
     is distinct from (old.invoice_id, old.project_id, old.kind, old.method, old.amount, old.currency) then
    raise exception 'payment_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists payments_guard_trg on public.payments;
create trigger payments_guard_trg before update or delete on public.payments
  for each row execute function public.payments_guard();

-- Баланс рахунку: оплачено = підтверджені платежі − підтверджені повернення. Статус платежу — завжди похідний.
-- Внутрішній підрахунок без перевірки ролі: його викликають лише інші security definer-функції.
create or replace function public.invoice_paid_raw(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)
  from public.payments where invoice_id = p_invoice and status = 'confirmed';
$$;

-- Публічні обгортки віддають значення лише власнику проєкту або адміністратору (інакше — null).
create or replace function public.invoice_paid_amount(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select public.invoice_paid_raw(i.id)
  from public.invoices i
  where i.id = p_invoice and ((i.status <> 'draft' and public.is_project_client(i.project_id)) or public.is_admin());
$$;

create or replace function public.invoice_payment_state(p_invoice uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when i.status = 'void' then 'void'
    when public.invoice_paid_raw(i.id) >= i.amount then 'paid'
    when public.invoice_paid_raw(i.id) > 0 then 'partial'
    when exists (select 1 from public.payments p where p.invoice_id = i.id and p.status = 'pending' and p.kind = 'payment') then 'awaiting_confirmation'
    else 'unpaid'
  end
  from public.invoices i
  where i.id = p_invoice and ((i.status <> 'draft' and public.is_project_client(i.project_id)) or public.is_admin());
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.deliverables enable row level security;
alter table public.deliverable_decisions enable row level security;
alter table public.project_files enable row level security;
alter table public.payment_settings enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;

revoke all on public.deliverables, public.deliverable_decisions, public.project_files, public.payment_settings,
  public.invoices, public.payments, public.payment_events from anon, authenticated;
grant select on public.deliverables, public.deliverable_decisions, public.project_files, public.invoices,
  public.payments, public.payment_events to authenticated;
-- Реквізити видаються клієнту лише функцією; напряму таблицю читає тільки адміністратор.
grant select on public.payment_settings to authenticated;

drop policy if exists read_deliverables on public.deliverables;
create policy read_deliverables on public.deliverables
  for select to authenticated using (
    (status <> 'draft' and (select public.is_project_client(project_id))) or (select public.is_admin())
  );

drop policy if exists read_deliverable_decisions on public.deliverable_decisions;
create policy read_deliverable_decisions on public.deliverable_decisions
  for select to authenticated using ((select public.is_project_client(project_id)) or (select public.is_admin()));

drop policy if exists read_project_files on public.project_files;
create policy read_project_files on public.project_files
  for select to authenticated using (
    (deleted_at is null and client_visible and (select public.is_project_client(project_id))) or (select public.is_admin())
  );

drop policy if exists read_invoices on public.invoices;
create policy read_invoices on public.invoices
  for select to authenticated using (
    (status <> 'draft' and (select public.is_project_client(project_id))) or (select public.is_admin())
  );

drop policy if exists read_payments on public.payments;
create policy read_payments on public.payments
  for select to authenticated using ((select public.is_project_client(project_id)) or (select public.is_admin()));

drop policy if exists admin_read_payment_events on public.payment_events;
create policy admin_read_payment_events on public.payment_events
  for select to authenticated using ((select public.is_admin()));

drop policy if exists admin_read_payment_settings on public.payment_settings;
create policy admin_read_payment_settings on public.payment_settings
  for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 5. Результати етапів: операції
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_deliverable(p_project uuid, p_stage text, p_title text, p_description text, p_preview_url text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_version int;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.projects where id = p_project for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.deliverables where project_id = p_project and stage = p_stage and status = 'draft') then
    raise exception 'draft_exists' using errcode = 'P0001';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.deliverables where project_id = p_project and stage = p_stage;
  insert into public.deliverables (project_id, stage, version, title, description, preview_url, created_by)
  values (p_project, p_stage, v_version, btrim(p_title), coalesce(p_description, ''), nullif(btrim(coalesce(p_preview_url, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_update_deliverable(p_id uuid, p_title text, p_description text, p_preview_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.deliverables
     set title = btrim(p_title), description = coalesce(p_description, ''), preview_url = nullif(btrim(coalesce(p_preview_url, '')), '')
   where id = p_id and status = 'draft';
  if not found then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.admin_submit_deliverable(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.deliverables;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_d from public.deliverables where id = p_id for update;
  if not found or v_d.status <> 'draft' then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;
  update public.deliverables set status = 'superseded'
   where project_id = v_d.project_id and stage = v_d.stage and status in ('submitted', 'changes_requested') and id <> p_id;
  update public.deliverables set status = 'submitted', submitted_at = now() where id = p_id;
  update public.projects
     set next_action_owner = 'client', next_action = 'Перегляньте результат етапу й погодьте його або попросіть правок'
   where id = v_d.project_id;
  perform public.project_log(v_d.project_id, auth.uid(), 'admin', 'deliverable_submitted',
    jsonb_build_object('stage', v_d.stage, 'version', v_d.version, 'title', v_d.title));
end;
$$;

create or replace function public.client_decide_deliverable(p_id uuid, p_decision text, p_comment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.deliverables;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if p_decision not in ('approved', 'changes_requested') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  select * into v_d from public.deliverables where id = p_id for update;
  if not found or not public.is_project_client(v_d.project_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_d.status <> 'submitted' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  if p_decision = 'changes_requested' and v_comment is null then
    raise exception 'comment_required' using errcode = '22023';
  end if;
  if v_comment is not null and char_length(v_comment) > 2000 then
    raise exception 'invalid_comment' using errcode = '22023';
  end if;

  update public.deliverables set status = p_decision, decided_at = now() where id = p_id;
  insert into public.deliverable_decisions (deliverable_id, project_id, stage, version, decision, comment, actor_id)
  values (v_d.id, v_d.project_id, v_d.stage, v_d.version, p_decision, v_comment, auth.uid());
  update public.projects
     set next_action_owner = 'studio',
         next_action = case when p_decision = 'approved' then 'Студія переходить до наступного кроку' else 'Студія опрацьовує ваші правки' end
   where id = v_d.project_id;
  perform public.project_log(v_d.project_id, auth.uid(), 'client',
    case when p_decision = 'approved' then 'deliverable_approved' else 'deliverable_changes_requested' end,
    jsonb_build_object('stage', v_d.stage, 'version', v_d.version, 'title', v_d.title));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Файли: реєстрація, вкладення до повідомлень, видалення
-- ---------------------------------------------------------------------------
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
  insert into public.project_files (project_id, uploader_id, uploader_role, category, display_name, mime, size_bytes, storage_path)
  values (p_project, auth.uid(), 'client', p_category, left(btrim(p_name), 200), p_mime, p_size, p_path)
  returning id into v_id;
  perform public.project_log(p_project, auth.uid(), 'client', 'file_uploaded', jsonb_build_object('name', left(btrim(p_name), 200), 'category', p_category), p_category <> 'attachment');
  return v_id;
end;
$$;

create or replace function public.admin_register_file(
  p_project uuid, p_category text, p_name text, p_mime text, p_size bigint, p_path text,
  p_visible boolean, p_deliverable uuid default null
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
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.file_mime_allowed(p_mime) then
    raise exception 'mime_not_allowed' using errcode = '22023';
  end if;
  if p_deliverable is not null and not exists (select 1 from public.deliverables where id = p_deliverable and project_id = p_project) then
    raise exception 'invalid_deliverable' using errcode = '22023';
  end if;
  insert into public.project_files (project_id, uploader_id, uploader_role, category, display_name, mime, size_bytes, storage_path, client_visible, deliverable_id)
  values (p_project, auth.uid(), 'admin', p_category, left(btrim(p_name), 200), p_mime, p_size, p_path, coalesce(p_visible, true), p_deliverable)
  returning id into v_id;
  if coalesce(p_visible, true) then
    perform public.project_log(p_project, auth.uid(), 'admin', 'file_shared', jsonb_build_object('name', left(btrim(p_name), 200), 'category', p_category));
  end if;
  return v_id;
end;
$$;

-- Прикріплює вже завантажені користувачем файли до його ж повідомлення.
create or replace function public.attach_files_to_message(p_message bigint, p_files uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg public.project_messages;
  v_count int;
begin
  select * into v_msg from public.project_messages where id = p_message;
  if not found or v_msg.author_id is distinct from auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(array_length(p_files, 1), 0) > 5 then
    raise exception 'too_many_files' using errcode = '22023';
  end if;
  update public.project_files
     set message_id = p_message
   where id = any (p_files) and project_id = v_msg.project_id and uploader_id = auth.uid()
     and message_id is null and deleted_at is null;
  get diagnostics v_count = row_count;
  if v_count <> coalesce(array_length(p_files, 1), 0) then
    raise exception 'invalid_files' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.delete_project_file(p_file uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.project_files;
begin
  select * into v_f from public.project_files where id = p_file for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if public.is_admin() then
    null;
  elsif v_f.uploader_id = auth.uid() and v_f.uploader_role = 'client' and public.is_project_client(v_f.project_id)
        and v_f.deliverable_id is null and v_f.message_id is null then
    null;
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.project_files set deleted_at = now() where id = p_file and deleted_at is null;
  return v_f.storage_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Рахунки й оплати: операції
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_payment_settings(
  p_recipient text, p_iban text, p_bank text, p_tax_id text, p_hint text
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
  if char_length(coalesce(p_iban, '')) > 40 or (p_iban is not null and p_iban <> '' and p_iban !~ '^[A-Za-z]{2}[0-9A-Za-z ]{10,38}$') then
    raise exception 'invalid_iban' using errcode = '22023';
  end if;
  update public.payment_settings
     set recipient = left(btrim(coalesce(p_recipient, '')), 200), iban = upper(btrim(coalesce(p_iban, ''))),
         bank_name = left(btrim(coalesce(p_bank, '')), 200), tax_id = left(btrim(coalesce(p_tax_id, '')), 40),
         purpose_hint = left(btrim(coalesce(p_hint, '')), 300), updated_at = now()
   where id;
end;
$$;

-- Реквізити бачить клієнт лише тоді, коли йому виставлено рахунок.
create or replace function public.client_bank_details()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.invoices i join public.projects p on p.id = i.project_id
    where p.client_id = auth.uid() and i.status = 'issued'
  ) then
    return null;
  end if;
  return (select jsonb_build_object('recipient', recipient, 'iban', iban, 'bank_name', bank_name, 'tax_id', tax_id, 'purpose_hint', purpose_hint)
          from public.payment_settings where id);
end;
$$;

create or replace function public.admin_create_invoice(
  p_project uuid, p_label text, p_amount numeric, p_currency text, p_due date
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
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.invoices (project_id, label, amount, currency, due_date, created_by)
  values (p_project, btrim(p_label), round(p_amount, 2), p_currency, p_due, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Чернетки рахунків за графіком погодженої пропозиції. Ідемпотентно: повторний виклик нічого не дублює.
create or replace function public.admin_create_invoices_from_proposal(p_proposal uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop public.proposals;
  v_item jsonb;
  v_index int := 0;
  v_cents bigint;
  v_allocated bigint := 0;
  v_part bigint;
  v_count int := 0;
  v_n int;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_prop from public.proposals where id = p_proposal;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_prop.status <> 'approved' then
    raise exception 'proposal_not_approved' using errcode = 'P0001';
  end if;
  v_cents := round(v_prop.price_amount * 100);
  v_n := jsonb_array_length(v_prop.payment_schedule);
  for v_item in select * from jsonb_array_elements(v_prop.payment_schedule) loop
    v_part := case when v_index = v_n - 1 then v_cents - v_allocated else round(v_cents * (v_item ->> 'percent')::numeric / 100) end;
    v_allocated := v_allocated + v_part;
    insert into public.invoices (project_id, proposal_id, schedule_index, label, amount, currency, created_by)
    values (v_prop.project_id, v_prop.id, v_index, left(v_item ->> 'label', 120), v_part / 100.0, v_prop.currency, auth.uid())
    on conflict (proposal_id, schedule_index) do nothing;
    if found then v_count := v_count + 1; end if;
    v_index := v_index + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.admin_issue_invoice(p_invoice uuid, p_due date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.invoices;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_i from public.invoices where id = p_invoice for update;
  if not found or v_i.status <> 'draft' then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;
  update public.invoices set status = 'issued', issued_at = now(), due_date = coalesce(p_due, due_date) where id = p_invoice;
  update public.projects
     set next_action_owner = 'client', next_action = 'Сплатіть рахунок ' || v_i.number
   where id = v_i.project_id;
  perform public.project_log(v_i.project_id, auth.uid(), 'admin', 'invoice_issued',
    jsonb_build_object('number', v_i.number, 'amount', v_i.amount, 'currency', v_i.currency));
end;
$$;

create or replace function public.admin_void_invoice(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.invoices;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_i from public.invoices where id = p_invoice for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.payments where invoice_id = p_invoice and status in ('confirmed', 'pending')) then
    raise exception 'has_payments' using errcode = 'P0001';
  end if;
  update public.invoices set status = 'void' where id = p_invoice;
  if v_i.status = 'issued' then
    perform public.project_log(v_i.project_id, auth.uid(), 'admin', 'invoice_voided', jsonb_build_object('number', v_i.number));
  end if;
end;
$$;

-- Клієнт повідомляє, що сплатив банківським переказом. Це лише заявка на перевірку: статус «оплачено» не змінюється.
create or replace function public.client_report_payment(p_invoice uuid, p_reference text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.invoices;
  v_id uuid;
begin
  select * into v_i from public.invoices where id = p_invoice for update;
  if not found or v_i.status <> 'issued' or not public.is_project_client(v_i.project_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.payments where invoice_id = p_invoice and status = 'pending' and kind = 'payment') then
    raise exception 'already_reported' using errcode = 'P0001';
  end if;
  if public.invoice_paid_raw(p_invoice) >= v_i.amount then
    raise exception 'already_paid' using errcode = 'P0001';
  end if;
  insert into public.payments (invoice_id, project_id, kind, method, amount, currency, status, reference, reported_by)
  values (p_invoice, v_i.project_id, 'payment', 'bank_transfer', v_i.amount - public.invoice_paid_raw(p_invoice), v_i.currency,
          'pending', left(nullif(btrim(coalesce(p_reference, '')), ''), 200), auth.uid())
  returning id into v_id;
  perform public.project_log(v_i.project_id, auth.uid(), 'client', 'payment_reported', jsonb_build_object('number', v_i.number));
  return v_id;
end;
$$;

-- Підтвердження надходження: лише адміністратор після звірки з банком. Сума не може перевищити рахунок.
create or replace function public.admin_confirm_payment(p_payment uuid, p_amount numeric, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.payments;
  v_i public.invoices;
  v_amount numeric(12, 2);
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_p from public.payments where id = p_payment for update;
  if not found or v_p.status <> 'pending' or v_p.kind <> 'payment' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  select * into v_i from public.invoices where id = v_p.invoice_id for update;
  v_amount := round(coalesce(p_amount, v_p.amount), 2);
  if v_amount <= 0 or public.invoice_paid_raw(v_i.id) + v_amount > v_i.amount then
    raise exception 'overpayment' using errcode = '22023';
  end if;
  -- Сума записується з підтвердженого значення; payments_guard забороняє змінювати amount, тому оновлення через тимчасове скасування
  -- заборонено, а відмінну суму фіксуємо новим записом: поточний pending закривається як failed із поясненням.
  if v_amount <> v_p.amount then
    update public.payments set status = 'failed', note = 'Замінено фактичною сумою надходження', decided_by = auth.uid(), decided_at = now()
     where id = p_payment;
    insert into public.payments (invoice_id, project_id, kind, method, amount, currency, status, reference, note, reported_by, decided_by, decided_at)
    values (v_p.invoice_id, v_p.project_id, 'payment', v_p.method, v_amount, v_p.currency, 'confirmed', v_p.reference,
            left(nullif(btrim(coalesce(p_note, '')), ''), 1000), v_p.reported_by, auth.uid(), now());
  else
    update public.payments
       set status = 'confirmed', note = left(nullif(btrim(coalesce(p_note, '')), ''), 1000), decided_by = auth.uid(), decided_at = now()
     where id = p_payment;
  end if;
  perform public.project_log(v_i.project_id, auth.uid(), 'admin', 'payment_confirmed',
    jsonb_build_object('number', v_i.number, 'amount', v_amount, 'currency', v_i.currency));
  if public.invoice_paid_raw(v_i.id) >= v_i.amount then
    update public.projects set next_action_owner = 'studio', next_action = 'Оплату отримано, студія продовжує роботу' where id = v_i.project_id;
  end if;
end;
$$;

create or replace function public.admin_reject_payment(p_payment uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.payments;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_p from public.payments where id = p_payment for update;
  if not found or v_p.status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  update public.payments
     set status = 'failed', note = left(nullif(btrim(coalesce(p_note, '')), ''), 1000), decided_by = auth.uid(), decided_at = now()
   where id = p_payment;
  perform public.project_log(v_p.project_id, auth.uid(), 'admin', 'payment_rejected', '{}'::jsonb);
end;
$$;

create or replace function public.admin_record_refund(p_invoice uuid, p_amount numeric, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.invoices;
  v_amount numeric(12, 2) := round(p_amount, 2);
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_i from public.invoices where id = p_invoice for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_amount <= 0 or v_amount > public.invoice_paid_raw(p_invoice) then
    raise exception 'refund_exceeds_paid' using errcode = '22023';
  end if;
  insert into public.payments (invoice_id, project_id, kind, method, amount, currency, status, note, decided_by, decided_at)
  values (p_invoice, v_i.project_id, 'refund', 'bank_transfer', v_amount, v_i.currency, 'confirmed',
          left(nullif(btrim(coalesce(p_note, '')), ''), 1000), auth.uid(), now());
  perform public.project_log(v_i.project_id, auth.uid(), 'admin', 'payment_refunded',
    jsonb_build_object('number', v_i.number, 'amount', v_amount, 'currency', v_i.currency));
end;
$$;

-- Подія платіжного провайдера (після перевірки підпису на сервері). Лише service_role.
-- Ідемпотентна за (provider, event_id); перевіряє рахунок, валюту, суму; жодної події не губить: кожна пишеться в журнал із результатом.
create or replace function public.payments_apply_provider_event(
  p_provider text, p_event_id text, p_invoice_number text, p_amount numeric, p_currency text,
  p_status text, p_provider_payment_id text, p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_outcome text;
  v_remaining numeric(12, 2);
begin
  if p_provider not in ('monobank', 'liqpay') then
    raise exception 'unknown_provider' using errcode = '22023';
  end if;
  -- Серіалізуємо повтори однієї події: журнал append-only, тому подію записуємо один раз, уже з результатом.
  perform pg_advisory_xact_lock(hashtextextended('bonsi:payevent:' || p_provider || ':' || p_event_id, 0));
  if exists (select 1 from public.payment_events where provider = p_provider and event_id = p_event_id) then
    return 'duplicate';
  end if;

  select * into v_inv from public.invoices where number = p_invoice_number for update;
  if not found then
    v_outcome := 'unknown_invoice';
  elsif v_inv.status <> 'issued' then
    v_outcome := 'invoice_not_payable';
  elsif v_inv.currency <> p_currency then
    v_outcome := 'currency_mismatch';
  else
    v_remaining := v_inv.amount - public.invoice_paid_raw(v_inv.id);
    if p_status <> 'success' then
      insert into public.payments (invoice_id, project_id, kind, method, amount, currency, status, provider_payment_id, note, decided_at)
      -- Невдалу спробу не прив'язуємо до provider_payment_id: наступна успішна спроба з тим самим id не повинна впиратися в унікальність.
      values (v_inv.id, v_inv.project_id, 'payment', p_provider, v_inv.amount, v_inv.currency, 'failed', null,
              left('Статус провайдера: ' || coalesce(p_status, '?') || ' (' || coalesce(p_provider_payment_id, '-') || ')', 1000), now());
      v_outcome := 'provider_failed';
    elsif round(p_amount, 2) <> v_remaining or v_remaining <= 0 then
      v_outcome := 'amount_mismatch';
    else
      insert into public.payments (invoice_id, project_id, kind, method, amount, currency, status, provider_payment_id, decided_at)
      values (v_inv.id, v_inv.project_id, 'payment', p_provider, v_remaining, v_inv.currency, 'confirmed', p_provider_payment_id, now())
      on conflict (method, provider_payment_id) do nothing;
      if found then
        v_outcome := 'confirmed';
        perform public.project_log(v_inv.project_id, null, 'system', 'payment_confirmed',
          jsonb_build_object('number', v_inv.number, 'amount', v_remaining, 'currency', v_inv.currency));
      else
        v_outcome := 'duplicate_payment';
      end if;
    end if;
  end if;
  insert into public.payment_events (provider, event_id, invoice_id, outcome, payload)
  values (p_provider, p_event_id, v_inv.id, v_outcome, coalesce(p_payload, '{}'::jsonb));
  return v_outcome;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Права виконання
-- ---------------------------------------------------------------------------
revoke all on function
  public.file_mime_allowed(text),
  public.invoice_paid_raw(uuid),
  public.invoice_payment_state(uuid),
  public.admin_create_deliverable(uuid, text, text, text, text),
  public.admin_update_deliverable(uuid, text, text, text),
  public.admin_submit_deliverable(uuid),
  public.client_decide_deliverable(uuid, text, text),
  public.client_register_file(uuid, text, text, text, bigint, text),
  public.admin_register_file(uuid, text, text, text, bigint, text, boolean, uuid),
  public.attach_files_to_message(bigint, uuid[]),
  public.delete_project_file(uuid),
  public.admin_update_payment_settings(text, text, text, text, text),
  public.client_bank_details(),
  public.admin_create_invoice(uuid, text, numeric, text, date),
  public.admin_create_invoices_from_proposal(uuid),
  public.admin_issue_invoice(uuid, date),
  public.admin_void_invoice(uuid),
  public.client_report_payment(uuid, text),
  public.admin_confirm_payment(uuid, numeric, text),
  public.admin_reject_payment(uuid, text),
  public.admin_record_refund(uuid, numeric, text),
  public.payments_apply_provider_event(text, text, text, numeric, text, text, text, jsonb)
  from public, anon, authenticated;

-- Обгортка з перевіркою власника всередині: доступна лише авторизованим (не anon).
revoke all on function public.invoice_paid_amount(uuid) from public, anon;

grant execute on function
  public.invoice_payment_state(uuid),
  public.admin_create_deliverable(uuid, text, text, text, text),
  public.admin_update_deliverable(uuid, text, text, text),
  public.admin_submit_deliverable(uuid),
  public.client_decide_deliverable(uuid, text, text),
  public.client_register_file(uuid, text, text, text, bigint, text),
  public.admin_register_file(uuid, text, text, text, bigint, text, boolean, uuid),
  public.attach_files_to_message(bigint, uuid[]),
  public.delete_project_file(uuid),
  public.admin_update_payment_settings(text, text, text, text, text),
  public.client_bank_details(),
  public.admin_create_invoice(uuid, text, numeric, text, date),
  public.admin_create_invoices_from_proposal(uuid),
  public.admin_issue_invoice(uuid, date),
  public.admin_void_invoice(uuid),
  public.client_report_payment(uuid, text),
  public.admin_confirm_payment(uuid, numeric, text),
  public.admin_reject_payment(uuid, text),
  public.admin_record_refund(uuid, numeric, text)
  to authenticated;
grant execute on function public.invoice_paid_amount(uuid) to authenticated;
grant execute on function public.payments_apply_provider_event(text, text, text, numeric, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Приватний бакет Storage (без політик: доступ лише через сервер із service_role і підписані посилання)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('project-files', 'project-files', false, 26214400)
    on conflict (id) do update set public = false, file_size_limit = 26214400;
  end if;
end $$;
