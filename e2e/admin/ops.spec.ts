import { expect, test, type Page } from "@playwright/test";
import { studio, rpc } from "../client/support";
import { db, ensureAccounts, founder1, founder2, login, uniqueEmail } from "./helpers";
import { expectNoA11yViolations } from "../support/a11y";
import type { SupabaseClient } from "@supabase/supabase-js";

test.skip(!process.env.SUPABASE_URL, "Потрібен локальний Supabase (SUPABASE_URL)");
test.describe.configure({ mode: "serial" });

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => {
    const el = document.querySelector("#main a[href], #main button, #main form");
    return Boolean(el) && Object.keys(el as object).some((key) => key.startsWith("__reactProps"));
  });
  await page.waitForTimeout(1_000);
}

let page1: Page;
let page2: Page;
let studioApi: SupabaseClient;
let taskTitle = "";
let taskId = "";
let projectId = "";

test.beforeAll(async ({ browser }) => {
  await ensureAccounts();
  studioApi = await studio();
  page1 = await (await browser.newContext()).newPage();
  page2 = await (await browser.newContext()).newPage();
  await login(page1, founder1);
  await login(page2, founder2);
  // Робочий проєкт для зв'язку з завданнями й фінансами: створюється напряму, як зробила б активація.
  const user = await db.auth.admin.createUser({ email: uniqueEmail("ops-client"), email_confirm: true });
  if (user.error) throw user.error;
  const ticket = await rpc<string>(db as never, "create_order_v2", {
    p_service: "webapp", p_idea: "Операційний проєкт", p_budget: null, p_deadline: null, p_name: "Операційний клієнт", p_email: user.data.user!.email, p_phone: null,
    p_details: {}, p_links: [], p_ip_hash: `ip-ops-${Date.now()}`, p_user_agent: "e2e", p_consent_policy_version: "2026-11-04", p_notify: false,
  });
  const order = (await db.from("orders").select("id").eq("ticket_number", ticket).single()).data!.id as string;
  const inserted = await db.from("projects").insert({ order_id: order, client_id: user.data.user!.id, title: ticket, service: "webapp", activated_at: new Date().toISOString() }).select("id").single();
  if (inserted.error) throw inserted.error;
  projectId = inserted.data.id as string;
});

test.afterAll(async () => {
  await page1?.context().close();
  await page2?.context().close();
});

test("завдання: створення, чекліст і посилання, блокер вимагає причини", async () => {
  taskTitle = `Верстка головної ${Date.now() % 100000}`;
  await page1.goto("/admin/tasks");
  await settle(page1);
  // Кнопка форми неактивна, доки форма не гідрована: це надійний сигнал, що введені поля не буде скинуто гідрацією.
  await expect(page1.getByRole("button", { name: "Створити завдання" })).toBeEnabled();
  await page1.getByLabel("Назва", { exact: true }).fill(taskTitle);
  await page1.locator("select[name=projectId]").first().selectOption(projectId);
  await page1.locator("select[name=priority]").first().selectOption("high");
  await page1.getByRole("button", { name: "Створити завдання" }).click();
  const card = page1.locator("li[data-task-id]", { hasText: taskTitle });
  // Розрізняємо «дія повернула помилку» і «картка не з'явилась»: інакше збій читається однаково.
  const formError = page1.locator("form [role=alert]").first();
  await expect(card.or(formError)).toBeVisible();
  await expect(formError, "Створення завдання повернуло помилку").toHaveCount(0);
  await expect(card).toBeVisible();
  taskId = (await card.getAttribute("data-task-id"))!;
  await expect(page1.locator("section", { has: page1.getByRole("heading", { name: "Backlog" }) })).toContainText(taskTitle);

  // Заблокувати без причини не можна.
  await card.getByLabel("Нова колонка").selectOption("blocked");
  await card.getByRole("button", { name: "Перемістити" }).click();
  await expect(card.getByRole("alert")).toContainText("вкажіть причину");
  expect((await db.from("studio_tasks").select("status").eq("id", taskId).single()).data?.status).toBe("backlog");

  // Після відхиленої дії введене лишається у формі: вибрана колонка не скидається, тож досить доповнити причину.
  await expect(card.getByLabel("Нова колонка")).toHaveValue("blocked");
  await card.getByLabel("Причина блокування").fill("Чекаємо макети від клієнта");
  await card.getByRole("button", { name: "Перемістити" }).click();
  await expect(page1.locator("section", { has: page1.getByRole("heading", { name: "Blocked" }) })).toContainText("Блокер: Чекаємо макети від клієнта");

  await page1.goto(`/admin/tasks/${taskId}`);
  await settle(page1);
  await page1.locator("textarea[name=checklist]").fill("[x] Макет\n[ ] Адаптив");
  await page1.locator("textarea[name=links]").fill("github https://github.com/bonsi/site/pull/12\nhttps://www.figma.com/design/abc");
  await page1.getByRole("button", { name: "Зберегти завдання" }).click();
  await expect.poll(async () => (await db.from("studio_tasks").select("checklist").eq("id", taskId).single()).data?.checklist, { timeout: 20_000 }).toEqual([{ text: "Макет", done: true }, { text: "Адаптив", done: false }]);
  const links = (await db.from("studio_tasks").select("links").eq("id", taskId).single()).data?.links;
  expect(links).toEqual([{ kind: "github", url: "https://github.com/bonsi/site/pull/12" }, { kind: "figma", url: "https://www.figma.com/design/abc" }]);
  await page1.reload();
  await settle(page1);
  await page1.locator("textarea[name=links]").fill("http://insecure.example");
  await page1.getByRole("button", { name: "Зберегти завдання" }).click();
  await expect(page1.getByRole("alert").first()).toContainText("Некоректні посилання");
});

