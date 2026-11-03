-- BONSI Studios: аудит і доопрацювання (адитивна міграція; жодних змін наявних даних).
--  1. Індекси лише там, де є реальні запити (payments за проєктом — RLS і сторінка «Оплата»; файли за результатом етапу).
--  2. Лічильник непрочитаних і стани оплати одним запитом (замість вибірки всіх повідомлень і N+1 RPC).
--  3. Черга листів (EmailService): ідемпотентні ключі, claim зі skip locked, backoff, межа спроб.
--     Листи реально відправляє лише застосунок через налаштованого провайдера; без нього рядки лишаються в черзі.

create index if not exists payments_project_idx on public.payments (project_id, created_at);
create index if not exists project_files_deliverable_idx on public.project_files (deliverable_id) where deliverable_id is not null;

-- ---------------------------------------------------------------------------
-- Непрочитані повідомлення студії по проєктах клієнта
-- ---------------------------------------------------------------------------
create or replace function public.client_unread_counts()
returns table (project_id uuid, unread bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, count(m.id)
  from public.projects p
  left join public.project_message_reads r on r.project_id = p.id and r.reader_role = 'client'
  left join public.project_messages m
         on m.project_id = p.id and m.author_role = 'admin' and m.id > coalesce(r.last_read_id, 0)
  where p.client_id = (select auth.uid())
  group by p.id;
$$;

-- ---------------------------------------------------------------------------
-- Стани оплати рахунків проєкту (та сама логіка, що й invoice_payment_state; лише власник проєкту або адміністратор)
-- ---------------------------------------------------------------------------
create or replace function public.project_invoice_states(p_project uuid)
returns table (invoice_id uuid, state text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id,
         case
           when i.status = 'void' then 'void'
           when public.invoice_paid_raw(i.id) >= i.amount then 'paid'
           when public.invoice_paid_raw(i.id) > 0 then 'partial'
           when exists (select 1 from public.payments p where p.invoice_id = i.id and p.status = 'pending' and p.kind = 'payment') then 'awaiting_confirmation'
           else 'unpaid'
         end
  from public.invoices i
  where i.project_id = p_project
    and ((i.status <> 'draft' and public.is_project_client(i.project_id)) or public.is_admin());
$$;

-- ---------------------------------------------------------------------------
-- Черга листів
-- ---------------------------------------------------------------------------
create table if not exists public.email_outbox (
  id                  bigint generated always as identity primary key,
  idempotency_key     text not null unique check (char_length(idempotency_key) between 8 and 200),
  template            text not null check (template in (
    'order_received', 'login_code', 'cabinet_invite', 'new_message', 'new_proposal',
    'proposal_decision', 'deliverable_decision', 'invoice_issued', 'payment_confirmed', 'project_completed'
  )),
  to_email            text not null check (char_length(to_email) between 5 and 200 and to_email = lower(to_email)),
  to_name             text check (to_name is null or char_length(to_name) <= 100),
  locale              text not null default 'uk' check (locale in ('uk', 'en')),
  -- Лише змінні шаблону (номер звернення, назва, сума). Секретів, кодів входу й посилань із токенами тут немає.
  payload             jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8000),
  project_id          uuid references public.projects (id) on delete set null,
  order_id            uuid references public.orders (id) on delete set null,
  status              text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts            int not null default 0,
  next_attempt_at     timestamptz not null default now(),
  locked_until        timestamptz,
  last_error          text check (last_error is null or char_length(last_error) <= 500),
  provider_message_id text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create index if not exists email_outbox_due_idx on public.email_outbox (status, next_attempt_at);
create index if not exists email_outbox_project_idx on public.email_outbox (project_id) where project_id is not null;

alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;
-- Адміністратор бачить чергу (діагностика доставки), але не змінює її напряму.
grant select (id, template, to_email, status, attempts, next_attempt_at, last_error, created_at, sent_at, project_id, order_id)
  on public.email_outbox to authenticated;
drop policy if exists admin_read_email_outbox on public.email_outbox;
create policy admin_read_email_outbox on public.email_outbox
  for select to authenticated using ((select public.is_admin()));

-- Ідемпотентне додавання: повторний виклик із тим самим ключем повертає наявний запис і нічого не дублює.
create or replace function public.email_enqueue(
  p_key text, p_template text, p_to text, p_name text, p_locale text, p_payload jsonb, p_project uuid, p_order uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.email_outbox (idempotency_key, template, to_email, to_name, locale, payload, project_id, order_id)
  values (p_key, p_template, lower(btrim(p_to)), nullif(left(btrim(coalesce(p_name, '')), 100), ''), coalesce(p_locale, 'uk'),
          coalesce(p_payload, '{}'::jsonb), p_project, p_order)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.email_outbox where idempotency_key = p_key;
  end if;
  return v_id;
end;
$$;

-- Забирає до p_limit листів, що час відправляти (або зависли в sending), і блокує їх на 5 хвилин.
create or replace function public.email_claim(p_limit int default 10)
returns table (id bigint, attempts int, template text, to_email text, to_name text, locale text, payload jsonb, idempotency_key text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Застарілі листи (понад 7 діб у черзі) не відправляємо: «заявку отримано» через тиждень лише шкодить.
  update public.email_outbox e
     set status = 'failed', locked_until = null, last_error = 'expired'
   where e.status in ('pending', 'sending') and e.created_at < now() - interval '7 days';

  return query
  with due as (
    select e.id
    from public.email_outbox e
    where (e.status = 'pending' and e.next_attempt_at <= now())
       or (e.status = 'sending' and e.locked_until < now())
    order by e.next_attempt_at, e.id
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update public.email_outbox e
     set status = 'sending', locked_until = now() + interval '5 minutes', attempts = e.attempts + 1
    from due
   where e.id = due.id
  returning e.id, e.attempts, e.template, e.to_email, e.to_name, e.locale, e.payload, e.idempotency_key;
end;
$$;

-- Результат спроби: успіх -> sent; помилка -> повтор із експоненційною затримкою (1, 2, 4, 8, 16 хв), після p_max спроб -> failed.
create or replace function public.email_complete(p_id bigint, p_error text, p_message_id text, p_max int default 6)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
  v_status text;
begin
  select attempts into v_attempts from public.email_outbox where id = p_id and status = 'sending' for update;
  if not found then
    return 'not_sending';
  end if;
  if p_error is null then
    update public.email_outbox
       set status = 'sent', sent_at = now(), locked_until = null, last_error = null, provider_message_id = left(p_message_id, 200)
     where id = p_id;
    return 'sent';
  end if;
  v_status := case when v_attempts >= p_max then 'failed' else 'pending' end;
  update public.email_outbox
     set status = v_status, locked_until = null, last_error = left(p_error, 500),
         next_attempt_at = now() + (interval '1 minute' * power(2, least(v_attempts - 1, 6)))
   where id = p_id;
  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Права виконання
-- ---------------------------------------------------------------------------
revoke all on function
  public.client_unread_counts(),
  public.project_invoice_states(uuid),
  public.email_enqueue(text, text, text, text, text, jsonb, uuid, uuid),
  public.email_claim(int),
  public.email_complete(bigint, text, text, int)
  from public, anon, authenticated;
grant execute on function public.client_unread_counts(), public.project_invoice_states(uuid) to authenticated;
grant execute on function
  public.email_enqueue(text, text, text, text, text, jsonb, uuid, uuid),
  public.email_claim(int),
  public.email_complete(bigint, text, text, int)
  to service_role;
