-- BONSI V0.5: атомарне, ідемпотентне виконання неідемпотентних операцій (адмін і клієнт).
--
-- Проблема: «захопити ідентифікатор», «виконати бізнес-зміну» і «зберегти результат» були окремими запитами. Збій між ними
-- залишав або втрачену операцію, або подвійне виконання.
--
-- Рішення: одна функція run_operation виконує все В ОДНІЙ ТРАНЗАКЦІЇ PostgreSQL:
--   1) вставка (op_id, актор, функція, відбиток аргументів) — первинний ключ серіалізує паралельні запити;
--   2) виклик дозволеної бізнес-функції;
--   3) збереження результату.
-- Стани:
--   * нова операція          -> виконується, результат зберігається (completed), replayed = false
--   * повтор (таймаут, подвійний клік, перезапуск сервера, паралельний дубль) -> другий запит чекає на перший (блокування ключа),
--     потім отримує ЗБЕРЕЖЕНИЙ результат, replayed = true; бізнес-функція вдруге не викликається
--   * помилка бізнес-функції -> уся транзакція відкочується разом із записом операції: нічого не збережено, повтор з тим самим
--     ідентифікатором безпечний (failed)
--   * той самий ідентифікатор з іншою функцією, іншими аргументами або іншим користувачем -> operation_conflict (результат не віддається)
-- Проміжного стану «pending» у БД немає за побудовою: незавершена транзакція не залишає слідів.
-- Записи не видаляються автоматично (кілька байтів на дію), щоб пізній повтор не виконав дію вдруге.
begin;

drop function if exists public.admin_claim_operation(uuid, text);
drop function if exists public.admin_release_operation(uuid);
drop table if exists public.admin_operations;

create table if not exists public.operations (
  op_id       uuid primary key,
  actor_id    uuid not null references auth.users (id) on delete restrict,
  role        text not null check (role in ('admin', 'client')),
  fn          text not null check (char_length(fn) between 1 and 80),
  fingerprint text not null check (char_length(fingerprint) = 64),
  result      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists operations_actor_idx on public.operations (actor_id, created_at desc);

alter table public.operations enable row level security;
revoke all on public.operations from anon, authenticated;

create or replace function public.run_operation(p_op uuid, p_fn text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_admin constant text[] := array[
    'admin_add_note', 'admin_send_message', 'admin_add_internal_note', 'admin_create_proposal', 'admin_send_proposal',
    'admin_create_deliverable', 'admin_submit_deliverable', 'admin_create_invoices_from_proposal', 'admin_create_invoice',
    'admin_issue_invoice', 'admin_void_invoice', 'admin_confirm_payment', 'admin_reject_payment', 'admin_record_refund',
    'admin_activate_project', 'admin_reject_order', 'admin_create_document', 'admin_send_document', 'admin_void_document',
    'admin_quote_change_request', 'admin_reject_change_request', 'admin_create_change_invoice', 'admin_set_change_request_status',
    'admin_create_task', 'admin_comment_task', 'admin_create_estimate', 'admin_add_expense', 'admin_finalize_estimate',
    'admin_submit_handover', 'admin_complete_project', 'admin_ticket_reply', 'admin_ticket_to_change',
    'admin_save_portfolio_item', 'admin_confirm_portfolio_consent', 'admin_set_portfolio_status'
  ];
  c_client constant text[] := array[
    'client_send_message', 'client_report_payment', 'client_submit_change_request', 'client_withdraw_change_request',
    'client_decide_proposal', 'client_decide_document', 'client_decide_deliverable', 'client_decide_handover',
    'client_create_ticket', 'client_ticket_reply', 'client_close_ticket'
  ];
  v_uid         uuid := auth.uid();
  v_role        text;
  v_fingerprint text;
  v_rows        int;
  v_existing    public.operations;
  v_args        text;
  v_ret         oid;
  v_matches     int;
  v_result      jsonb;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_op is null then
    raise exception 'operation_id_required' using errcode = 'P0001';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'operation_args_invalid' using errcode = 'P0001';
  end if;

  if p_fn = any (c_admin) then
    if not public.is_admin() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_role := 'admin';
  elsif p_fn = any (c_client) then
    v_role := 'client';
  else
    raise exception 'operation_not_allowed' using errcode = 'P0001';
  end if;

  if exists (select 1 from jsonb_object_keys(p_args) k where k !~ '^p_[a-z0-9_]{1,60}$') then
    raise exception 'operation_args_invalid' using errcode = 'P0001';
  end if;

  v_fingerprint := encode(sha256(convert_to(p_fn || ':' || p_args::text, 'UTF8')), 'hex');

  insert into public.operations (op_id, actor_id, role, fn, fingerprint)
  values (p_op, v_uid, v_role, p_fn, v_fingerprint)
  on conflict (op_id) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    -- Повтор. Якщо перша транзакція ще виконується, ми дійшли сюди лише після її завершення (блокування ключа).
    select * into v_existing from public.operations where op_id = p_op;
    if not found then
      raise exception 'operation_state_unknown' using errcode = 'P0001';
    end if;
    if v_existing.actor_id <> v_uid or v_existing.fn <> p_fn or v_existing.fingerprint <> v_fingerprint then
      raise exception 'operation_conflict' using errcode = 'P0001';
    end if;
    return jsonb_build_object('replayed', true, 'result', v_existing.result);
  end if;

  select count(*), max(p.prorettype::oid) into v_matches, v_ret
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_fn;
  if v_matches <> 1 then
    raise exception 'operation_not_allowed' using errcode = 'P0001'; -- відкочує запис операції
  end if;

  select string_agg(format('%I => %L', e.key, case jsonb_typeof(e.value) when 'null' then null when 'string' then e.value #>> '{}' else e.value::text end), ', ' order by e.key)
    into v_args from jsonb_each(p_args) e;

  if v_ret = 'pg_catalog.void'::regtype::oid then
    execute format('select public.%I(%s)', p_fn, coalesce(v_args, ''));
    v_result := null;
  else
    execute format('select to_jsonb(public.%I(%s))', p_fn, coalesce(v_args, '')) into v_result;
  end if;

  update public.operations set result = v_result where op_id = p_op;
  return jsonb_build_object('replayed', false, 'result', v_result);
end;
$$;

revoke all on function public.run_operation(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.run_operation(uuid, text, jsonb) to authenticated;

commit;