test("два адміністратори: застарілий екран не перезаписує чужу зміну (stale), історія повна", async () => {
  await page1.goto("/admin/tasks");
  await page2.goto("/admin/tasks");
  await settle(page1);
  await settle(page2);
  const card1 = page1.locator("li[data-task-id]", { hasText: taskTitle });
  const card2 = page2.locator("li[data-task-id]", { hasText: taskTitle });
  await expect(card1).toBeVisible();
  await expect(card2).toBeVisible();

  // Адміністратор 2 завершує завдання; екран адміністратора 1 лишається застарілим.
  await card2.getByLabel("Нова колонка").selectOption("done");
  await card2.getByRole("button", { name: "Перемістити" }).click();
  await expect.poll(async () => (await db.from("studio_tasks").select("status").eq("id", taskId).single()).data?.status, { timeout: 20_000 }).toBe("done");

  await card1.getByLabel("Нова колонка").selectOption("in_review");
  await card1.getByRole("button", { name: "Перемістити" }).click();
  await expect(card1.getByRole("alert")).toContainText("вже змінив інший адміністратор");
  expect((await db.from("studio_tasks").select("status").eq("id", taskId).single()).data?.status).toBe("done");

  await page1.reload();
  await settle(page1);
  await expect(page1.locator("section", { has: page1.getByRole("heading", { name: "Done" }) })).toContainText(taskTitle);
  const events = (await db.from("task_events").select("type,data").eq("task_id", taskId).order("id")).data!;
  expect(events.map((e) => e.type)).toEqual(["created", "status_changed", "updated", "status_changed"]);
  await expectNoA11yViolations(page1, "/admin/tasks");
});

test("подвійний клік і повтор відправки не створюють дублікатів (завдання, кошторис)", async () => {
  const unique = `Дубль ${Date.now() % 1_000_000}`;
  await page1.goto("/admin/tasks");
  await settle(page1);
  await expect(page1.getByRole("button", { name: "Створити завдання" })).toBeEnabled();
  await page1.getByLabel("Назва", { exact: true }).fill(unique);
  await page1.getByRole("button", { name: "Створити завдання" }).dblclick();
  await expect.poll(async () => (await db.from("studio_tasks").select("id").eq("title", unique)).data?.length, { timeout: 20_000 }).toBe(1);
  await page1.waitForTimeout(1_500); // запізнілий другий запит встиг би створити дубль
  expect((await db.from("studio_tasks").select("id").eq("title", unique)).data).toHaveLength(1);

  const estimate = `Кошторис ${Date.now() % 1_000_000}`;
  await page1.goto("/admin/finance");
  await settle(page1);
  const form = page1.locator("form", { has: page1.getByRole("button", { name: "Створити кошторис" }) });
  await expect(form.getByRole("button", { name: "Створити кошторис" })).toBeEnabled();
  await form.getByLabel("Назва", { exact: true }).fill(estimate);
  await form.getByRole("button", { name: "Створити кошторис" }).dblclick();
  await expect.poll(async () => (await db.from("estimates").select("id").eq("title", estimate)).data?.length, { timeout: 20_000 }).toBe(1);
  await page1.waitForTimeout(1_500);
  expect((await db.from("estimates").select("id").eq("title", estimate)).data).toHaveLength(1);
});

