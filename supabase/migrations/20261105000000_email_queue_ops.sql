-- BONSI Mail: експлуатація черги. Адитивна міграція; застосовується ПІСЛЯ 20261104000000_audit_hardening.sql.
--  1. email_backfill_order_received: доставляє в чергу підтвердження для заявок, чий лист не потрапив у чергу (збій у момент створення).
--  2. email_queue_stats: зведення черги для адмінпанелі без доступу до адрес і змісту.

create or replace function public.email_backfill_order_received(p_since interval default interval '3 days')
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with ins as (
    insert into public.email_outbox (idempotency_key, template, to_email, to_name, locale, payload, order_id)
    select 'order-received:' || o.ticket_number, 'order_received', lower(btrim(o.email)), left(o.name, 100), 'uk',
           jsonb_build_object('ticket', o.ticket_number), o.id
    from public.orders o
    where o.created_at > now() - p_since
      and o.email is not null and char_length(btrim(o.email)) >= 5
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;

create or replace function public.email_queue_stats()
returns table (status text, total bigint, oldest_due timestamptz, last_error text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.status, count(*), min(e.next_attempt_at) filter (where e.status in ('pending', 'sending')),
         (array_agg(e.last_error order by e.id desc) filter (where e.last_error is not null))[1]
  from public.email_outbox e
  where public.is_admin()
  group by e.status;
$$;

revoke all on function public.email_backfill_order_received(interval), public.email_queue_stats() from public, anon, authenticated;
grant execute on function public.email_backfill_order_received(interval) to service_role;
grant execute on function public.email_queue_stats() to authenticated;
