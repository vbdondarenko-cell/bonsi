-- BONSI Studios: закрита реєстрація адміністраторів.
-- Адитивна міграція: нічого не видаляє. Застосовується ЛИШЕ до проєкту Supabase для BONSI.
--
-- Модель: адміністратором стає лише той, чию адресу заздалегідь внесено до `admin_invites`
-- (максимум 2) І хто підтвердив цю пошту листом від Supabase. Тригер на auth.users після
-- підтвердження сам додає користувача в allowlist `admin_users`, тож сайт одразу визнає його
-- адміном. Знання адреси без доступу до її пошти нічого не дає. Сторонні користувачі,
-- навіть якщо створять акаунт через публічний API, в allowlist не потраплять.

create table if not exists public.admin_invites (
  email        text primary key check (email = lower(email) and char_length(email) between 5 and 200),
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at   timestamptz not null default now()
);

alter table public.admin_invites enable row level security;
revoke all on public.admin_invites from anon, authenticated;

-- Не більше двох запрошень: BONSI — студія двох засновників.
create or replace function public.enforce_invite_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.admin_invites where email <> new.email) >= 2 then
    raise exception 'invite_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists admin_invites_limit on public.admin_invites;
create trigger admin_invites_limit
  before insert on public.admin_invites
  for each row execute function public.enforce_invite_limit();

-- Перевірка «чи запрошена адреса» для сервера (реєстрація не розкриває відповідь відвідувачу).
create or replace function public.admin_invite_exists(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admin_invites where email = lower(btrim(p_email)));
$$;

-- Користувач з підтвердженою поштою, запрошений адмін → у allowlist.
create or replace function public.promote_confirmed_invitee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is null or new.email is null then
    return new;
  end if;

  insert into public.admin_users (user_id, email, display_name)
  select new.id, lower(new.email), i.display_name
  from public.admin_invites i
  where i.email = lower(new.email)
  on conflict (user_id) do nothing;

  return new;
exception
  when sqlstate 'P0001' then
    -- ліміт у 2 адміністратори: реєстрацію не ламаємо, але третього не додаємо
    return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.promote_confirmed_invitee();

-- Якщо запрошення додали вже ПІСЛЯ того, як людина підтвердила пошту, підхоплюємо її одразу.
create or replace function public.promote_existing_invitee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_users (user_id, email, display_name)
  select u.id, lower(u.email), new.display_name
  from auth.users u
  where lower(u.email) = new.email and u.email_confirmed_at is not null
  on conflict (user_id) do nothing;
  return new;
exception
  when sqlstate 'P0001' then
    return new;
end;
$$;

drop trigger if exists admin_invites_promote on public.admin_invites;
create trigger admin_invites_promote
  after insert on public.admin_invites
  for each row execute function public.promote_existing_invitee();

revoke all on function public.admin_invite_exists(text), public.promote_confirmed_invitee(),
  public.promote_existing_invitee(), public.enforce_invite_limit()
  from public, anon, authenticated;
grant execute on function public.admin_invite_exists(text) to service_role;
