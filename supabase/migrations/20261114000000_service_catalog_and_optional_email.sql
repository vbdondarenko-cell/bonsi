-- BONSI public offer refresh: additional service types, new budget bands,
-- optional email, and a required alternate contact (phone or Telegram handle).
-- Existing orders remain valid; nullable email only affects newly submitted orders.

alter table public.orders alter column email drop not null;

alter table public.orders drop constraint if exists orders_service_check;
alter table public.orders add constraint orders_service_check check (service in (
  'landing', 'visiting', 'corporate', 'redesign', 'shop', 'webapp',
  'telegram', 'mobile', 'design', 'support'
));

alter table public.orders drop constraint if exists orders_phone_check;
alter table public.orders add constraint orders_phone_check
  check (
    phone is null or (
      char_length(phone) <= 40
      and (
        phone ~ '^@[A-Za-z0-9_]{5,32}$'
        or (phone ~ '^[0-9+(). -]{6,40}$' and phone ~ '[0-9]')
      )
    )
  ) not valid;

alter table public.orders drop constraint if exists orders_contact_check;
alter table public.orders add constraint orders_contact_check
  check (email is not null or phone is not null);

alter table public.orders drop constraint if exists orders_budget_check;
alter table public.orders add constraint orders_budget_check check (budget is null or budget in (
  'lt-3000', '3000-5000', '5000-10000', '10000-20000', '20000-50000', 'gt-50000', 'discuss',
  -- Preserve existing orders and the older service-to-database API.
  'lt-50k', '50-150k', '150-400k', 'gt-400k'
));

create or replace function public.create_order_v2(
  p_service                text,
  p_idea                   text,
  p_budget                 text,
  p_deadline               text,
  p_name                   text,
  p_email                  text,
  p_phone                  text,
  p_details                jsonb,
  p_links                  text[],
  p_ip_hash                text,
  p_user_agent             text,
  p_consent_policy_version text,
  p_notify                 boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window            constant interval := interval '1 hour';
  v_ip_limit          constant int := 5;
  v_unknown_ip_limit  constant int := 30;
  v_email_limit       constant int := 3;
  v_global_limit      constant int := 200;
  v_email             text := nullif(lower(btrim(p_email)), '');
  v_phone             text := nullif(btrim(p_phone), '');
  v_ticket            text;
  v_id                uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('bonsi:order:ip:' || coalesce(p_ip_hash, 'unknown'), 0));
  if v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended('bonsi:order:email:' || v_email, 0));
  end if;

  if (
    select count(*) from public.orders
    where ip_hash is not distinct from p_ip_hash and created_at > now() - v_window
  ) >= (case when p_ip_hash is null then v_unknown_ip_limit else v_ip_limit end) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if v_email is not null and (
    select count(*) from public.orders where email = v_email and created_at > now() - v_window
  ) >= v_email_limit then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if (select count(*) from public.orders where created_at > now() - v_window) >= v_global_limit then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.orders (
    service, idea, budget, deadline, name, email, phone, details, links,
    ip_hash, user_agent, consent_at, consent_policy_version
  ) values (
    p_service, nullif(btrim(p_idea), ''), nullif(p_budget, ''), nullif(p_deadline, ''), p_name, v_email, v_phone,
    coalesce(p_details, '{}'::jsonb), coalesce(p_links, '{}'),
    p_ip_hash, left(p_user_agent, 300), now(), p_consent_policy_version
  )
  returning id, ticket_number into v_id, v_ticket;

  insert into public.order_events (order_id, actor_id, type) values (v_id, null, 'created');
  if p_notify then
    insert into public.notification_outbox (order_id, channel) values (v_id, 'telegram');
  end if;
  return v_ticket;
end;
$$;

revoke all on function public.create_order_v2(text, text, text, text, text, text, text, jsonb, text[], text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.create_order_v2(text, text, text, text, text, text, text, jsonb, text[], text, text, text, boolean)
  to service_role;
