-- Атомарне створення заявки з обмеженням частоти.
--
-- Проблема «порахувати, потім вставити» з боку застосунку: N паралельних запитів
-- одночасно бачать count < ліміту й усі проходять. Тут перевірка й вставка виконуються
-- в одній транзакції під advisory-блокуванням ключів (IP-підмережа, email), тож
-- ліміт точний навіть під навантаженням.

create or replace function public.create_order(
  p_service                text,
  p_idea                   text,
  p_budget                 text,
  p_deadline               text,
  p_name                   text,
  p_email                  text,
  p_phone                  text,
  p_ip_hash                text,
  p_user_agent             text,
  p_consent_policy_version text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window            constant interval := interval '1 hour';
  v_ip_limit          constant int := 5;    -- заявок/год з однієї IP-підмережі
  v_unknown_ip_limit  constant int := 30;   -- спільний кошик, коли IP невідомий (немає довіреного проксі)
  v_email_limit       constant int := 3;    -- заявок/год з одного email
  v_global_limit      constant int := 200;  -- заявок/год загалом (захист від затоплення бази)
  v_email             text := lower(p_email);
  v_ticket            text;
begin
  -- Завжди беремо блокування в одному порядку (спершу IP, потім email): так не буває взаємоблокувань.
  perform pg_advisory_xact_lock(hashtextextended('bonsi:order:ip:' || coalesce(p_ip_hash, 'unknown'), 0));
  perform pg_advisory_xact_lock(hashtextextended('bonsi:order:email:' || v_email, 0));

  if (
    select count(*) from public.orders
    where ip_hash is not distinct from p_ip_hash
      and created_at > now() - v_window
  ) >= (case when p_ip_hash is null then v_unknown_ip_limit else v_ip_limit end) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.orders
    where email = v_email
      and created_at > now() - v_window
  ) >= v_email_limit then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.orders
    where created_at > now() - v_window
  ) >= v_global_limit then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.orders (
    service, idea, budget, deadline, name, email, phone,
    ip_hash, user_agent, consent_at, consent_policy_version
  ) values (
    p_service, p_idea, p_budget, p_deadline, p_name, v_email, nullif(p_phone, ''),
    p_ip_hash, left(p_user_agent, 300), now(), p_consent_policy_version
  )
  returning ticket_number into v_ticket;

  return v_ticket;
end;
$$;

-- Виклик дозволений лише серверу (service_role); з браузера функція недоступна.
revoke all on function public.create_order(text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_order(text, text, text, text, text, text, text, text, text, text)
  to service_role;
