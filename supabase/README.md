# Supabase для BONSI

BONSI використовує **окремий** проєкт Supabase. Проєкти інших продуктів (зокрема LinkUp) не чіпаємо.

1. Створіть новий проєкт у Supabase Dashboard (вручну — це платна дія, її не виконує CI).
2. Застосуйте міграції з `supabase/migrations/` по порядку (SQL Editor або `supabase db push`):
   - `20261031000000_orders.sql` — таблиця `orders`, RLS без політик, відкликані права anon/authenticated;
   - `20261031010000_create_order_function.sql` — атомарна функція `create_order` з лімітами (доступна лише `service_role`);
   - `20261101000000_admin_workspace.sql` — адмінпанель: allowlist `admin_users` (максимум 2), `assigned_to`, нотатки, історія змін, outbox сповіщень, RLS з вимогою MFA (aal2), функції керування заявками. Міграція лише додає об'єкти, нічого не видаляє.
3. Задайте змінні на хостингу (не в git): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORDER_HASH_SALT` (`openssl rand -hex 32`), `TRUSTED_PROXY`.
4. У `SUPABASE_FORBIDDEN_PROJECT_REFS` внесіть ref сторонніх проєктів, а перед деплоєм запустіть `npm run check:env`.
5. Ключ `service_role` ніколи не використовується в браузері й не має префікса `NEXT_PUBLIC_`.

Ліміти: 5 заявок/год на підмережу IP (30/год спільно, якщо IP невідомий), 3/год на email, 200/год глобально.
Інтеграційні тести SQL: `DATABASE_URL=... ALLOW_DESTRUCTIVE_DB_TEST=1 npm test` (скидає схему `public` — лише на тестовій БД!).

## Адміністратори (V0.2)

1. Authentication → Providers: вимкніть **Allow new users to sign up** (відкритої реєстрації адмінів немає) і ввімкніть MFA (TOTP).
2. Створіть двох користувачів у Authentication → Users (Invite або Add user).
3. Внесіть їх в allowlist (SQL Editor):
   `insert into public.admin_users (user_id, display_name) values ('<uuid-1>', 'Ім''я 1'), ('<uuid-2>', 'Ім''я 2');`
   Тригер не дозволить додати третього.
4. Задайте `SUPABASE_ANON_KEY` разом з `SUPABASE_URL` та `SUPABASE_SERVICE_ROLE_KEY`. Під час першого входу `/admin/settings` запропонує підключити TOTP; без другого фактора RLS не віддає заявки.
5. Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS`, `CRON_SECRET`. Для повторних спроб налаштуйте зовнішній cron, що раз на хвилину викликає `POST /api/internal/notifications` із заголовком `Authorization: Bearer $CRON_SECRET`.
