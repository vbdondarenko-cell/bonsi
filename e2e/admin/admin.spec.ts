import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  CRON_SECRET,
  db,
  ensureAccounts,
  founder1,
  founder2,
  login,
  outsider,
  stub,
  uniqueEmail,
  waitForTelegram,
} from "./helpers";

test.skip(!process.env.SUPABASE_URL, "Потрібен локальний Supabase (SUPABASE_URL)");

const ORDER_PAYLOAD = (email: string, name: string) => ({
  service: "webapp",
  idea: "Потрібна вебплатформа з кабінетом клієнта та оплатою.",
  budget: "150-400k",
  deadline: "1-3-months",
  name,
  email,
  phone: "+380 50 123 45 67",
  consent: true,
  startedAt: Date.now() - 20_000,
});

async function createOrderViaUi(page: Page, email: string, name: string): Promise<string> {
  await page.goto("/contact");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3300); // мінімальний час заповнення форми — 3 с
  await page.getByRole("radio", { name: "Вебзастосунки" }).check();
  await page.locator("#field-idea").fill("Потрібна вебплатформа з кабінетом клієнта та оплатою.");
  await page.locator("select#field-budget").selectOption({ index: 3 });
  await page.locator("select#field-deadline").selectOption({ index: 3 });
  await page.locator("#field-name").fill(name);
  await page.locator("#field-email").fill(email);
  await page.locator("#field-phone").fill("+380 50 123 45 67");
  await page.locator("#field-consent").check();
  await page.getByRole("button", { name: "Надіслати заявку" }).click();
  const ticket = page.getByText(/BON-\d{4}-\d{5}/).first();
  await expect(ticket).toBeVisible({ timeout: 15_000 });
  return ((await ticket.textContent()) ?? "").match(/BON-\d{4}-\d{5}/)![0];
}

async function orderIdByTicket(ticket: string): Promise<string> {
  const { data, error } = await db.from("orders").select("id").eq("ticket_number", ticket).single();
  if (error) throw error;
  return data.id as string;
}

/** Чекає, поки React прив'язався до DOM (інакше клік/сабміт до гідратації дає нестабільні перевірки). */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("#main a[href], #main button, #main form");
    return Boolean(el) && Object.keys(el as object).some((key) => key.startsWith("__reactProps"));
  });
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeAll(async () => {
  await ensureAccounts();
});

test.describe("доступ без авторизації", () => {
  test("усі розділи адмінки перенаправляють на вхід", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const path of ["/admin", "/admin/orders", "/admin/settings", "/admin/orders/0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b", "/admin/mfa"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin\/login$/);
    }
    await context.close();
  });

  test("відповіді адмінки не кешуються й закриті від індексації", async ({ request }) => {
    const response = await request.get("/admin/login", { maxRedirects: 0 });
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
  });

  test("API сповіщень без секрету повертає 401", async ({ request }) => {
    expect((await request.post("/api/internal/notifications")).status()).toBe(401);
    expect((await request.get("/api/internal/notifications", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  });

  test("невірний пароль і акаунт поза allowlist дають однакову загальну помилку", async ({ browser }) => {
    for (const creds of [
      { email: founder1.email, password: "wrong-password" },
      { email: "nobody@bonsi.test", password: "whatever-123" },
      { email: outsider.email, password: outsider.password },
    ]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto("/admin/login");
      await page.waitForLoadState("networkidle");
      await page.getByLabel("Email").fill(creds.email);
      await page.getByLabel("Пароль").fill(creds.password);
      await page.getByRole("button", { name: "Увійти" }).click();
      await expect(page.locator("#login-error")).toHaveText("Невірний email або пароль.");
      await page.goto("/admin/orders");
      await expect(page).toHaveURL(/\/admin\/login$/);
      await context.close();
    }
  });

  test("відкритої реєстрації немає: signup у Supabase Auth вимкнено", async () => {
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: process.env.SUPABASE_ANON_KEY ?? "", "content-type": "application/json" },
      body: JSON.stringify({ email: "self-signup@bonsi.test", password: "Some-Pass-12345" }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test("акаунт з паролем, але поза allowlist, не читає заявки навіть напряму через API Supabase", async () => {
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: process.env.SUPABASE_ANON_KEY ?? "", "content-type": "application/json" },
      body: JSON.stringify({ email: outsider.email, password: outsider.password }),
    });
    const session = (await response.json()) as { access_token: string };
    const rest = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders?select=id`, {
      headers: { apikey: process.env.SUPABASE_ANON_KEY ?? "", authorization: `Bearer ${session.access_token}` },
    });
    expect(rest.status).toBe(200);
    expect(await rest.json()).toEqual([]);
    const anon = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders?select=id`, {
      headers: { apikey: process.env.SUPABASE_ANON_KEY ?? "" },
    });
    expect(anon.status).toBeGreaterThanOrEqual(400);
  });
});