test("дошка завдань адаптивна: без горизонтального скролу сторінки на 320–1440 px", async () => {
  for (const width of [320, 768, 1440]) {
    await page1.setViewportSize({ width, height: 900 });
    await page1.goto("/admin/tasks");
    await page1.waitForLoadState("networkidle");
    const overflow = await page1.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `@ ${width}`).toBeLessThanOrEqual(1);
  }
  await page1.setViewportSize({ width: 1280, height: 800 });
});

test("фінанси: прогноз, виставлено й отримано рахуються окремо; витрати й маржа; повтори не подвоюють суми", async () => {
  // Фінансове зведення глобальне, тому тест не припускає порожньої бази: усі перевірки — це дельти від власного baseline,
  // знятого на початку саме цієї спроби. Повторна спроба (retry) або інший тест не змінюють очікувань.
  const read = async (key: string): Promise<number> => {
    const dd = page1.locator(`[data-metric="UAH:${key}"] dd`).first();
    if ((await dd.count()) === 0) return 0; // рядка валюти ще немає — у базі немає жодних даних
    const text = (await dd.textContent()) ?? "";
    return Number(text.replace(/[^\d,.-]/g, "").replace(",", "."));
  };
  const snapshot = async () => {
    await page1.goto("/admin/finance");
    await settle(page1);
    return { invoiced: await read("invoiced"), received: await read("received"), unpaid: await read("unpaid"), expenses: await read("expenses"), margin: await read("margin") };
  };
  const base = await snapshot();

  // Рахунок 1000 UAH виставлено, але ще не оплачено.
  const invoice = await rpc<string>(studioApi, "admin_create_invoice", { p_project: projectId, p_label: "Оплата", p_amount: 1000, p_currency: "UAH", p_due: null });
  await rpc(studioApi, "admin_issue_invoice", { p_invoice: invoice });
  // Повторне виставлення того ж рахунку не створює другого й не змінює суму (або відхиляється, або нічого не робить).
  await rpc(studioApi, "admin_issue_invoice", { p_invoice: invoice }).catch(() => undefined);
  expect((await db.from("invoices").select("id").eq("project_id", projectId)).data).toHaveLength(1);
  const number = (await db.from("invoices").select("number").eq("id", invoice).single()).data!.number as string;

  let now = await snapshot();
  expect(now.invoiced - base.invoiced).toBeCloseTo(1000, 2);
  expect(now.received - base.received).toBeCloseTo(0, 2);
  expect(now.unpaid - base.unpaid).toBeCloseTo(1000, 2);

  // Підтверджене надходження (подія провайдера від імені service_role) збільшує «отримано» рівно один раз,
  // навіть якщо провайдер надішле ту саму подію повторно.
  const event = { p_provider: "liqpay", p_event_id: `e-ops-${Date.now()}`, p_invoice_number: number, p_amount: 1000, p_currency: "UAH", p_status: "success", p_provider_payment_id: `pay-ops-${Date.now()}`, p_payload: {} };
  await rpc(db as never, "payments_apply_provider_event", event);
  await rpc(db as never, "payments_apply_provider_event", event);
  expect((await db.from("payments").select("id").eq("invoice_id", invoice).eq("status", "confirmed")).data).toHaveLength(1);
  now = await snapshot();
  expect(now.received - base.received).toBeCloseTo(1000, 2);
  expect(now.unpaid - base.unpaid).toBeCloseTo(0, 2);

  // Витрата 300 через інтерфейс → витрати +300, маржа +700.
  await page1.locator("select[name=projectId]").first().selectOption(projectId);
  await page1.getByLabel("Категорія", { exact: true }).fill("Хостинг");
  await page1.getByLabel("Сума", { exact: true }).fill("300");
  await page1.getByRole("button", { name: "Записати витрату" }).click();
  await expect.poll(async () => (await db.from("project_expenses").select("amount").eq("project_id", projectId)).data?.length, { timeout: 20_000 }).toBe(1);
  now = await snapshot();
  expect(now.expenses - base.expenses).toBeCloseTo(300, 2);
  expect(now.margin - base.margin).toBeCloseTo(700, 2);
  await expectNoA11yViolations(page1, "/admin/finance");
});

