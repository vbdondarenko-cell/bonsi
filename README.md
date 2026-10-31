# BONSI Studios

Сайт студії BONSI: публічні сторінки та приймання заявок із збереженням у PostgreSQL (Supabase).

**Дизайн:** [Figma — BONSI Studios, Design System & Screens](https://www.figma.com/design/TiIsl29Ygor9mLMYmuCBuJ) (токени, текстові стилі, компоненти, Home для Desktop/Tablet/Mobile).

**Стек:** Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · Motion · Zod · Supabase · Vitest.

## Статус перевірок

CI (GitHub Actions) виконує `npm ci`, lint, typecheck, unit/DB-тести (PostgreSQL 16), production build та e2e (Playwright: Chromium, Firefox, WebKit; ширини 320/375/768/1024/1440; axe a11y). Результати публікуються коментарем у PR.

Конфігурація безпеки: `TRUSTED_PROXY` (none | vercel | cloudflare | hops:N) визначає, чи довіряти проксі-заголовкам для IP; без довіреного проксі заголовки ігноруються. Див. `.env.example`, `supabase/README.md`, `npm run check:env`.

## Запуск

```bash
cp .env.example .env.local   # заповніть значення
npm install
npm run dev
```

### Змінні середовища

| Змінна | Призначення |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Публічна адреса сайту (metadataBase, sitemap, Open Graph) |
| `SUPABASE_URL` | URL проєкту Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Ключ service_role — **лише на сервері**, ніколи не комітити |
| `ORDER_HASH_SALT` | Сіль для хешування IP (`openssl rand -hex 32`) |

Без `SUPABASE_*` та `ORDER_HASH_SALT` форма чесно повертає помилку «приймання тимчасово недоступне» — успіх не імітується.

### База даних

Міграція: `supabase/migrations/20261031000000_orders.sql`. Застосуйте її до **окремого** проєкту Supabase для BONSI (через Supabase CLI `supabase db push` або SQL Editor). Таблиця `orders` має RLS без політик: доступ мають лише серверні запити із service_role.

## Приймання заявок

`POST /api/orders` (`src/app/api/orders/route.ts`):

1. перевірка `Origin` проти `Host`, ліміт розміру тіла;
2. серверна валідація Zod-схемою (`src/lib/orders/schema.ts`, спільна з клієнтом);
3. антиспам: honeypot-поле, мінімальний час заповнення (3 с), ліміт 5 заявок/год з однієї IP (зберігається лише солоний хеш);
4. запис у `orders`, відповідь `201 { ticket: "BON-2026-00001" }`;
5. помилки: `400` валідація, `403` чужий Origin, `413` завеликий запит, `429` ліміт, `503` не налаштовано, `500` збій БД.

## Структура

```
src/app/            маршрути: /, /services, /portfolio(/[slug]), /about, /contact, /api/orders
src/components/     ui/ (кнопки, toast, skeleton, empty state), layout/, sections/, order-form
src/lib/            site, services, cases, team, orders/ (options, schema, service)
supabase/migrations SQL-міграції
```

## Контент, який потрібно додати вручну

- **Кейси** — `src/lib/cases.ts` (масив порожній; сторінка показує порожній стан). Додавайте лише реальні проєкти.
- **Команда** — `src/lib/team.ts` (імена, ролі, фото).
- **Політика конфіденційності** — сторінки поки немає; форма містить лише чекбокс згоди.
- **Open Graph зображення** — не додано; покладіть `opengraph-image.png` (1200×630) у `src/app/`.

## Дорожня карта

1. ✅ Публічний сайт і приймання заявок (ця гілка).
2. ✅ Адмінпанель `/admin` (V0.2, гілка `feat/admin-workspace`): Supabase Auth + MFA, список/деталі заявок, статуси, призначення, нотатки, історія, Telegram-сповіщення. Налаштування: `supabase/README.md`.
3. ⏭ Клієнтський кабінет (файли, повідомлення) — пізніше.
4. ⏭ Публікація в production — лише після окремого погодження.