test.describe.serial("робота адміністратора", () => {
  let page: Page;
  let ticket = "";
  let orderId = "";
  let clientName = "";
  let clientEmail = "";
  const projectAccount = () => (test.info().project.name === "firefox" ? founder2 : founder1);
  const otherAccount = () => (test.info().project.name === "firefox" ? founder1 : founder2);

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("вхід із налаштуванням і підтвердженням MFA", async () => {
    await login(page, projectAccount());
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Стан заявок");
  });

  test("dashboard показує реальні числа або чесний empty state", async () => {
    await page.goto("/admin");
    const { data } = await db.from("orders").select("status");
    const counts = new Map<string, number>();
    for (const row of data ?? []) counts.set(row.status as string, (counts.get(row.status as string) ?? 0) + 1);
    if ((data ?? []).length === 0) {
      await expect(page.getByText("Заявок поки немає")).toBeVisible();
      await expect(page.getByRole("list", { name: "Показники за статусами" })).toHaveCount(0);
    } else {
      const cards: Array<[string, string]> = [
        ["Нові заявки", "new"], ["У розгляді", "in_review"], ["Прийняті замовлення", "accepted"],
        ["Активні проєкти", "in_progress"], ["Завершені", "done"],
      ];
      for (const [label, status] of cards) {
        await expect(page.getByRole("link", { name: new RegExp(`^${label}\\s*${counts.get(status) ?? 0}$`) })).toBeVisible();
      }
    }
  });

  test("заявка з публічної форми потрапляє в базу й у Telegram без персональних даних", async () => {
    await stub("/__reset");
    clientName = `Тест Клієнт ${Date.now() % 100000}`;
    clientEmail = uniqueEmail("client");
    const guest = await page.context().browser()!.newContext();
    const guestPage = await guest.newPage();
    ticket = await createOrderViaUi(guestPage, clientEmail, clientName);
    await guest.close();
    orderId = await orderIdByTicket(ticket);

    const message = await waitForTelegram(ticket);
    expect(message.body.chat_id).toBe("111222333");
    expect(message.body.text).toContain("Вебзастосунки");
    expect(message.body.text).toContain(clientName);
    expect(message.body.text).toContain(`/admin/orders/${orderId}`);
    expect(message.body.text).not.toContain(clientEmail);
    expect(message.body.text).not.toContain("+380");
    expect(message.body.text).not.toContain("платформа");

    await expect
      .poll(async () => (await db.from("notification_outbox").select("status").eq("order_id", orderId).single()).data?.status)
      .toBe("sent");
  });

  test("список: пошук за номером, імʼям і email; фільтри; порожній результат", async () => {
    await page.goto("/admin/orders");
    await expect(page.getByRole("table").getByRole("link", { name: ticket })).toBeVisible();

    for (const term of [ticket, clientName, clientEmail]) {
      await page.goto("/admin/orders");
      await page.locator("#q").fill(term);
      await page.getByRole("button", { name: "Застосувати" }).click();
      await expect(page.getByRole("table").getByRole("link", { name: ticket })).toBeVisible();
    }

    await page.goto("/admin/orders?q=" + encodeURIComponent("'; drop table orders; --"));
    await expect(page.getByText("Нічого не знайдено")).toBeVisible();
    await page.goto("/admin/orders?q=%25");
    await expect(page.getByText("Нічого не знайдено")).toBeVisible();

    await page.goto(`/admin/orders?status=done&q=${encodeURIComponent(ticket)}`);
    await expect(page.getByText("Нічого не знайдено")).toBeVisible();
    await page.goto(`/admin/orders?status=new&service=webapp&q=${encodeURIComponent(ticket)}`);
    await expect(page.getByRole("table").getByRole("link", { name: ticket })).toBeVisible();
    await page.goto("/admin/orders?status=hacked&page=-4&from=garbage");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Усі заявки");
  });

  test("пагінація працює на реальних даних", async () => {
    const seedKey = `${test.info().project.name}-${Date.now()}`;
    for (let i = 0; i < 25; i += 1) {
      const { error } = await db.rpc("create_order", {
        p_service: "landing", p_idea: "Тестова заявка для перевірки пагінації списку.", p_budget: "discuss",
        p_deadline: "flexible", p_name: `Пагінація ${i}`, p_email: `page-${seedKey}-${i}@example.com`, p_phone: null,
        p_ip_hash: `seed-${seedKey}-${i}`, p_user_agent: "e2e", p_consent_policy_version: "2026-10-31", p_notify: false,
      });
      expect(error).toBeNull();
    }
    await page.goto("/admin/orders");
    await expect(page.getByText(/Сторінка 1 з [2-9]/)).toBeVisible();
    await hydrated(page);
    const next = page.getByRole("link", { name: /Далі/ });
    await expect(next).toHaveAttribute("href", "/admin/orders?page=2");
    const logs: string[] = [];
    page.on("request", (r) => logs.push(`REQ ${r.method()} ${r.url().replace("http://localhost:3100", "")} rsc=${r.headers()["rsc"] ?? "-"} prefetch=${r.headers()["next-router-prefetch"] ?? "-"}`));
    page.on("framenavigated", (fr) => logs.push(`NAV ${fr.url()}`));
    page.on("pageerror", (e) => logs.push(`PAGEERROR ${String(e).slice(0, 300)}`));
    page.on("crash", () => logs.push("CRASH"));
    page.on("dialog", (d) => logs.push(`DIALOG ${d.type()} ${d.message().slice(0, 80)}`));
    page.on("requestfinished", (r) => logs.push(`DONE ${r.url().replace("http://localhost:3100", "").slice(0, 60)}`));
    page.on("response", (r) => {
      logs.push(`${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:3100", "")} ${r.headers()["content-type"] ?? ""} enc=${r.headers()["content-encoding"] ?? "-"}`);
      if (r.url().includes("_rsc=")) {
        const t0 = Date.now();
        r.body().then(
          (b) => logs.push(`BODY ok ${b.length}b ${Date.now() - t0}ms ${r.url().slice(-30)}`),
          (e) => logs.push(`BODY err ${String(e).slice(0, 80)} ${Date.now() - t0}ms`),
        );
      }
    });
    page.on("requestfailed", (r) => logs.push(`FAILED ${r.url()} ${r.failure()?.errorText}`));
    page.on("console", (m) => logs.push(`console.${m.type()}: ${m.text().slice(0, 200)}`));
    logs.push(`CLICK at ${await page.evaluate(() => `${document.readyState} t=${Math.round(performance.now())}`)}`);
    await next.click();
    try {
      await expect(page).toHaveURL(/page=2/, { timeout: 10_000 });
    } catch (error) {
      const state = await page.evaluate(() => ({
        url: location.href,
        heading: document.body.innerText.match(/Сторінка \d+ з \d+/)?.[0] ?? null,
        errorText: document.body.innerText.slice(0, 200),
        hasNextData: typeof (window as unknown as { next?: unknown }).next,
      }));
      logs.push(`STATE ${JSON.stringify(state)}`);
      for (const [label, headers] of [["document", {}], ["rsc", { RSC: "1" }]] as const) {
        const started = Date.now();
        try {
          const res = await page.request.get("/admin/orders?page=2", { headers, timeout: 20_000 });
          const body = await res.text();
          logs.push(`PROBE ${label}: ${res.status()} ${body.length}b ${Date.now() - started}ms has-p2=${body.includes("Сторінка 2 з")}`);
        } catch (probeError) {
          logs.push(`PROBE ${label}: ERROR ${String(probeError).slice(0, 120)} after ${Date.now() - started}ms`);
        }
      }
      throw new Error(`Навігація пагінації не відбулась.\n${logs.slice(-30).join("\n")}\n${String(error).slice(0, 200)}`);
    }
    await expect(page.getByText(/Сторінка 2 з/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Назад/ })).toBeVisible();
    await page.goto("/admin/orders?page=9999");
    await expect(page.getByText("Такої сторінки немає")).toBeVisible();
  });

  test("деталі: зміна статусу, призначення, нотатки та історія", async () => {
    await page.goto(`/admin/orders/${orderId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(clientName);
    await hydrated(page);
    await expect(page.getByText(clientEmail)).toBeVisible();
    await page.waitForLoadState("networkidle");

    await page.locator("select#status").selectOption("in_review");
    await page.getByRole("button", { name: "Змінити" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Збережено" })).toBeVisible();
    await expect(page.getByText("Статус: Нова → У розгляді")).toBeVisible();
    expect((await db.from("orders").select("status").eq("id", orderId).single()).data?.status).toBe("in_review");

    await page.locator("select#assignee").selectOption({ label: otherAccount().name });
    await page.getByRole("button", { name: "Призначити" }).click();
    try {
      await expect(page.getByText(`Призначено: ${otherAccount().name}`)).toBeVisible();
    } catch (error) {
      const row = (await db.from("orders").select("assigned_to").eq("id", orderId).single()).data;
      const form = await page.locator("form:has(select#assignee)").innerText().catch(() => "n/a");
      const events = (await db.from("order_events").select("type, data").eq("order_id", orderId)).data;
      throw new Error(`Призначення не відобразилось. db.assigned_to=${row?.assigned_to} form="${form.replace(/\n/g, " | ")}" events=${JSON.stringify(events)} url=${page.url()}\n${String(error).slice(0, 150)}`);
    }

    await page.locator("#note").fill("Передзвонити клієнту завтра до 12:00");
    await page.getByRole("button", { name: "Додати нотатку" }).click();
    await expect(page.getByText("Передзвонити клієнту завтра до 12:00")).toBeVisible();
    await expect(page.getByText("Додано нотатку")).toBeVisible();

    await page.locator("#note").fill("    ");
    await page.getByRole("button", { name: "Додати нотатку" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Введіть текст нотатки" })).toBeVisible();

    const { data: events } = await db.from("order_events").select("type, actor_id").eq("order_id", orderId);
    expect((events ?? []).map((e) => e.type).sort()).toEqual(["assigned", "created", "note_added", "status_changed"]);
    expect((events ?? []).filter((e) => e.type !== "created").every((e) => e.actor_id)).toBe(true);
  });

  test("неіснуюча або некоректна заявка → 404", async () => {
    for (const id of ["99999999-9999-4999-8999-999999999999", "not-a-uuid", "1%20or%201=1"]) {
      // Сторінка стрімиться (loading.tsx), тому HTTP-статус уже 200: перевіряємо вміст 404 і noindex.
      await page.goto(`/admin/orders/${id}`);
      await expect(page.getByText("Сторінку не знайдено")).toBeVisible();
      await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
    }
  });

  test("налаштування показують MFA і стан Telegram", async () => {
    await page.goto("/admin/settings");
    await expect(page.getByText("увімкнено", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/MFA \(TOTP\)/)).toContainText("увімкнено");
    await expect(page.getByText("Статус: увімкнено")).toBeVisible();
    await expect(page.locator("#main").getByText(founder1.email).first()).toBeVisible();
  });

  test("доставка Telegram повторюється після збою й завершується успіхом", async ({ request }) => {
    await stub("/__reset");
    await stub("/__fail?n=1000");
    const email = uniqueEmail("retry");
    const created = await request.post("/api/orders", { data: ORDER_PAYLOAD(email, "Клієнт Повтор") });
    expect(created.status()).toBe(201);
    const retryTicket = ((await created.json()) as { ticket: string }).ticket;
    const id = await orderIdByTicket(retryTicket);

    await expect
      .poll(async () => (await db.from("notification_outbox").select("status, attempts, last_error").eq("order_id", id).single()).data)
      .toMatchObject({ status: "pending", attempts: 1, last_error: "telegram: HTTP 500" });
    expect(((await stub<unknown[]>("/__received")) as unknown[]).length).toBe(0);

    // Затримка повтору ще не минула: планувальник нічого не надсилає
    await stub("/__fail?n=0");
    const early = await request.post("/api/internal/notifications", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(((await early.json()) as { claimed: number }).claimed).toBe(0);

    await db.from("notification_outbox").update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq("order_id", id);
    const retry = await request.post("/api/internal/notifications", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(retry.status()).toBe(200);
    expect(((await retry.json()) as { sent: number }).sent).toBeGreaterThanOrEqual(1);
    await waitForTelegram(retryTicket);
    expect((await db.from("notification_outbox").select("status, attempts").eq("order_id", id).single()).data).toMatchObject({
      status: "sent",
      attempts: 2,
    });
  });

  test("API заявок: порожній список chat id/токен не потрібні для приймання (регресія форми)", async ({ request }) => {
    const email = uniqueEmail("regress");
    const response = await request.post("/api/orders", { data: ORDER_PAYLOAD(email, "Регресія") });
    expect(response.status()).toBe(201);
    const bad = await request.post("/api/orders", { data: { ...ORDER_PAYLOAD(email, "x"), email: "not-an-email" } });
    expect(bad.status()).toBe(400);
    const text = await request.post("/api/orders", { headers: { "content-type": "text/plain" }, data: "x" });
    expect(text.status()).toBe(415);
  });

  test("адаптивність, доступність і знімки адмінпанелі (320–1440 px)", async () => {
    const pages = ["/admin", "/admin/orders", `/admin/orders/${orderId}`, "/admin/settings"];
    const chromium = test.info().project.name === "chromium";
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of pages) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await noOverflow(page);
        if (chromium) {
          mkdirSync(".ci/admin-shots", { recursive: true });
          const name = path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "dashboard";
          await page.screenshot({ path: `.ci/admin-shots/${name}-${width}.png`, fullPage: true });
          const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
          const serious = results.violations
            .filter((v) => v.impact === "serious" || v.impact === "critical")
            .map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")}`);
          expect(serious, `${path} @ ${width}`).toEqual([]);
        }
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("вихід завершує сесію: адмінка знову закрита", async () => {
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Вийти" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto(`/admin/orders/${orderId}`);
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("повторний вхід вимагає код MFA (сесія aal1 не дає доступу)", async () => {
    await page.goto("/admin/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Email").fill(projectAccount().email);
    await page.getByLabel("Пароль").fill(projectAccount().password);
    await page.getByRole("button", { name: "Увійти" }).click();
    await page.waitForURL(/\/admin\/mfa/);
    await page.goto("/admin/orders");
    await expect(page).toHaveURL(/\/admin\/mfa/);
    await page.goto(`/admin/orders/${orderId}`);
    await expect(page).toHaveURL(/\/admin\/mfa/);

    await page.goto("/admin/mfa");
    await page.getByLabel(/Код із додатка/).fill("000000");
    await page.getByRole("button", { name: "Підтвердити" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Код не підійшов" })).toBeVisible();
  });
});