test("кошторис: калькулятор рахує рекомендовану ціну; зафіксований кошторис не редагується", async () => {
  await page1.goto("/admin/finance");
  await settle(page1);
  const form = page1.locator("form", { has: page1.getByRole("button", { name: "Створити кошторис" }) });
  await form.getByLabel("Назва", { exact: true }).fill("Сайт-платформа");
  await form.locator("select[name=projectId]").selectOption(projectId);
  await form.getByRole("button", { name: "Створити кошторис" }).click();
  await page1.getByRole("link", { name: "Сайт-платформа" }).click();
  await settle(page1);
  await page1.getByLabel("Дизайн: години").fill("10");
  await page1.getByLabel("Дизайн: ставка").fill("1000");
  await page1.getByLabel("Резерв, %").fill("15");
  await page1.getByLabel("Цільова маржа, %").fill("30");
  await page1.getByRole("button", { name: "Зберегти кошторис" }).click();
  await expect(page1.getByTestId("recommended")).toContainText(/16[\s ]?428[,.]57/);
  await page1.getByRole("button", { name: "Зафіксувати кошторис" }).click();
  await expect(page1.getByRole("button", { name: "Кошторис зафіксовано" })).toBeDisabled();
});

test("портфоліо: без згоди власника публікація неможлива; після згоди й публікації кейс видно на сайті, після зняття — ні", async ({ browser }) => {
  const slug = `e2e-case-${Date.now()}`;
  const title = `Кейс ${slug}`;
  await page1.goto("/admin/portfolio");
  await settle(page1);
  const form = page1.locator("form", { has: page1.getByRole("button", { name: "Створити чернетку" }) });
  await form.getByLabel("Назва кейсу").fill(title);
  await form.getByLabel("Адресне ім'я (slug)").fill(slug);
  await form.getByLabel("Короткий опис (картка)").fill("Короткий опис перевіреного проєкту.");
  await form.getByLabel("Завдання", { exact: true }).fill("Зробити сайт для невеликої компанії.");
  await form.getByLabel("Результат (лише перевірені факти)").fill("Сайт запущено й передано замовнику.");
  await form.getByLabel("Технології (через кому)").fill("Next.js, Supabase");
  await form.getByRole("button", { name: "Створити чернетку" }).click();
  await page1.waitForURL(/\/admin\/portfolio\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await settle(page1);

  // Без згоди кнопки публікації немає, а сервер відхиляє спробу напряму.
  await expect(page1.getByRole("button", { name: "Опублікувати на сайті" })).toHaveCount(0);
  const itemId = page1.url().match(/portfolio\/([0-9a-f-]{36})/)![1]!;
  const version = (await db.from("portfolio_items").select("version").eq("id", itemId).single()).data!.version as number;
  await expect(rpc(studioApi, "admin_set_portfolio_status", { p_id: itemId, p_expected: version, p_status: "published" })).rejects.toThrow(/consent_required/);

  const anon = await browser.newContext();
  const pub = await anon.newPage();
  expect((await pub.goto(`/portfolio/${slug}`))?.status()).toBe(404);

  await page1.getByLabel("Як отримано згоду (лист, повідомлення, договір)").fill("Лист від власника проєкту");
  await page1.getByRole("button", { name: "Підтвердити згоду власника" }).click();
  await expect(page1.getByRole("button", { name: "Опублікувати на сайті" })).toBeVisible({ timeout: 20_000 });
  await page1.getByRole("button", { name: "Опублікувати на сайті" }).click();
  await expect.poll(async () => (await db.from("portfolio_items").select("status").eq("id", itemId).single()).data?.status, { timeout: 20_000 }).toBe("published");

  // Публічна сторінка кешується на хвилину (ISR), але ревалідується діями адміністратора.
  await expect.poll(async () => (await pub.goto(`/portfolio/${slug}`))?.status(), { timeout: 30_000 }).toBe(200);
  await expect(pub.getByRole("heading", { name: title })).toBeVisible();

  await page1.reload();
  await settle(page1);
  await page1.getByRole("button", { name: "Зняти з публікації" }).click();
  await expect.poll(async () => (await db.from("portfolio_items").select("status").eq("id", itemId).single()).data?.status, { timeout: 20_000 }).toBe("draft");
  await expect.poll(async () => (await pub.goto(`/portfolio/${slug}`))?.status(), { timeout: 30_000 }).toBe(404);
  await anon.close();
});
