# План міграцій `20261104000000_audit_hardening` + `20261105000000_email_queue_ops`

Стан: **не застосовано до робочого Supabase (проєкт Bonsi, ref `bccarmsidlvrqbkikrzt`).** Застосування — лише після окремого дозволу власника. LinkUp не зачіпається.

## Що перевірено
| Перевірка | Результат |
|---|---|
| Чиста локальна БД: усі міграції по порядку + 32 DB-тести (`audit.db.test.ts`) | пройдено |
| Локальний Supabase у CI (`supabase start` застосовує всі міграції) + admin/client E2E | пройдено |
| Зняття схеми робочого проєкту (read-only): функції public (59), 23 таблиці (колонки, типи, кількість політик та індексів) порівняно з міграціями ≤ `20261103` | **розбіжностей немає** |
| На копії схеми робочого проєкту з даними: застосування обох міграцій, повторне застосування, відкат | дані не змінились (заявки, події, проєкти), повторне застосування ідемпотентне, відкат прибирає всі нові обʼєкти |
| Робочий проєкт на момент перевірки: нових обʼєктів немає (`email_outbox`, нові функції, індекси відсутні) — невдала спроба застосування нічого не залишила | підтверджено |

Реєстр міграцій у робочому проєкті містить лише 3 записи (`client_workspace`, `auth_throttle`, `files_deliverables_payments`); ранні міграції (orders, admin_*, assignee) застосовано іншим шляхом, схема від цього не відрізняється. Вирівнювання реєстру — лише метадані: `supabase migration repair --status applied <версія>`; `supabase db reset` не виконується ніколи.

## Склад (лише додавання, нічого не видаляється й не переписується)
- 2 індекси (`payments_project_idx`, `project_files_deliverable_idx`) — `create index if not exists`; на малих таблицях блокування мізерне.
- Функції `client_unread_counts`, `project_invoice_states` (доступні `authenticated`, доступ по власнику/адміну всередині).
- Таблиця `email_outbox` (RLS увімкнено, браузерним ролям лише вибірка колонок для адміна) і `email_enqueue/claim/complete`, `email_backfill_order_received`, `email_queue_stats` (лише `service_role`, окрім `email_queue_stats` — адмін).

## Порядок застосування
1. **Резервна копія** (за дозволу): Supabase Dashboard → Database → Backups (PITR/щоденна копія) + логічний дамп схеми й даних: `pg_dump --schema=public --no-owner "$DATABASE_URL" > bonsi-before-20261104.sql` (рядок підключення — з Dashboard, не зберігати в git).
2. Перевірити, що нових обʼєктів немає (запит із розділу вище) і що в черзі немає активних робіт.
3. Застосувати `20261104000000_audit_hardening.sql`, потім `20261105000000_email_queue_ops.sql` (Dashboard → SQL Editor або `supabase db push`/MCP `apply_migration`).
4. Перевірки після застосування: `select count(*) from public.email_outbox;` (0), `select * from public.client_unread_counts();` від імені клієнта, `get_advisors(security)` — нових WARN, окрім відомих 40 `authenticated_security_definer_function_executable` (навмисні, перевірка ролі всередині), немає.
5. Лише потім розгортати код PR (код без міграції не ламається: збій черги логується й не блокує заявки; сторінки чату/рахунків користуються новими функціями, тож міграцію застосовують **до** деплою).

## Відкат
`supabase/rollback/20261104_20261105_audit_hardening_rollback.sql` (виконувати вручну, у транзакції). Спершу зберегти чергу: `create table public.email_outbox_backup as table public.email_outbox;`. Дані клієнтів не зачіпаються. Якщо код уже розгорнуто, відкат міграції ламає чат/рахунки — спершу відкотити деплой.
