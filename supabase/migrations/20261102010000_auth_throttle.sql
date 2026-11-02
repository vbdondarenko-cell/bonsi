-- BONSI V0.4: серверний ліміт спроб входу клієнтів (поверх вбудованих лімітів Supabase Auth).
-- Ключ — солоний HMAC (IP-підмережі або email); сирі адреси не зберігаються. Доступ лише service_role.
create table if not exists public.auth_throttle (
  key          text primary key,
  window_start timestamptz not null default now(),
  hits         int not null default 0
);
alter table public.auth_throttle enable row level security;
revoke all on public.auth_throttle from anon, authenticated;

-- true — спробу дозволено; false — ліміт вичерпано. Атомарна під паралельними запитами (upsert під блокуванням рядка).
create or replace function public.auth_throttle_hit(p_key text, p_limit int, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits int;
begin
  insert into public.auth_throttle as t (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case when t.window_start < now() - p_window then 1 else t.hits + 1 end,
        window_start = case when t.window_start < now() - p_window then now() else t.window_start end
  returning hits into v_hits;
  -- Старі ключі прибираємо опортуністично (без окремого планувальника).
  delete from public.auth_throttle where window_start < now() - interval '2 days';
  return v_hits <= p_limit;
end;
$$;

revoke all on function public.auth_throttle_hit(text, int, interval) from public, anon, authenticated;
grant execute on function public.auth_throttle_hit(text, int, interval) to service_role;
