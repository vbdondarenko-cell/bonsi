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

## V0.4: кабінет клієнта (Client Workspace)

Клієнт виконує більшість дій щодо замовлення всередині BONSI: заявка → вхід без пароля → проєкт → чат зі студією → комерційна пропозиція з версіями й журналом погоджень. Адмінпанель розширено, а не переписано.

**Що працює (етап 1: авторизація, дашборд і проєкти, чат, пропозиції та погодження)**

| Маршрут | Призначення |
| --- | --- |
| `/contact?service=shop` | Заявка з уже обраною послугою; показує лише уточнення цієї послуги; опис, бюджет, терміни, посилання — необов'язкові; акаунт не потрібен |
| `/login`, `/auth/confirm` | Вхід за одноразовим кодом (OTP) або Magic Link; пароль не створюється |
| `/app`, `/app/projects`, `/app/projects/[id]` | Дашборд, мої проєкти, огляд проєкту: наступна дія, етапи (прогрес = реально завершені етапи), історія подій, виконавець |
| `/app/projects/[id]/messages` | Чат проєкту: історія, статуси прочитання, автооновлення |
| `/app/projects/[id]/proposal` | Комерційна пропозиція: версії, графік платежів, «Погодити» / «Попросити змін», журнал рішень |
| `/app/profile`, `/app/support` | Профіль, завершення інших сесій, підтримка |
| `/admin/projects`, `/admin/projects/[id]`, `/admin/clients` | Проєкти, чат, внутрішні нотатки (клієнт їх не бачить), керування етапами, редактор пропозицій (графіки 30/40/30, 50/50, індивідуальний), журнал погоджень |

**Безпека.** Ролі розділені на сервері (`requireClient` / `requireAdmin`) і в RLS (`projects.client_id = auth.uid()`, адміністратор — `is_admin()` з MFA aal2). Записів напряму з браузера немає: усе через `security definer`-функції, що самі перевіряють належність проєкту. Журнал погоджень і повідомлення — append-only (тригер); надіслана пропозиція незмінна (нова версія замість правки). Вхід: ліміти спроб у БД (`auth_throttle_hit`), однакові відповіді для нових і наявних адрес, `safeNext` проти open redirect.

**Ще не реалізовано (наступні етапи, у кабінеті позначено «скоро»):** файли й приватне сховище, вкладення в чаті, дизайн-рев'ю й прев'ю, рахунки й облік оплат (банківські реквізити з ручною перевіркою), абстракція платіжного провайдера та webhooks (monobank/LiqPay) — лише після отримання реквізитів і доступів. Онлайн-еквайринг не активний, статус «Оплачено» ніде не імітується. Сповіщення про нові повідомлення поки лише в інтерфейсі (лічильник непрочитаних).

### Налаштування Supabase Auth для кабінету клієнта

1. Authentication → Providers → Email: увімкніть **Email OTP** і дозвольте реєстрацію (`Enable email signups`): акаунти клієнтів створюються при першому вході. Доступ до адмінпанелі це не відкриває: він вимагає allowlist `admin_users` + MFA (aal2), а клієнтські політики дають лише власні проєкти.
2. Шаблон листа «Magic Link» має містити і код, і посилання: `{{ .Token }}` та `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`. Те саме для «Confirm signup».
3. Redirect URLs: додайте `<SITE_URL>/auth/confirm`.
4. Змінні середовища: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (лише сервер; потрібен для лімітів входу й заявок), `ORDER_HASH_SALT`, `TRUSTED_PROXY`, `NEXT_PUBLIC_SITE_URL`.

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
