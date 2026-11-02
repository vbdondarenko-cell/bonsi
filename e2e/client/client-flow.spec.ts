import { expect, test, type Page } from "@playwright/test";
import { db, uniqueEmail } from "../admin/helpers";
import { expectNoA11yViolations } from "../support/a11y";
import { latestLoginMail, loginWithCode, rpc, studio } from "./support";
import type { SupabaseClient } from "@supabase/supabase-js";

test.skip(!process.env.SUPABASE_URL, "Потрібен локальний Supabase (SUPABASE_URL)");
test.describe.configure({ mode: "serial" });

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");

const emailA = uniqueEmail("client-a");
const emailB = uniqueEmail("client-b");
let studioApi: SupabaseClient;
let projectA = "";
let projectA2 = "";
let projectB = "";

async function submitOrder(page: Page, email: string, name: string): Promise<string> {
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

/** Вхід кодом обмежений за частотою (як у продакшені), тож сесії клієнтів повторно використовуються між кроками сценарію. */
type Cookies = Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>;
const sessions = new Map<string, Cookies>();
async function signIn(page: Page, email: string) {
  const cached = sessions.get(email);
  if (cached) return page.context().addCookies(cached);
  await loginWithCode(page, email);
  sessions.set(email, await page.context().cookies());
}

async function projectOf(email: string, index = 0): Promise<string> {
  const users = await db.auth.admin.listUsers({ perPage: 200 });
  const user = users.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  expect(user, `користувач ${email}`).toBeTruthy();
  const { data, error } = await db.from("projects").select("id").eq("client_id", user!.id).order("created_at");
  if (error) throw error;
  return data[index]!.id as string;
}

test.beforeAll(async () => {
  studioApi = await studio();
});

test("1. заявка з сайту → 2. вхід за кодом із листа → 3. клієнт бачить свій проєкт", async ({ page }) => {
  const ticket = await submitOrder(page, emailA, "Клієнт А");
  await signIn(page, emailA);
  await page.goto("/app/projects");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  projectA = await projectOf(emailA);
  await expect(page.locator(`a[href="/app/projects/${projectA}"]`).first()).toBeVisible();
  await expect(page.locator("body")).toContainText(ticket);
  await expectNoA11yViolations(page, "/app/projects");
});

test("4. кілька проєктів: другу заявку клієнт А бачить окремою карткою, клієнт Б не бачить жодної з них", async ({ page, browser }) => {
  await rpc(db as never, "create_order_v2", {
    p_service: "landing", p_idea: "Лендінг для кампанії", p_budget: null, p_deadline: null, p_name: "Клієнт А", p_email: emailA, p_phone: null,
    p_details: {}, p_links: [], p_ip_hash: "ip-e2e-2", p_user_agent: "e2e", p_consent_policy_version: "2026-11-04", p_notify: false,
  });
  await rpc(db as never, "create_order_v2", {
    p_service: "mobile", p_idea: "Мобільний застосунок", p_budget: null, p_deadline: null, p_name: "Клієнт Б", p_email: emailB, p_phone: null,
    p_details: {}, p_links: [], p_ip_hash: "ip-e2e-3", p_user_agent: "e2e", p_consent_policy_version: "2026-11-04", p_notify: false,
  });
  await signIn(page, emailA);
  await page.goto("/app/projects");
  await expect(page.locator('a[href^="/app/projects/"]')).toHaveCount(2);
  projectA2 = await projectOf(emailA, 1);

  const other = await browser.newContext();
  const pageB = await other.newPage();
  await loginWithCode(pageB, emailB);
  projectB = await projectOf(emailB);
  await pageB.goto("/app/projects");
  await expect(pageB.locator('a[href^="/app/projects/"]')).toHaveCount(1);
  await expect(pageB.locator(`a[href="/app/projects/${projectB}"]`)).toBeVisible();
  for (const foreign of [projectA, projectA2]) {
    for (const section of ["", "/messages", "/proposal", "/files", "/payments"]) {
      const response = await pageB.goto(`/app/projects/${foreign}${section}`);
      expect(response?.status(), `B → ${section || "огляд"} чужого проєкту`).toBe(404);
    }
  }
  await other.close();
});

test("5. повідомлення студії з лічильником непрочитаних → 6. відповідь клієнта (чернетка не губиться при збої)", async ({ page, context }) => {
  await rpc(studioApi, "admin_send_message", { p_project: projectA, p_body: "Вітаємо! Уточніть, будь ласка, референси." });
  await signIn(page, emailA);
  await page.goto("/app/projects");
  await expect(page.getByText("Нових повідомлень: 1")).toBeVisible();
  await page.goto(`/app/projects/${projectA}/messages`);
  await expect(page.getByText("Вітаємо! Уточніть, будь ласка, референси.")).toBeVisible();

  // Збій мережі: повідомлення не надіслано, текст у полі збережено.
  const field = page.getByLabel("Нове повідомлення");
  await field.fill("Референси: https://example.com/ref");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Надіслати" }).click();
  await expect(page.locator("main [role=alert]")).toContainText(/зʼєднання|Не вдалося/);
  await expect(field).toHaveValue("Референси: https://example.com/ref");
  await context.setOffline(false);

  await page.getByRole("button", { name: "Надіслати" }).click();
  await expect(page.getByText("Референси: https://example.com/ref")).toBeVisible();
  await expect(field).toHaveValue("");
  // Лічильник скинутий прочитанням.
  await page.goto("/app/projects");
  await expect(page.getByText(/Нових повідомлень/)).toHaveCount(0);
});

test("7. вкладення до повідомлення; видалений файл не ламає чат і віддається як 404", async ({ page }) => {
  await signIn(page, emailA);
  await page.goto(`/app/projects/${projectA}/messages`);
  await page.locator('input[type="file"]').setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("list", { name: "Вкладення до повідомлення" })).toContainText("ref.png");
  await page.getByLabel("Нове повідомлення").fill("Ось макет");
  await page.getByRole("button", { name: "Надіслати" }).click();
  const link = page.getByRole("link", { name: /ref\.png/ });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;

  const ok = await page.request.get(href, { maxRedirects: 0 });
  expect(ok.status()).toBe(302);
  expect(ok.headers()["location"]).toContain("/object/sign/");

  const fileId = href.split("/").pop()!;
  await db.from("project_files").update({ deleted_at: new Date().toISOString() }).eq("id", fileId);
  const gone = await page.request.get(href, { maxRedirects: 0, headers: { accept: "text/html" } });
  expect(gone.status()).toBe(404);
  expect(await gone.text()).toContain("Файл недоступний");
});

