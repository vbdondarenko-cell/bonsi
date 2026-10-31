-- BONSI Studios: таблиця заявок (етап 1 — публічний сайт і приймання заявок).
-- Застосовується ЛИШЕ до окремого проєкту Supabase для BONSI.
-- Доступ тільки через сервер (service_role). RLS увімкнено без політик:
-- ролі anon/authenticated не мають жодного доступу до таблиці.

create sequence if not exists public.order_ticket_seq;

create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default (
    'BON-' || to_char(now() at time zone 'utc', 'YYYY') || '-' ||
    lpad(nextval('public.order_ticket_seq')::text, 5, '0')
  ),
  service       text not null check (service in (
    'landing', 'corporate', 'shop', 'webapp', 'mobile', 'design', 'support'
  )),
  idea          text not null check (char_length(idea) between 20 and 3000),
  budget        text not null check (budget in (
    'lt-50k', '50-150k', '150-400k', 'gt-400k', 'discuss'
  )),
  deadline      text not null check (deadline in (
    'asap', '1-month', '1-3-months', 'flexible'
  )),
  name          text not null check (char_length(name) between 2 and 100),
  email         text not null check (char_length(email) between 5 and 200 and email = lower(email)),
  phone         text check (phone is null or char_length(phone) <= 30),
  status        text not null default 'new' check (status in (
    'new', 'in_review', 'accepted', 'in_progress', 'done', 'rejected'
  )),
  -- Антиспам: солоний HMAC підмережі IP (сам IP не зберігається) і user-agent.
  ip_hash       text,
  user_agent    text,
  -- Підтвердження згоди на обробку персональних даних.
  consent_at             timestamptz not null,
  consent_policy_version text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists orders_ip_hash_created_at_idx
  on public.orders (ip_hash, created_at desc);
create index if not exists orders_email_created_at_idx
  on public.orders (email, created_at desc);
create index if not exists orders_status_created_at_idx
  on public.orders (status, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.orders enable row level security;

revoke all on public.orders from anon, authenticated;
revoke all on sequence public.order_ticket_seq from anon, authenticated;
