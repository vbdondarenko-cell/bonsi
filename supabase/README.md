# Supabase для BONSI

BONSI використовує **окремий** проєкт Supabase. Проєкти інших продуктів (зокрема LinkUp) не чіпаємо.

1. Створіть новий проєкт у Supabase Dashboard (вручну — це платна дія, її не виконує CI).
2. Застосуйте міграції з `supabase/migrations/` по порядку (SQL Editor або `supabase db push`):
   - `20261031000000_orders.sql` — таблиця `orders`, RLS без політик, відкликані права anon/authenticated;
   - `20261031010000_create_order_function.sql` — атомарна функція `create_order` з лімітами (доступна лише `service_role`);
   - `20261101000000_admin_workspace.sql` — адмінпанель: allowlist `admin_users` (максимум 2), `assigned_to`, нотатки, історія змін, outbox сповіщень, RLS з вимогою MFA (aal2), функції керування заявками. Міграція лише додає об'єкти, нічого не видаляє.
   - `20261101010000_admin_registration.sql` — закрита реєстрація адміністраторів;
   - `20261102000000_client_workspace.sql` (V0.4) — клієнти, проєкти, етапи, чат, внутрішні нотатки, комерційні пропозиції, журнал погоджень, `create_order_v2` (необов'язкові поля), RLS і функції; міграція адитивна, наявні заявки лишаються чинними;
   - `20261102010000_auth_throttle.sql` — ліміти спроб входу;
   - `20261102020000_project_assignee_name.sql` — ім'я виконавця для клієнта без доступу до `admin_users`;
   - `20261103000000_files_deliverables_payments.sql` (етап 2) — результати етапів із погодженнями, приватні файли й бакет `project-files`, рахунки, журнал оплат, ідемпотентна обробка подій провайдера.
3. Задайте змінні на хостингу (не в git): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORDER_HASH_SALT` (`openssl rand -hex 32`), `TRUSTED_PROXY`.
4. У `SUPABASE_FORBIDDEN_PROJECT_REFS` внесіть ref сторонніх проєктів, а перед деплоєм запустіть `npm run check:env`.
5. Ключ `service_role` ніколи не використовується в браузері й не має префікса `NEXT_PUBLIC_`.

Ліміти: 5 заявок/год на підмережу IP (30/год спільно, якщо IP невідомий), 3/год на email, 200/год глобально.
Інтеграційні тести SQL: `DATABASE_URL=... ALLOW_DESTRUCTIVE_DB_TEST=1 npm test` (скидає схему `public` — лише на тестовій БД!).

## Адміністратори (V0.2): закрита реєстрація

Реєстрація доступна лише запрошеним адресам і тільки з підтвердженням пошти; після підтвердження сайт сам додає людину в `admin_users`.

1. Застосуйте міграції (разом із `20261101010000_admin_registration.sql`).
2. Authentication → Sign In / Providers → Email: увімкніть **Confirm email**; Allow new users to sign up має бути **увімкнено** (інакше реєстрація не спрацює; безпеку тримає список запрошень, а не вимкнена реєстрація). Authentication → URL Configuration: Site URL = адреса сайту, у Redirect URLs додайте `<адреса сайту>/admin/login`. Ввімкніть MFA (TOTP).
3. Внесіть запрошення (SQL Editor, максимум 2):
   `insert into public.admin_invites (email, display_name) values ('email1@...', 'Ім''я 1'), ('email2@...', 'Ім''я 2');` (email малими літерами).
4. Кожен із двох відкриває `/admin/register`, вказує email і пароль (від 12 символів), підтверджує пошту листом і входить на `/admin/login`; при першому вході підключає TOTP.
5. Змінні: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`. Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS`, `CRON_SECRET` + зовнішній cron на `POST /api/internal/notifications` з `Authorization: Bearer $CRON_SECRET`.

Сторонні люди можуть створити акаунт Supabase через публічний API, але без запрошення в `admin_invites` вони не потраплять в `admin_users`, а RLS не віддає їм жодних даних.