test("8. пропозиція: запит змін → нова версія → погодження; 9. журнал рішень", async ({ page }) => {
  const proposal = async () => {
    const id = await rpc<string>(studioApi, "admin_create_proposal", { p_project: projectA });
    await rpc(studioApi, "admin_update_proposal", {
      p_proposal: id, p_title: "Сайт-платформа", p_summary: "Кабінет клієнта", p_features: ["Дизайн", "Розробка"], p_price: 100000.01, p_currency: "UAH", p_duration_days: 30,
      p_schedule: [{ label: "Аванс", percent: 30 }, { label: "Дизайн", percent: 40 }, { label: "Здача", percent: 30 }], p_revisions: 2, p_terms: "",
    });
    await rpc(studioApi, "admin_send_proposal", { p_proposal: id });
    return id;
  };
  await proposal();
  await signIn(page, emailA);
  await page.goto(`/app/projects/${projectA}/proposal`);
  await expect(page.getByText(/Онлайн-еквайринг поки не підключений/)).toBeVisible();
  await page.getByRole("button", { name: "Попросити змін" }).click();
  // Порожній коментар не відправляється: поле обовʼязкове (сервер дублює перевірку, її покривають DB-тести).
  await expect(page.getByRole("textbox")).toHaveAttribute("required", "");
  await page.getByRole("textbox").fill("Додайте адмінку та інтеграцію з CRM.");
  await page.getByRole("button", { name: "Надіслати запит на зміни" }).click();
  // Одноразове повідомлення зникає, коли сторінка перемальовується; перевіряємо тривалий результат: статус і журнал рішень.
  await expect(page.getByText("Запитано зміни").first()).toBeVisible();

  await proposal();
  await page.goto(`/app/projects/${projectA}/proposal`);
  await page.getByRole("button", { name: "Погодити пропозицію" }).click();
  await expect(page.getByText("Погоджено").first()).toBeVisible();
  const decisions = await db.from("proposal_decisions").select("decision").eq("project_id", projectA).order("id");
  expect(decisions.data?.map((d) => d.decision)).toEqual(["changes_requested", "approved"]);
});

