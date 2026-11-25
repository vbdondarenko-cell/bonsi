-- BONSI: облік доходів і витрат для адмінпанелі (калькулятор прибутку).
-- Міграція адитивна: нічого не видаляє й не змінює наявні таблиці.
-- Запис і читання лише через security definer функції з перевіркою is_admin() (MFA, aal2).

create table if not exists public.finance_entries (
  id         uuid primary key default gen_random_uuid(),
  entry_date date not null check (entry_date between date '2020-01-01' and date '2100-01-01'),
  kind       text not null check (kind in ('income', 'expense')),
  category   text not null check (char_length(category) between 1 and 60),
  title      text not null check (char_length(title) between 1 and 160),
  amount     numeric(12, 2) not null check (amount > 0 and amount <= 100000000),
  client     text check (client is null or char_length(client) <= 120),
  note       text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid references public.admin_users (user_id) on delete set null
);

create index if not exists finance_entries_date_idx on public.finance_entries (entry_date desc, created_at desc);

alter table public.finance_entries enable row level security;
revoke all on public.finance_entries from anon, authenticated;

-- Зведення за місяць: записи, підсумки, розбивка за категоріями й динаміка за 6 місяців.
create or replace function public.admin_finance(p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz    constant text := 'Europe/Kyiv';
  v_start date := date_trunc('month', coalesce(p_month, (now() at time zone v_tz)::date))::date;
  v_end   date;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_end := (v_start + interval '1 month')::date;

  return jsonb_build_object(
    'month', v_start,
    'totals', (
      select jsonb_build_object(
        'income',  coalesce(sum(amount) filter (where kind = 'income'), 0),
        'expense', coalesce(sum(amount) filter (where kind = 'expense'), 0)
      ) from public.finance_entries where entry_date >= v_start and entry_date < v_end
    ),
    'by_category', coalesce((
      select jsonb_agg(row_to_json(c) order by c.total desc) from (
        select kind, category, sum(amount) as total, count(*) as n
        from public.finance_entries
        where entry_date >= v_start and entry_date < v_end
        group by kind, category
      ) c
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(row_to_json(e) order by e.entry_date desc, e.created_at desc) from (
        select id, entry_date, kind, category, title, amount, client, note, created_at
        from public.finance_entries
        where entry_date >= v_start and entry_date < v_end
        order by entry_date desc, created_at desc
        limit 500
      ) e
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(row_to_json(h) order by h.month) from (
        select g.m::date as month,
               coalesce(sum(f.amount) filter (where f.kind = 'income'), 0) as income,
               coalesce(sum(f.amount) filter (where f.kind = 'expense'), 0) as expense
        from generate_series(v_start - interval '5 months', v_start, interval '1 month') as g(m)
        left join public.finance_entries f
          on f.entry_date >= g.m::date and f.entry_date < (g.m + interval '1 month')::date
        group by g.m
      ) h
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_add_finance(
  p_kind text,
  p_date date,
  p_category text,
  p_title text,
  p_amount numeric,
  p_client text,
  p_note text
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

  insert into public.finance_entries (kind, entry_date, category, title, amount, client, note, created_by)
  values (p_kind, p_date, p_category, p_title, p_amount, nullif(p_client, ''), nullif(p_note, ''), (select auth.uid()))
  returning id into v_id;
  return v_id;
exception
  when check_violation then
    raise exception 'invalid_entry' using errcode = 'P0001';
end;
$$;

create or replace function public.admin_delete_finance(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.finance_entries where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.admin_finance(date),
  public.admin_add_finance(text, date, text, text, numeric, text, text),
  public.admin_delete_finance(uuid) from public, anon;
grant execute on function public.admin_finance(date),
  public.admin_add_finance(text, date, text, text, numeric, text, text),
  public.admin_delete_finance(uuid) to authenticated;
