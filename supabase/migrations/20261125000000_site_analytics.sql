-- BONSI: власна аналітика відвідувань і відстежувані посилання (реклама, QR-стікери).
-- Міграція адитивна: нічого не видаляє й не змінює наявні таблиці.
--
-- Приватність: без cookie й без збереження IP. `visitor` — хеш (сіль + доба + IP + User-Agent),
-- який щодоби змінюється, тому окрему людину між днями відстежити неможливо.
--
-- Доступ: запис лише з сервера (service_role); читання й керування посиланнями — лише адміністратор
-- із сесією aal2 (MFA) через security definer функції нижче.

-- ---------------------------------------------------------------------------
-- Відстежувані посилання (QR-коди, рекламні оголошення)
-- ---------------------------------------------------------------------------
create table if not exists public.tracking_links (
  code        text primary key check (code ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name        text not null check (char_length(name) between 1 and 120),
  destination text not null default '/' check (destination ~ '^/[A-Za-z0-9/_\-.~%]*$' and destination !~ '^//'),
  source      text not null check (source ~ '^[a-z0-9][a-z0-9_.-]{0,59}$'),
  medium      text not null check (medium ~ '^[a-z0-9][a-z0-9_.-]{0,59}$'),
  campaign    text check (campaign is null or campaign ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  content     text check (content is null or content ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  note        text check (note is null or char_length(note) <= 500),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.admin_users (user_id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Події: перегляд сторінки, скан/клік по відстежуваному посиланню, заявка
-- ---------------------------------------------------------------------------
create table if not exists public.site_events (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  kind          text not null check (kind in ('pageview', 'scan', 'lead')),
  visitor       text not null check (char_length(visitor) <= 64),
  path          text not null check (char_length(path) <= 200),
  source        text check (source is null or char_length(source) <= 60),
  medium        text check (medium is null or char_length(medium) <= 60),
  campaign      text check (campaign is null or char_length(campaign) <= 80),
  content       text check (content is null or char_length(content) <= 80),
  link_code     text check (link_code is null or char_length(link_code) <= 40),
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 120),
  country       text check (country is null or char_length(country) <= 2),
  device        text check (device is null or device in ('mobile', 'tablet', 'desktop')),
  landing       boolean not null default false
);

create index if not exists site_events_created_idx on public.site_events (created_at desc);
create index if not exists site_events_kind_created_idx on public.site_events (kind, created_at desc);
create index if not exists site_events_link_idx on public.site_events (link_code, created_at desc)
  where link_code is not null;

alter table public.tracking_links enable row level security;
alter table public.site_events enable row level security;
revoke all on public.tracking_links, public.site_events from anon, authenticated;
-- Жодних політик: напряму ці таблиці читає лише service_role (він обходить RLS).

-- ---------------------------------------------------------------------------
-- Звіт для адмінпанелі
-- ---------------------------------------------------------------------------
create or replace function public.admin_analytics(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days  int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz;
  v_tz    constant text := 'Europe/Kyiv';
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- «Сьогодні» — це календарна доба за київським часом, тож 1 день = від сьогоднішньої півночі.
  v_since := (date_trunc('day', now() at time zone v_tz) - make_interval(days => v_days - 1)) at time zone v_tz;

  select jsonb_build_object(
    'days', v_days,
    'since', v_since,
    'totals', (
      select jsonb_build_object(
        'views',    count(*) filter (where kind = 'pageview'),
        'visitors', count(distinct visitor) filter (where kind = 'pageview'),
        'leads',    count(*) filter (where kind = 'lead'),
        'scans',    count(*) filter (where kind = 'scan')
      ) from public.site_events where created_at >= v_since
    ),
    'daily', coalesce((
      select jsonb_agg(row_to_json(d) order by d.day) from (
        select g.day::date as day,
               coalesce(count(e.*) filter (where e.kind = 'pageview'), 0) as views,
               coalesce(count(distinct e.visitor) filter (where e.kind = 'pageview'), 0) as visitors,
               coalesce(count(e.*) filter (where e.kind = 'lead'), 0) as leads
        from generate_series(
               (v_since at time zone v_tz)::date,
               (now() at time zone v_tz)::date,
               interval '1 day'
             ) as g(day)
        left join public.site_events e
          on (e.created_at at time zone v_tz)::date = g.day::date and e.created_at >= v_since
        group by g.day
      ) d
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(row_to_json(s) order by s.visitors desc, s.leads desc) from (
        select coalesce(source, 'direct') as source,
               coalesce(medium, 'none') as medium,
               count(distinct visitor) filter (where kind = 'pageview') as visitors,
               count(*) filter (where kind = 'pageview') as views,
               count(*) filter (where kind = 'lead') as leads
        from public.site_events
        where created_at >= v_since and kind in ('pageview', 'lead')
        group by 1, 2
        order by 3 desc, 5 desc
        limit 30
      ) s
    ), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(row_to_json(c) order by c.visitors desc) from (
        select campaign,
               coalesce(source, 'direct') as source,
               coalesce(medium, 'none') as medium,
               count(distinct visitor) filter (where kind = 'pageview') as visitors,
               count(*) filter (where kind = 'lead') as leads
        from public.site_events
        where created_at >= v_since and kind in ('pageview', 'lead') and campaign is not null
        group by 1, 2, 3
        order by 4 desc
        limit 30
      ) c
    ), '[]'::jsonb),
    'referrers', coalesce((
      select jsonb_agg(row_to_json(r) order by r.visitors desc) from (
        select referrer_host as host, count(distinct visitor) as visitors
        from public.site_events
        where created_at >= v_since and kind = 'pageview' and landing and referrer_host is not null
        group by 1
        order by 2 desc
        limit 20
      ) r
    ), '[]'::jsonb),
    'pages', coalesce((
      select jsonb_agg(row_to_json(p) order by p.views desc) from (
        select path, count(*) as views, count(distinct visitor) as visitors
        from public.site_events
        where created_at >= v_since and kind = 'pageview'
        group by 1
        order by 2 desc
        limit 20
      ) p
    ), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(row_to_json(k) order by k.visitors desc) from (
        select coalesce(country, '??') as country, count(distinct visitor) as visitors
        from public.site_events
        where created_at >= v_since and kind = 'pageview'
        group by 1
        order by 2 desc
        limit 15
      ) k
    ), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(row_to_json(v) order by v.visitors desc) from (
        select coalesce(device, 'desktop') as device, count(distinct visitor) as visitors
        from public.site_events
        where created_at >= v_since and kind = 'pageview'
        group by 1
        order by 2 desc
      ) v
    ), '[]'::jsonb),
    'recent_leads', coalesce((
      select jsonb_agg(row_to_json(l) order by l.created_at desc) from (
        select created_at, coalesce(source, 'direct') as source, coalesce(medium, 'none') as medium, campaign, link_code
        from public.site_events
        where kind = 'lead' and created_at >= v_since
        order by created_at desc
        limit 15
      ) l
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Відстежувані посилання: список із лічильниками, створення, вмикання/вимикання
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_links()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
      select l.code, l.name, l.destination, l.source, l.medium, l.campaign, l.content, l.note, l.active, l.created_at,
             coalesce(s.scans, 0) as scans,
             coalesce(s.scans_30d, 0) as scans_30d,
             coalesce(s.visitors, 0) as visitors,
             coalesce(s.leads, 0) as leads
      from public.tracking_links l
      left join lateral (
        select count(*) filter (where e.kind = 'scan') as scans,
               count(*) filter (where e.kind = 'scan' and e.created_at >= now() - interval '30 days') as scans_30d,
               count(distinct e.visitor) filter (where e.kind = 'pageview') as visitors,
               count(*) filter (where e.kind = 'lead') as leads
        from public.site_events e
        where e.link_code = l.code
      ) s on true
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_create_link(
  p_code text,
  p_name text,
  p_destination text,
  p_source text,
  p_medium text,
  p_campaign text,
  p_content text,
  p_note text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.tracking_links (code, name, destination, source, medium, campaign, content, note, created_by)
  values (
    p_code, p_name, coalesce(nullif(p_destination, ''), '/'), p_source, p_medium,
    nullif(p_campaign, ''), nullif(p_content, ''), nullif(p_note, ''), (select auth.uid())
  );
  return p_code;
exception
  when unique_violation then
    raise exception 'code_taken' using errcode = 'P0001';
  when check_violation then
    raise exception 'invalid_link' using errcode = 'P0001';
end;
$$;

create or replace function public.admin_set_link_active(p_code text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.tracking_links set active = p_active where code = p_code;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.admin_analytics(int), public.admin_list_links(),
  public.admin_create_link(text, text, text, text, text, text, text, text),
  public.admin_set_link_active(text, boolean) from public, anon;
grant execute on function public.admin_analytics(int), public.admin_list_links(),
  public.admin_create_link(text, text, text, text, text, text, text, text),
  public.admin_set_link_active(text, boolean) to authenticated;
