-- Відкат 20261105000000_email_queue_ops.sql і 20261104000000_audit_hardening.sql.
-- Виконувати ЛИШЕ вручну, у цьому порядку, після резервної копії (див. docs/MIGRATION_PLAN.md).
-- Міграції лише додавали об'єкти, тож відкат прибирає тільки їх. Дані наявних таблиць (заявки, проєкти, чат, рахунки) не зачіпаються.
-- УВАГА: DROP TABLE email_outbox видаляє чергу листів; перед цим збережіть її: create table public.email_outbox_backup as table public.email_outbox;

begin;

drop function if exists public.email_queue_stats();
drop function if exists public.email_backfill_order_received(interval);

drop function if exists public.email_complete(bigint, text, text, int);
drop function if exists public.email_claim(int);
drop function if exists public.email_enqueue(text, text, text, text, text, jsonb, uuid, uuid);
drop table if exists public.email_outbox;

drop function if exists public.project_invoice_states(uuid);
drop function if exists public.client_unread_counts();

drop index if exists public.project_files_deliverable_idx;
drop index if exists public.payments_project_idx;

-- Реєстр міграцій (якщо застосовували через CLI/MCP): прибрати записи, щоб файли можна було застосувати повторно.
delete from supabase_migrations.schema_migrations where name in ('audit_hardening', 'email_queue_ops');

commit;
