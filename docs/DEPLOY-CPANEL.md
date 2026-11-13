# Деплой на cPanel + Telegram-сповіщення

> **Головне:** окремий бот писати не потрібно. У репозиторії вже є повна інтеграція:
> заявка → `notification_outbox` у Supabase → `POST /api/internal/notifications` → Telegram.
> Потрібно лише створити бота в @BotFather, заповнити змінні середовища й увімкнути cron.

## 1. Створити бота в Telegram

1. Відкрийте [@BotFather](https://t.me/BotFather) → `/newbot` → назва та username.
2. Скопіюйте **токен** вигляду `1234567890:AAH...` — це `TELEGRAM_BOT_TOKEN`.
3. Напишіть боту `/start` (або додайте його в потрібну групу й напишіть там).
4. Дізнайтеся chat id:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | grep -o '"chat":{"id":[-0-9]*'
```

- особистий чат — додатне число (`123456789`);
- група — від'ємне (`-1001234567890`);
- кілька отримувачів — через кому в `TELEGRAM_CHAT_IDS`.

### Група з гілками (Topics)

Якщо сповіщення мають іти в конкретну гілку форум-групи, вкажіть chat id і thread id через двокрапку:

```env
TELEGRAM_CHAT_IDS=-1001234567890:45
```

- `chat_id` — ID супергрупи (починається з `-100`);
- `message_thread_id` — ID гілки. Дізнатися можна з посилання: відкрийте гілку в Telegram Web, URL виду `https://t.me/c/1234567890/45` → chat id = `-1001234567890`, thread id = `45`;
- альтернатива: зробіть бота адміном групи, напишіть у гілці та викличте `getUpdates` — у відповіді буде `message_thread_id`;
- бот має бути учасником групи (краще адміном, якщо писати дозволено лише адмінам);
- для гілки **General** thread id не вказуйте — Telegram не приймає `message_thread_id` для неї.

Кілька гілок/чатів — через кому: `-1001234567890:45,-1009876543210:12,123456789`.

5. Перевірка доставки:

```bash
curl -s -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -d chat_id=<CHAT_ID> -d text="BONSI: тест"
```

## 2. Supabase

1. Створіть **окремий** проєкт Supabase для BONSI (не використовуйте проєкти інших продуктів).
2. Застосуйте міграції з `supabase/migrations/` **по порядку** (SQL Editor або `supabase db push`). Мінімум для заявок і Telegram:

```
20261031000000_orders.sql
20261031010000_create_order_function.sql
20261101000000_admin_workspace.sql   ← notification_outbox + claim/complete_notification
20261101010000_admin_registration.sql
20261102000000_client_workspace.sql
20261102010000_auth_throttle.sql
20261102020000_project_assignee_name.sql
20261103000000_files_deliverables_payments.sql
20261104000000_audit_hardening.sql
20261105000000_email_queue_ops.sql
20261106000000_business_workflow.sql
20261107000000_studio_operations.sql
20261108000000_delivery_support.sql
20261109000000_portfolio.sql
```

3. Візьміть із **Project Settings → API**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## 3. Змінні середовища

Локально — `.env.local` (не комітити). На cPanel — **Setup Node.js App → Environment variables** (не файл у git).

| Змінна | Обов'язкова | Що вписати |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | так | `https://bonsi.site` (реальний https-домен) |
| `SUPABASE_URL` | так | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | так | service_role ключ (лише сервер!) |
| `SUPABASE_ANON_KEY` | так | anon/publishable ключ (для входу в /admin і /app) |
| `ORDER_HASH_SALT` | так | `openssl rand -hex 32` |
| `TRUSTED_PROXY` | так у production | почніть з `none`; якщо ліміти заявок спрацьовують для всіх одразу — `hops:1` |
| `SUPABASE_FORBIDDEN_PROJECT_REFS` | так у production | ref сторонніх проєктів через кому (напр. `linkup`) |
| `TELEGRAM_BOT_TOKEN` | для бота | токен від @BotFather |
| `TELEGRAM_CHAT_IDS` | для бота | `123456789` або `-100...:45` (чат:гілка) |
| `CRON_SECRET` | для повторів | `openssl rand -hex 32` (мінімум 24 символи) |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | ні | `G-XXXXXXXXXX` |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | ні | код із Google Search Console |
| `NEXT_PUBLIC_LEGAL_NAME` | для /privacy | назва ФОП/ТОВ |
| `NEXT_PUBLIC_CONTACT_EMAIL` | для /privacy | email для звернень |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | ні | листи з черги `email_outbox` |

`NEXT_PUBLIC_*` вшиваються в бандл **під час збірки**: після зміни цих змінних потрібен повторний `build`.

## 4. cPanel: Node.js-застосунок

Потрібен тариф із **Setup Node.js App / Application Manager** і Node.js 20+.

1. **SSL**: увімкніть AutoSSL для домену (інакше Supabase/Telegram можуть відмовляти).
2. **Код**: cPanel → Git™ Version Control → Clone `https://github.com/vbdondarenko-cell/bonsi.git` у теку поза `public_html`, наприклад `/home/USER/bonsi.site`.
3. **Setup Node.js App → Create Application**:
   - Node.js version: **20** або **22**;
   - Application root: `bonsi.site`;
   - Application URL: ваш домен;
   - Application startup file: `server.js`;
   - Application mode: `production`.
4. Додайте всі змінні з таблиці вище (кнопка **Add variable**), зокрема `NODE_ENV=production`.
5. **Run NPM Install** (або `npm ci`).
6. **Run JS script** → `build:standalone` (робить `next build` + копіює статичні файли в `.next/standalone`).
7. **Restart** застосунку. Відкрийте сайт і перевірте форму заявки.

Якщо після деплою немає стилів — повторно виконайте `build:standalone`: скрипт `scripts/prepare-standalone.mjs` копіює `.next/static` у standalone-теку.

### Cron для повторних доставок

Миттєве сповіщення надсилається одразу після заявки. Cron потрібен лише для повторів після збою Telegram.

cPanel → **Cron Jobs** → Once per 5 minutes:

```bash
curl -fsS -X POST https://bonsi.site/api/internal/notifications \
  -H "Authorization: Bearer <CRON_SECRET>" >/dev/null 2>&1
```

Підставте реальний `CRON_SECRET`. Успішна відповідь: `{"disabled":false,"claimed":0,"sent":0,"failed":0}`.

## 5. Перевірка Telegram-інтеграції

1. Напишіть боту `/start`.
2. Надішліть тестову заявку через `/contact`.
3. У Telegram має прийти повідомлення `Нова заявка BON-2026-00001`.
4. Якщо тихо:
   - перевірте, що `TELEGRAM_BOT_TOKEN` і `TELEGRAM_CHAT_IDS` є **в застосунку cPanel**, а не лише в shell;
   - перезапустіть застосунок;
   - у Supabase → Table Editor → `notification_outbox`: `pending` = ще не відправлено, `sent` = доставлено, `dead` = 8 невдалих спроб (дивіться `last_error`);
   - логи: `~/logs/` або `stderr.log` у теці застосунку;
   - викличте cron-URL вручну й подивіться відповідь.

## 6. SEO-чеклист після деплою

- [ ] `NEXT_PUBLIC_SITE_URL` = реальний `https://` домен (canonical, sitemap, OG).
- [ ] Google Search Console: додайте домен, підтвердьте через `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, надішліть `https://bonsi.site/sitemap.xml`.
- [ ] Перевірте `https://bonsi.site/robots.txt` — приватні `/admin`, `/app`, `/api`, `/auth`, `/login` закриті.
- [ ] Rich Results Test для `/`, `/services`, `/faq`, кейсу: мають знайтися Organization, WebSite, Service/OfferCatalog, FAQPage, BreadcrumbList.
- [ ] GA4: перевірте подію `generate_lead` після тестової заявки.
- [ ] Додайте реальні кейси в `/admin/portfolio` (унікальні title/description, стек, результат) — це головний контент для органіки.
- [ ] Заповніть `NEXT_PUBLIC_LEGAL_NAME` і `NEXT_PUBLIC_CONTACT_EMAIL` (E-E-A-T, довіра).
- [ ] Швидкість: увімкніть Cloudflare (безкоштовно) перед cPanel, кеш статики, Brotli/Gzip, HTTP/2.
- [ ] Для локального бізнесу — Google Business Profile; для посилань — профілі на DOU, LinkedIn, Clutch тощо.