test("10. результат етапу: правки → нова версія → погодження; 11. файл від клієнта", async ({ page }) => {
  const d1 = await rpc<string>(studioApi, "admin_create_deliverable", { p_project: projectA, p_stage: "design", p_title: "Макети v1", p_description: "Три екрани", p_preview_url: "https://example.com/preview" });
  await rpc(studioApi, "admin_submit_deliverable", { p_id: d1 });
  await signIn(page, emailA);
  await page.goto(`/app/projects/${projectA}/milestones`);
  await page.getByRole("button", { name: "Попросити правок" }).click();
  await page.getByRole("textbox").fill("Змінити кольори.");
  await page.getByRole("button", { name: "Надіслати правки" }).click();
  await expect.poll(async () => (await db.from("deliverable_decisions").select("decision").eq("project_id", projectA)).data?.map((d) => d.decision)).toEqual(["changes_requested"]);
  await page.reload();
  await expect(page.getByText("Запитано правки").first()).toBeVisible();

  await page.goto(`/app/projects/${projectA}/files`);
  await page.locator('input[type="file"]').first().setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Завантажити" }).first().click();
  await expect(page.getByText(/Збережено файлів: 1/)).toBeVisible();
  await expect(page.getByText("logo.png").first()).toBeVisible();
  // Небезпечний файл відхиляється з поясненням.
  await page.locator('input[type="file"]').first().setInputFiles({ name: "shell.php.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Завантажити" }).first().click();
  await expect(page.getByText(/Некоректна назва файлу/)).toBeVisible();
});

test("12. рахунок → 13. «Я сплатив(ла)» ≠ оплачено → 14. підтвердження студією → 15. фінальні файли → вихід і повторний вхід", async ({ page }) => {
  await rpc(studioApi, "admin_update_payment_settings", { p_recipient: "ФОП Тест", p_iban: "UA213223130000026007233566001", p_bank: "Банк", p_tax_id: "1234567890", p_hint: "Оплата, рахунок {number}" });
  const invoices = await rpc<number>(studioApi, "admin_create_invoices_from_proposal", { p_proposal: (await db.from("proposals").select("id").eq("project_id", projectA).eq("status", "approved").single()).data!.id });
  expect(invoices).toBe(3);
  const first = (await db.from("invoices").select("id").eq("project_id", projectA).order("created_at")).data![0]!.id as string;
  await rpc(studioApi, "admin_issue_invoice", { p_invoice: first });

  await signIn(page, emailA);
  await page.goto(`/app/projects/${projectA}/payments`);
  await expect(page.getByText("UA213223130000026007233566001")).toBeVisible();
  await expect(page.getByText("Не сплачено").first()).toBeVisible();
  await page.getByRole("button", { name: "Я сплатив(ла)" }).click();
  await expect(page.getByText(/Очікує підтвердження студією/).first()).toBeVisible();
  await expect(page.getByText("Сплачено", { exact: true })).toHaveCount(0);

  const pid = (await db.from("payments").select("id").eq("invoice_id", first).eq("status", "pending").single()).data!.id as string;
  await rpc(studioApi, "admin_confirm_payment", { p_payment: pid, p_amount: null, p_note: "Надійшло" });
  await page.reload();
  await expect(page.getByText("Сплачено", { exact: true }).first()).toBeVisible();

  const file = await rpc<string>(studioApi, "admin_register_file", { p_project: projectA, p_category: "final", p_name: "site.zip", p_mime: "application/zip", p_size: 4, p_path: `${projectA}/e2e-final-${Date.now()}`, p_visible: true, p_deliverable: null });
  expect(file).toBeTruthy();
  await page.goto(`/app/projects/${projectA}/documents`);
  await expect(page.getByText("site.zip")).toBeVisible();
  await expectNoA11yViolations(page, "/documents");

  await page.getByRole("button", { name: "Вийти" }).first().click();
  await page.waitForURL(/\/login/);
  await page.goto(`/app/projects/${projectA}`);
  await expect(page).toHaveURL(/\/login/);
  await loginWithCode(page, emailA);
  sessions.set(emailA, await page.context().cookies()); // вихід відкликає старі сесії
  await page.goto("/app/projects");
  await expect(page.locator('a[href^="/app/projects/"]')).toHaveCount(2);
});

