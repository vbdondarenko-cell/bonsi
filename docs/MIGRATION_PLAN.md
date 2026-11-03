# План застосування міграцій BONSI (V0.5)

> **Статус: міграції НЕ застосовані до production.** Цей документ — підготовлений і перевірений план. Застосування, злиття PR і розгортання
> виконуються лише після окремого дозволу власника. Supabase-проєкт LinkUp цей план не стосується й не змінюється.

Проєкт: **Bonsi** (`bccarmsidlvrqbkikrzt`, eu-west-1, PostgreSQL 17.11). Застосунок V0.5 **вимагає** усі сім міграцій; без `20261110` дії зі списку
(створення рахунків, завдань, передача тощо) безпечно відмовляють (fail-closed), але нові розділи не працюватимуть.

## 1. Поточний стан production (знято лише читанням, 2026-11-03)

| Показник | Значення |
| --- | --- |
| Застосовані міграції (реєстр Supabase) | `20261102121843 client_workspace`, `20261102121853 auth_throttle`, `20261102123611 files_deliverables_payments` |
| Дані | 5 заявок, 2 адміністратори, 0 проєктів, 0 рахунків/платежів, 14 подій заявок |
| Радники безпеки | 0 критичних; 40× «SECURITY DEFINER доступна authenticated» (задумано — кожна функція перевіряє роль сама); 2× INFO «RLS без політик» (`admin_invites`, `auth_throttle` — лише сервіс); 1× WARN «захист від зламаних паролів вимкнено» (дія власника, див. §9) |

**Звірка схеми.** Один і той самий SQL-відбиток виконано на production і на локальній БД з міграціями до `20261103`: колонки (201), обмеження (145),
функції з сигнатурами й `SECURITY DEFINER` (64), індекси (55), політики (21), таблиці з RLS (23), тригери з визначеннями (14) — **усі хеші збігаються**.
Тобто production = локальні міграції до `20261103` без розбіжностей. Перед застосуванням цю звірку треба повторити (§5, крок 0): схема могла змінитися.

## 2. Що саме застосовується

| # | Міграція | Зміст | Нові таблиці | Блокування / ризик | Повторне застосування |
| --- | --- | --- | --- | --- | --- |
| 1 | `20261104000000_audit_hardening` | черга листів `email_outbox`, індекси, функції черги | `email_outbox` | лише `CREATE`; 2 індекси на порожніх/малих таблицях | ✅ безпечно |
| 2 | `20261105000000_email_queue_ops` | діагностика черги листів | — | функції | ✅ |
| 3 | `20261106000000_business_workflow` | `projects.activated_at/by/note`, `invoices.purpose/change_request_id`, `orders.rejection_reason`, документи, версії, рішення, запити на зміни, обсяг робіт; тригер `projects_stage_guard`; обмеження `order_events_type_check` | `change_requests`, `documents`, `document_versions`, `document_decisions`, `project_scope` | `ALTER TABLE … ADD COLUMN` (метадані, миттєво); `ADD CONSTRAINT` перевіряє кілька рядків (14 подій); заповнення `activated_at` **не змінює `updated_at`** (тригер вимикається на час UPDATE) | ✅ |
| 4 | `20261107000000_studio_operations` | завдання, кошториси, витрати, фінансове зведення | `studio_tasks`, `task_comments`, `task_events`, `estimates`, `estimate_lines`, `project_expenses` | лише `CREATE` | ✅ |
| 5 | `20261108000000_delivery_support` | передача проєкту, гарантія, підтримка; `projects.warranty_until`, `project_files.ticket_id`; обмеження шаблонів листів | `handover_records`, `handover_decisions`, `support_tickets`, `support_messages`, `support_events` | `ADD COLUMN` (метадані); заміна `email_outbox_template_check` — повний скан малої таблиці | ✅ |
| 6 | `20261109000000_portfolio` | портфоліо з обов'язковою згодою власника | `portfolio_items` | лише `CREATE` | ✅ |
| 7 | `20261110000000_operations` | `operations` + `run_operation` (атомарна ідемпотентність) | `operations` | лише `CREATE`; **без `DROP`** | ✅ |

Жодна міграція не видаляє й не змінює існуючі дані; `DELETE`/`TRUNCATE`/`DROP` відсутні. Кожна виконується в одній транзакції (`begin … commit`): при збої
стан лишається таким, яким був до цієї міграції.

