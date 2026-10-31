# Supabase для BONSI

BONSI використовує **окремий** проєкт Supabase. Проєкти інших продуктів (зокрема LinkUp) не чіпаємо.

1. Створіть новий проєкт у Supabase Dashboard (вручну — це платна дія, її не виконує CI).
2. Застосуйте міграції з `supabase/migrations/` по порядку (SQL Editor або `supabase db push`):
   - `20261031000000_orders.sql` — таблиця `orders`, RLS без політик, відкликані права anon/authenticated;
   - `20261031010000_create_order_function.sql` — атомарна функція `create_order` з лімітами (доступна лише `service_role`).
3. Задайте змінні на хостингу (не в git): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORDER_HASH_SALT` (`openssl rand -hex 32`), `TRUSTED_PROXY`.
4. У `SUPABASE_FORBIDDEN_PROJECT_REFS` внесіть ref сторонніх проєктів, а перед деплоєм запустіть `npm run check:env`.
5. Ключ `service_role` ніколи не використовується в браузері й не має префікса `NEXT_PUBLIC_`.

Ліміти: 5 заявок/год на підмережу IP (30/год спільно, якщо IP невідомий), 3/год на email, 200/год глобально.
Інтеграційні тести SQL: `DATABASE_URL=... ALLOW_DESTRUCTIVE_DB_TEST=1 npm test` (скидає схему `public` — лише на тестовій БД!).