test("вхід: повторний запит коду скидає стару помилку; використаний і прострочений код відхиляються", async ({ page }) => {
  test.setTimeout(300_000);
  // Усі запити з одного хоста CI ділять один IP-кошик, а сценарій вище вже використав ліміт входів (12/год).
  // Лічильники очищаються, щоб тест перевіряв логіку коду, а не ліміт (він покритий окремими модульними тестами).
  expect((await db.from("auth_throttle").delete().gte("window_start", "1970-01-01")).error).toBeNull();
  const since = Date.now();
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(emailB);
  await page.getByRole("button", { name: "Отримати код" }).click();
  await page.getByLabel("Код із листа").fill("000000");
  await page.getByRole("button", { name: "Увійти" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("Код невірний або застарів");
  // Supabase не дозволяє повторний лист тій самій адресі частіше за інтервал max_frequency (за замовчуванням 60 с):
  // чекаємо його завершення замість того, щоб покладатися на конфіг, який CLI міг не застосувати.
  await page.waitForTimeout(Math.max(0, 62_000 - (Date.now() - since)));
  await page.getByRole("button", { name: "Надіслати код ще раз" }).click();
  await expect(page.locator("main [role=alert]")).toHaveCount(0); // стара помилка не лишається після повторного запиту
  const { code } = await latestLoginMail(emailB, since + 1);
  await page.getByLabel("Код із листа").fill(code);
  await page.getByRole("button", { name: "Увійти" }).click();
  await page.waitForURL(/\/app/);
  // Той самий код вдруге не працює (новий лист цій адресі Supabase дозволяє не раніше ніж через інтервал max_frequency).
  await page.context().clearCookies();
  await page.waitForTimeout(62_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailB);
  await page.getByRole("button", { name: "Отримати код" }).click();
  await page.getByLabel("Код із листа").fill(code);
  await page.getByRole("button", { name: "Увійти" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("Код невірний або застарів");
});

test("чат: понад 500 повідомлень — клієнт бачить найновіші, старіші підвантажуються, дублікатів немає", async ({ page }) => {
  const rows = Array.from({ length: 620 }, (_, i) => ({ project_id: projectA2, author_role: i % 2 ? "admin" : "client", body: `Історія №${i + 1}`, author_id: null as string | null }));
  // Вставка від імені service_role напряму в таблицю: власник повідомлення — перший адміністратор/клієнт проєкту.
  const owner = (await db.from("projects").select("client_id").eq("id", projectA2).single()).data!.client_id as string;
  const admin = (await db.from("admin_users").select("user_id").limit(1).single()).data!.user_id as string;
  for (const row of rows) row.author_id = row.author_role === "admin" ? admin : owner;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("project_messages").insert(rows.slice(i, i + 200));
    expect(error).toBeNull();
  }
  await signIn(page, emailA);
  await page.goto(`/app/projects/${projectA2}/messages`);
  await expect(page.getByText("Історія №620", { exact: true })).toBeVisible();
  await expect(page.getByText("Історія №1", { exact: true })).toHaveCount(0);
  const older = page.getByRole("button", { name: "Показати старіші повідомлення" });
  const loading = page.getByRole("button", { name: "Завантажуємо…" });
  for (let i = 0; i < 30; i++) {
    // Під час підвантаження кнопка змінює підпис: чекаємо завершення, і лише тоді вирішуємо, чи є ще сторінки.
    await expect(loading).toBeHidden();
    if ((await older.count()) === 0) break;
    await older.click();
  }
  await expect(page.getByText("Історія №1", { exact: true })).toBeVisible();
  const bodies = await page.locator('[role="log"] .whitespace-pre-wrap').allTextContents();
  expect(new Set(bodies).size).toBe(bodies.length);
  expect(bodies).toHaveLength(620);
});