**Сумісність зі старим кодом (PR #6).** Схема адитивна. Єдина поведінкова зміна — тригер `projects_stage_guard`: проєкти, створені ПІСЛЯ міграції, неактивні,
доки адміністратор не активує їх (`activated_at`); існуючі проєкти активні (`activated_at = created_at`). Старий код при цьому не зламається, але не вміє
активувати нові проєкти — тому відкат КОДУ без відкату схеми допустимий лише до першого нового проєкту.

## 3. Що перевірено (локально, без production)

Усе нижче — автоматизовані тести в репозиторії, виконуються в CI.

| Перевірка | Тест / скрипт | Результат |
| --- | --- | --- |
| Репетиція на схемі «як у production» + дані (3 заявки, 3 проєкти, пропозиція, рахунок, платіж) | `src/lib/workspace/migration-rehearsal.db.test.ts` | 7 міграцій по одній без помилок (≈190 мс сумарно на тестових даних); **вміст усіх початкових колонок усіх 23 таблиць не змінився** (md5 порівняння) |
| Повторне застосування кожної міграції | там само | усі сім проходять без помилок і без змін даних |
| RLS на всіх таблицях | там само | 42/42 таблиці з RLS; `anon` без прав на таблиці; `authenticated` лише `SELECT` |
| `SECURITY DEFINER` | там само | у всіх функцій фіксований `search_path`; 85 функцій, доступних `authenticated`, **усі** містять перевірку доступу в тілі |
| Відкат схеми | `rollback-rehearsal.db.test.ts` | знімок схеми після відкату = до `20261106` (колонки, функції з хешем тіла, обмеження, тригери, індекси, політики, RLS, послідовності); захист від втрати даних; негативний контроль |
| Backup → restore | `scripts/db/backup.sh` + `restore-verify.sh` | дамп відновлено в окрему БД, **47 з 47** відбитків збігаються; скрипт відмовляється відновлювати в `*.supabase.co` і при зіпсованих контрольних сумах |
| Операції (повтори, конкуренція, конфлікти) | `operations.db.test.ts` (15), `operations.test.ts` (7) | див. `docs/STABILITY.md` |

**Чого ця репетиція НЕ доводить.** Вона не виконувалась на реальній копії production-БД (немає рядка підключення й дозволу). Тому перед застосуванням:
знімаємо backup production, відновлюємо його в окремий тестовий проєкт/БД і повторюємо кроки 3–5 на ньому (§5).

## 4. Передумови (від власника)

1. Письмовий дозвіл на застосування міграцій до `bccarmsidlvrqbkikrzt`.
2. Рядок підключення до БД production (Dashboard → Project Settings → Database → Connection string, режим **Session pooler** або Direct) — для `pg_dump`.
   Передається змінною середовища `SOURCE_DATABASE_URL`, у чат/журнали/репозиторій не потрапляє.
3. Окрема **тестова БД** для відновлення backup (інший Supabase-проєкт або локальний PostgreSQL 17). Не LinkUp.
4. Вікно без активної роботи клієнтів не потрібне (усі зміни адитивні й миттєві), але бажано поза робочими годинами.

## 5. Порядок виконання (після дозволу)

**Крок 0. Звірка схеми.** Виконати `scripts/db/fingerprint.sql` на production; порівняти з очікуваним (шість хешів з §1 + `rls`). Розбіжність → зупинка й розбір.

**Крок 1. Backup.**
```bash
SOURCE_DATABASE_URL='postgresql://…' scripts/db/backup.sh backups/pre-v05
```
Створює `bonsi.dump` (формат custom, схеми `public` і `auth`), `schema-public.sql`, `fingerprint.txt`, `SHA256SUMS`. Зберегти каталог поза репозиторієм (не комітити).
Додатково: Supabase Dashboard → Database → Backups (щоденні копії; PITR — залежить від тарифу).

**Крок 2. Перевірка backup.**
```bash
RESTORE_DATABASE_URL='postgresql://…тестова…' scripts/db/restore-verify.sh backups/pre-v05
```
Очікується `OK: відбиток відновленої БД збігається з backup`. Без цього кроку переходити далі **заборонено**.

**Крок 3. Репетиція на відновленій копії.** Застосувати міграції 1–7 до тестової БД з кроку 2, виконати перевірки §6. Заміряти час.

**Крок 4. Застосування до production** (по одній, у порядку нумерації; після кожної — перевірка §6):
- через MCP/Dashboard: `apply_migration` із вмістом файлу, або `supabase db push` (CLI) — реєстр міграцій Supabase збереже версії;
- НЕ `supabase db reset`, НЕ ручні `DROP`.

**Крок 5. Після всіх сімох:** повторний відбиток (§6), радники безпеки (`get_advisors security`), перевірка застосунку в staging/preview, лише потім розгортання (див. `docs/RELEASE_CHECKLIST.md`).

## 6. Перевірки після застосування

```sql
-- 1) Усі нові таблиці існують і з RLS
select count(*) filter (where relrowsecurity), count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r';   -- очікується 42 / 42
-- 2) Дані не змінились
select (select count(*) from public.orders) as orders, (select count(*) from public.admin_users) as admins, (select count(*) from public.projects) as projects;  -- як до міграцій (5 / 2 / 0)
-- 3) Існуючі проєкти активні, якщо вони є
select count(*) from public.projects where activated_at is null;  -- 0 для проєктів, що існували до міграції
-- 4) Захист операцій на місці
select proname from pg_proc where proname = 'run_operation' and pronamespace = 'public'::regnamespace;  -- 1 рядок
-- 5) anon не має прав на таблиці
select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon';  -- 0
-- 6) SECURITY DEFINER без search_path
select p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%');  -- 0 рядків
```
Плюс: `scripts/db/fingerprint.sql` до/після — для таблиць, що існували, `rows` і `md5` мають збігатися (нові колонки змінюють md5 рядка: порівнювати кількість рядків і ключові колонки).

## 7. Відкат

**Основний — відкат коду, схема лишається** (схема адитивна). Розгорнути попередню версію застосунку; нові таблиці не заважають.

**Відкат схеми** (лише якщо потрібно й нові таблиці порожні або дані можна втратити):
- `supabase/rollback/20261106_20261110_rollback.sql` — повертає до стану після `20261105`; відмовляється працювати, якщо в нових таблицях є рядки,
  доки не виконано `set bonsi.allow_data_loss = 'yes';`. Обмеження `order_events_type_check` і `email_outbox_template_check` повертаються як `NOT VALID`
  (наявні рядки з новими значеннями не видаляються).
- `supabase/rollback/20261104_20261105_audit_hardening_rollback.sql` — для міграцій 1–2.
Скрипт відкату `20261106…20261110` генерується `scripts/db/generate_rollback.py`, перевірений тестом (§3).

**Відновлення з backup** — останній засіб: `pg_restore` у НОВИЙ проєкт/БД (не поверх production), перемикання застосунку, лише з дозволу власника.

## 8. Часткова невдача

Кожна міграція — одна транзакція: помилка залишає БД у стані «після попередньої міграції». Дії:
1. Зупинитись, не повторювати наосліп. Зберегти текст помилки (без секретів).
2. Перевірити `select * from supabase_migrations.schema_migrations order by version` і відбиток схеми — що застосовано.
3. Виправити причину (у репозиторії, новий коміт), повторити лише невдалу міграцію (усі міграції повторювані).
4. Якщо стан незрозумілий — відновлення з backup (§7) у новий проєкт для аналізу.

## 9. Дії власника в Supabase Dashboard (не міграції)

- **Authentication → Providers/Password → Leaked password protection** — увімкнути (радник `auth_leaked_password_protection`; може вимагати платний тариф).
- Authentication → Hooks → Send Email Hook та SMTP — див. `docs/MAIL.md`.
- Authentication → Rate limits для листів — узгодити з поштою хостингу.
- Storage: переконатися, що bucket файлів проєктів приватний (перевіряється в релізному чеклисті).

## 10. Категорично заборонено

`supabase db reset` або будь-яке очищення на робочій БД; видалення заявок, клієнтів, платежів чи історії; застосування без дозволу власника;
зміни проєкту Supabase LinkUp; відновлення backup поверх production.

## 11. Факт застосування до production (2026-11-03)

За явним дозволом власника («застосувати зараз без pg_dump») міграції 20261104…20261110 застосовано до проєкту Bonsi
(`bccarmsidlvrqbkikrzt`) по одній через Supabase `apply_migration` (кожна — в окремій транзакції). Версії в
`schema_migrations` мають мітки часу застосування (20261103203232 … 20261103203921), а не імена файлів.

Після застосування: 42 таблиці, 42 з RLS; `anon` без грантів на таблиці; SECURITY DEFINER без `search_path` — 0;
`run_operation` існує. Лічильники даних збігаються з базовими: admin_invites 2, admin_users 2, auth_throttle 7,
order_events 14, order_notes 1, orders 5, payment_settings 1.

Примітки:
- **pg_dump-резервну копію не знято** (за рішенням власника); база — лише лічильники до/після та резервні копії Dashboard.
- Не всі файли міграцій обгорнуті в begin/commit (1104–1108 ні); `apply_migration` виконує кожну в транзакції.
- **Застосунок у production ще старий.** Нова схема + стара версія коду: нові непідтверджені проєкти блокуються stage-guard.
  Потрібен деплой нової версії (після merge PR #6, #7 за окремим дозволом).
- Перед вмиканням поштового cron перевірте, що 5 наявних замовлень — тестові (backfill ставить в чергу order_received).
