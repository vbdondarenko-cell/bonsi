-- BONSI V0.5, фаза 4: портфоліо, яким керує адміністратор.
-- Публікація можлива лише за (1) підтвердженої згоди власника проєкту та (2) ручного підтвердження адміністратором.
-- Публічний сайт читає лише опубліковані записи (серверний service-клієнт); прямого доступу для anon/authenticated немає.
begin;

create table if not exists public.portfolio_items (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title        text not null check (char_length(title) between 3 and 120),
  summary      text not null check (char_length(summary) between 10 and 300),
  task         text not null check (char_length(task) between 10 and 2000),
  result       text not null check (char_length(result) between 10 and 2000),
  stack        text[] not null default '{}' check (cardinality(stack) <= 20),
  product_type text not null check (product_type in ('website', 'web_app', 'mobile', 'other')),
  cover_url    text check (cover_url is null or cover_url ~ '^https://[^\s]+$'),
  cover_alt    text check (cover_alt is null or char_length(cover_alt) <= 200),
  live_url     text check (live_url is null or live_url ~ '^https://[^\s]+$'),
  project_id   uuid references public.projects (id) on delete set null,
  owner_consent_note text check (owner_consent_note is null or char_length(owner_consent_note) between 5 and 500),
  consent_confirmed_by uuid references auth.users (id) on delete set null,
  consent_confirmed_at timestamptz,
  status       text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  version      int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (status <> 'published' or (consent_confirmed_at is not null and published_at is not null))
);
create index if not exists portfolio_items_status_idx on public.portfolio_items (status, published_at desc);

-- Збереження чернетки. Зміна змісту опублікованого запису скидає його в чернетку й знімає згоду: нова редакція потребує нового підтвердження.
create or replace function public.admin_save_portfolio_item(p_id uuid, p_expected int, p_fields jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_row public.portfolio_items;
  v_id uuid;
  v_stack text[];
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}') into v_stack
  from jsonb_array_elements_text(coalesce(f -> 'stack', '[]'::jsonb)) as t(x);

  if p_id is null then
    insert into public.portfolio_items (slug, title, summary, task, result, stack, product_type, cover_url, cover_alt, live_url, project_id)
    values (btrim(f ->> 'slug'), btrim(f ->> 'title'), btrim(f ->> 'summary'), btrim(f ->> 'task'), btrim(f ->> 'result'), v_stack,
            f ->> 'product_type', nullif(btrim(coalesce(f ->> 'cover_url', '')), ''), nullif(btrim(coalesce(f ->> 'cover_alt', '')), ''),
            nullif(btrim(coalesce(f ->> 'live_url', '')), ''), nullif(f ->> 'project_id', '')::uuid)
    returning id into v_id;
    return v_id;
  end if;

  select * into v_row from public.portfolio_items where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_row.version <> p_expected then
    raise exception 'stale' using errcode = 'P0001';
  end if;
  update public.portfolio_items set
    slug = btrim(f ->> 'slug'), title = btrim(f ->> 'title'), summary = btrim(f ->> 'summary'), task = btrim(f ->> 'task'), result = btrim(f ->> 'result'),
    stack = v_stack, product_type = f ->> 'product_type', cover_url = nullif(btrim(coalesce(f ->> 'cover_url', '')), ''),
    cover_alt = nullif(btrim(coalesce(f ->> 'cover_alt', '')), ''), live_url = nullif(btrim(coalesce(f ->> 'live_url', '')), ''),
    project_id = nullif(f ->> 'project_id', '')::uuid,
    status = case when status = 'published' then 'draft' else status end,
    published_at = case when status = 'published' then null else published_at end,
    consent_confirmed_at = case when status = 'published' then null else consent_confirmed_at end,
    consent_confirmed_by = case when status = 'published' then null else consent_confirmed_by end,
    owner_consent_note = case when status = 'published' then null else owner_consent_note end,
    version = version + 1, updated_at = now()
  where id = p_id;
  return p_id;
end;
$$;

-- Підтвердження згоди власника проєкту (адміністратор вказує, як саме згоду отримано).
create or replace function public.admin_confirm_portfolio_consent(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'consent_note_required' using errcode = 'P0001';
  end if;
  update public.portfolio_items
     set owner_consent_note = btrim(p_note), consent_confirmed_by = auth.uid(), consent_confirmed_at = now(), version = version + 1, updated_at = now()
   where id = p_id and status <> 'archived';
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.admin_set_portfolio_status(p_id uuid, p_expected int, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.portfolio_items;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'published', 'archived') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  select * into v_row from public.portfolio_items where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_row.version <> p_expected then
    raise exception 'stale' using errcode = 'P0001';
  end if;
  if p_status = 'published' and v_row.consent_confirmed_at is null then
    raise exception 'consent_required' using errcode = 'P0001';
  end if;
  update public.portfolio_items
     set status = p_status,
         published_at = case when p_status = 'published' then now() else null end,
         version = version + 1, updated_at = now()
   where id = p_id;
end;
$$;

alter table public.portfolio_items enable row level security;
revoke all on public.portfolio_items from anon, authenticated;
grant select on public.portfolio_items to authenticated;
drop policy if exists admin_read_portfolio_items on public.portfolio_items;
create policy admin_read_portfolio_items on public.portfolio_items for select to authenticated using ((select public.is_admin()));

revoke all on function public.admin_save_portfolio_item(uuid, int, jsonb), public.admin_confirm_portfolio_consent(uuid, text), public.admin_set_portfolio_status(uuid, int, text) from public, anon, authenticated;
grant execute on function public.admin_save_portfolio_item(uuid, int, jsonb), public.admin_confirm_portfolio_consent(uuid, text), public.admin_set_portfolio_status(uuid, int, text) to authenticated;

commit;
