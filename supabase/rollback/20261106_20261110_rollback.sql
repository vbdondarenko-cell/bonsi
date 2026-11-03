-- BONSI: відкат схеми міграцій 20261106…20261110 (повернення до стану після 20261105). Згенеровано scripts/db/generate_rollback.py.
-- УВАГА: видаляє таблиці й дані, створені цими міграціями (документи, завдання, кошториси, передачі, звернення, портфоліо, операції).
-- Основний сценарій відкату — відкат КОДУ без відкату схеми: схема адитивна й сумісна зі старим кодом (docs/MIGRATION_PLAN.md).
-- Скрипт відмовляється працювати, якщо в нових таблицях є дані, доки явно не підтверджено: set bonsi.allow_data_loss = 'yes';
begin;

do $guard$
declare
  t text;
  n bigint;
  total bigint := 0;
begin
  foreach t in array array['change_requests', 'documents', 'document_versions', 'document_decisions', 'project_scope', 'studio_tasks', 'task_comments', 'task_events', 'estimates', 'estimate_lines', 'project_expenses', 'handover_records', 'handover_decisions', 'support_tickets', 'support_messages', 'support_events', 'portfolio_items', 'operations'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      total := total + n;
    end if;
  end loop;
  if total > 0 and coalesce(current_setting('bonsi.allow_data_loss', true), '') <> 'yes' then
    raise exception 'У нових таблицях % рядків. Відкат видалить їх. Збережіть backup і виконайте: set bonsi.allow_data_loss = ''yes'';', total;
  end if;
end $guard$;

-- 1) Колонки, додані до існуючих таблиць
alter table public.invoices drop constraint if exists invoices_change_request_fk;
alter table public.invoices drop column if exists change_request_id;
alter table public.invoices drop column if exists purpose;
alter table public.orders drop column if exists rejection_reason;
alter table public.project_files drop column if exists ticket_id;
alter table public.projects drop column if exists warranty_until;
drop trigger if exists projects_stage_guard on public.projects;
alter table public.projects drop column if exists activation_note;
alter table public.projects drop column if exists activated_by;
alter table public.projects drop column if exists activated_at;

-- 2) Таблиці (каскадно разом із тригерами, політиками й індексами)
drop table if exists public.operations cascade;
drop table if exists public.portfolio_items cascade;
drop table if exists public.support_events cascade;
drop table if exists public.support_messages cascade;
drop table if exists public.support_tickets cascade;
drop table if exists public.handover_decisions cascade;
drop table if exists public.handover_records cascade;
drop table if exists public.project_expenses cascade;
drop table if exists public.estimate_lines cascade;
drop table if exists public.estimates cascade;
drop table if exists public.task_events cascade;
drop table if exists public.task_comments cascade;
drop table if exists public.studio_tasks cascade;
drop table if exists public.project_scope cascade;
drop table if exists public.document_decisions cascade;
drop table if exists public.document_versions cascade;
drop table if exists public.documents cascade;
drop table if exists public.change_requests cascade;
drop sequence if exists public.support_ticket_seq;

-- 3) Обмеження, змінені міграціями (NOT VALID: наявні рядки з новими значеннями не видаляються, нові рядки підпорядковуються старому правилу)
alter table public.order_events drop constraint if exists order_events_type_check;
alter table public.order_events add constraint order_events_type_check
  check (type in ('created', 'status_changed', 'assigned', 'note_added')) not valid;
alter table public.email_outbox drop constraint if exists email_outbox_template_check;
alter table public.email_outbox add constraint email_outbox_template_check check (template in (
  'order_received', 'login_code', 'cabinet_invite', 'new_message', 'new_proposal',
  'proposal_decision', 'deliverable_decision', 'invoice_issued', 'payment_confirmed', 'project_completed'
)) not valid;

-- 4) Нові функції (усі перевантаження за іменем)
do $drop$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname = any (array['admin_activate_project', 'admin_add_expense', 'admin_comment_task', 'admin_complete_project', 'admin_confirm_portfolio_consent', 'admin_create_change_invoice', 'admin_create_document', 'admin_create_estimate', 'admin_create_task', 'admin_finalize_estimate', 'admin_finance_summary', 'admin_move_task', 'admin_quote_change_request', 'admin_reject_change_request', 'admin_reject_order', 'admin_save_document', 'admin_save_estimate', 'admin_save_handover', 'admin_save_portfolio_item', 'admin_send_document', 'admin_set_change_request_status', 'admin_set_invoice_purpose', 'admin_set_portfolio_status', 'admin_submit_handover', 'admin_ticket_reply', 'admin_ticket_to_change', 'admin_update_task', 'admin_update_ticket', 'admin_void_document', 'attach_files_to_ticket', 'client_close_ticket', 'client_create_ticket', 'client_decide_document', 'client_decide_handover', 'client_requests', 'client_submit_change_request', 'client_ticket_reply', 'client_withdraw_change_request', 'document_version_guard', 'estimate_totals', 'handover_guard', 'looks_like_secret', 'project_activation_status', 'projects_stage_guard', 'run_operation', 'ticket_warranty_state', 'valid_task_checklist', 'valid_task_links'])
  loop
    execute 'drop function if exists ' || r.sig::text;
  end loop;
end $drop$;

-- 5) Перевизначені функції: повертаємо попередні визначення


commit;
