#!/usr/bin/env python3
"""Генерує supabase/rollback/20261106_20261110_rollback.sql: повернення схеми до стану після 20261105.
Тіла перевизначених функцій беруться з попередніх міграцій (остання версія). Запуск: python3 scripts/db/generate_rollback.py"""
import re, glob, os
root = os.path.join(os.path.dirname(__file__), "..", "..")
mdir = os.path.join(root, "supabase", "migrations")
files = sorted(os.path.basename(f) for f in glob.glob(os.path.join(mdir, "*.sql")))
new = [f for f in files if "20261106" <= f[:8] <= "20261110"]
old = [f for f in files if f[:8] < "20261106"]
read = lambda f: open(os.path.join(mdir, f), encoding="utf8").read()
fn_re = re.compile(r"create (?:or replace )?function public\.(\w+)\(", re.I)

def blocks(text):
    """Повертає {ім'я: (початок, кінець)} останніх визначень функцій (з урахуванням $tag$)."""
    out = {}
    for m in fn_re.finditer(text):
        a = m.start()
        d = re.compile(r"\$(\w*)\$").search(text, m.end())
        if not d: continue
        tag = d.group(0)
        close = text.find(tag, d.end())
        end = text.find(";", close) + 1
        out.setdefault(m.group(1), []).append(text[a:end])
    return out

new_fns, old_def = set(), {}
for f in new: new_fns |= set(fn_re.findall(read(f)))
for f in old:
    for name, defs in blocks(read(f)).items(): old_def[name] = defs[-1]
redefined = sorted(n for n in new_fns if n in old_def)
created = sorted(n for n in new_fns if n not in old_def)
tables = []
for f in new: tables += re.findall(r"create table if not exists public\.(\w+)", read(f))
sequences = []
for f in new: sequences += re.findall(r"create sequence if not exists public\.(\w+)", read(f))
data_tables = [t for t in tables]

sql = f"""-- BONSI: відкат схеми міграцій 20261106…20261110 (повернення до стану після 20261105). Згенеровано scripts/db/generate_rollback.py.
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
  foreach t in array array[{", ".join("'"+t+"'" for t in data_tables)}] loop
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
{chr(10).join("drop table if exists public."+t+" cascade;" for t in reversed(tables))}
{chr(10).join("drop sequence if exists public."+s+";" for s in sequences)}

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
            where p.pronamespace = 'public'::regnamespace and p.proname = any (array[{", ".join("'"+n+"'" for n in created)}])
  loop
    execute 'drop function if exists ' || r.sig::text;
  end loop;
end $drop$;

-- 5) Перевизначені функції: повертаємо попередні визначення
{chr(10).join(old_def[n] for n in redefined)}

commit;
"""
out = os.path.join(root, "supabase", "rollback", "20261106_20261110_rollback.sql")
open(out, "w", encoding="utf8").write(sql)
print("created functions:", len(created), "| redefined:", redefined, "| tables:", len(tables), "| sequences:", sequences)
