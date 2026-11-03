import { expect, test, type Page } from "@playwright/test";
import { db, founder1, login, uniqueEmail } from "../admin/helpers";
import { expectNoA11yViolations } from "../support/a11y";
import { latestLoginMail, loginWithCode, rpc, studio } from "./support";
import type { SupabaseClient } from "@supabase/supabase-js";

test.skip(!process.env.SUPABASE_URL, "Потрібен локальний Supabase (SUPABASE_URL)");
test.describe.configure({ mode: "serial" });

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");

// Значення створюються в beforeAll окремо для кожного браузера (проєкту Playwright): користувачі й заявки не перетинаються.
let emailA = "";
let emailB = "";
let studioApi: SupabaseClient;
let adminPage: Page;
let projectA = "";
let projectA2 = "";
let projectB = "";
let ticketA = "";
let contractId = "";

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

async function createOrderRpc(email: string, name: string, service: string, n: number) {
  return rpc(db as never, "create_order_v2", {
    p_service: service, p_idea: "Додаткова заявка", p_budget: null, p_deadline: null, p_name: name, p_email: email, p_phone: null,
    p_details: {}, p_links: [], p_ip_hash: `ip-e2e-${Date.now()}-${n}`, p_user_agent: "e2e", p_consent_policy_version: "2026-11-04", p_notify: false,
  });
}

test.beforeAll(async ({ browser }) => {
  emailA = uniqueEmail("client-a");
  emailB = uniqueEmail("client-b");
  sessions.clear();
  // Ліміти входу спільні для всього хосту CI; кожен браузер починає з чистими лічильниками.
  await db.from("auth_throttle").delete().gte("window_start", "1970-01-01");
  studioApi = await studio();
  // Адміністратор працює через справжній інтерфейс /admin (з MFA) у окремому контексті.
  adminPage = await (await browser.newContext()).newPage();
  await login(adminPage, founder1);
});

test.afterAll(async () => {
  await adminPage?.context().close();
});

test("1. заявка → вхід кодом → «Мої заявки»: це заявка, а не активний проєкт", async ({ page }) => {
  ticketA = await submitOrder(page, emailA, "Клієнт А");
  await signIn(page, emailA);
  projectA = await projectOf(emailA);
  await page.goto("/app/requests");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Мої заявки");
  await expect(page.locator("main")).toContainText(ticketA);
  await expect(page.locator("main")).toContainText("Це заявка, а не активний проєкт");
  await expectNoA11yViolations(page, "/app/requests");

  await page.goto("/app/projects");
  await expect(page.getByText("Активних проєктів поки немає")).toBeVisible();
  await expect(page.locator(`a[href="/app/projects/${projectA}"]`)).toHaveCount(0);

  await page.goto(`/app/projects/${projectA}`);
  await expect(page.getByText("Це заявка, а не активний проєкт")).toBeVisible();
  await expect(page.getByLabel("Умови активації проєкту")).toContainText("Договір погоджено");
});

test("2. кілька заявок: клієнт А бачить обидві, клієнт Б не бачить жодної з них", async ({ page, browser }) => {
  await createOrderRpc(emailA, "Клієнт А", "landing", 2);
  await createOrderRpc(emailB, "Клієнт Б", "mobile", 3);
  await loginWithCode(page, emailA);
  sessions.set(emailA, await page.context().cookies());
  await page.goto("/app/requests");
  await expect(page.locator('a[href^="/app/projects/"]')).toHaveCount(2);
  projectA2 = await projectOf(emailA, 1);

  const other = await browser.newContext();
  const pageB = await other.newPage();
  await loginWithCode(pageB, emailB);
  projectB = await projectOf(emailB);
  await pageB.goto("/app/requests");
  await expect(pageB.locator('a[href^="/app/projects/"]')).toHaveCount(1);
  await expect(pageB.locator(`a[href="/app/projects/${projectB}"]`)).toBeVisible();
  for (const foreign of [projectA, projectA2]) {
    for (const section of ["", "/messages", "/proposal", "/files", "/payments", "/documents", "/changes"]) {
      const response = await pageB.goto(`/app/projects/${foreign}${section}`);
      expect(response?.status(), `B → ${section || "огляд"} чужого проєкту`).toBe(404);
    }
  }
  await other.close();
});

test("3. відхилення заявки з причиною: клієнт Б бачить причину; адмін використовує форму в інтерфейсі", async ({ browser }) => {
  const orderB = (await db.from("projects").select("order_id").eq("id", projectB).single()).data!.order_id as string;
  await adminPage.goto(`/admin/orders/${orderB}`);
  await adminPage.waitForLoadState("networkidle");
  await adminPage.getByLabel("Причина відхилення (її побачить клієнт)").fill("Зараз немає вільних виконавців");
  await adminPage.getByRole("button", { name: "Відхилити заявку" }).click();
  await expect.poll(async () => (await db.from("orders").select("status").eq("id", orderB).single()).data?.status, { timeout: 20_000 }).toBe("rejected");

  const context = await browser.newContext();
  const pageB = await context.newPage();
  await loginWithCode(pageB, emailB);
  await pageB.goto("/app/requests");
  await expect(pageB.locator("main")).toContainText("Відхилена");
  await expect(pageB.locator("main")).toContainText("Зараз немає вільних виконавців");
  await context.close();
});

test("4. повідомлення студії: лічильник у вкладці; відповідь клієнта (чернетка не губиться при збої)", async ({ page, context }) => {
  await rpc(studioApi, "admin_send_message", { p_project: projectA, p_body: "Вітаємо! Уточніть, будь ласка, референси." });
  await signIn(page, emailA);
  await page.goto(`/app/projects/${projectA}`);
  await expect(page.getByLabel("Непрочитаних: 1")).toBeVisible();
  await page.goto(`/app/projects/${projectA}/messages`);
  await expect(page.getByText("Вітаємо! Уточніть, будь ласка, референси.")).toBeVisible();

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
  await page.goto(`/app/projects/${projectA}`);
  await expect(page.getByLabel(/Непрочитаних/)).toHaveCount(0);
});

test("5. вкладення до повідомлення; видалений файл віддається як 404", async ({ page }) => {
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

  await db.from("project_files").update({ deleted_at: new Date().toISOString() }).eq("id", href.split("/").pop()!);
  const gone = await page.request.get(href, { maxRedirects: 0, headers: { accept: "text/html" } });
  expect(gone.status()).toBe(404);
  expect(await gone.text()).toContain("Файл недоступний");
});

test("6. комерційна пропозиція: запит змін → нова версія → погодження; журнал рішень", async ({ page }) => {
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
  await expect(page.getByRole("textbox")).toHaveAttribute("required", "");
  await page.getByRole("textbox").fill("Додайте адмінку та інтеграцію з CRM.");
  await page.getByRole("button", { name: "Надіслати запит на зміни" }).click();
  await expect(page.getByText("Запитано зміни").first()).toBeVisible();

  await proposal();
  await page.goto(`/app/projects/${projectA}/proposal`);
  await page.getByRole("button", { name: "Погодити пропозицію" }).click();
  await expect(page.getByText("Погоджено").first()).toBeVisible();
  const decisions = await db.from("proposal_decisions").select("decision").eq("project_id", projectA).order("id");
  expect(decisions.data?.map((d) => d.decision)).toEqual(["changes_requested", "approved"]);
});

test("7. договір: адміністратор створює за шаблоном і відправляє; клієнт погоджує (версія й хеш у журналі)", async ({ page }) => {
  // До договору й передоплати проєкт не активується: сервер відмовляє, навіть якщо пропозицію погоджено.
  await expect(rpc(studioApi, "admin_activate_project", { p_project: projectA })).rejects.toThrow(/conditions_not_met/);

  await adminPage.goto(`/admin/projects/${projectA}/workflow`);
  await adminPage.waitForLoadState("networkidle");
  await adminPage.getByLabel("Тип документа").selectOption("contract");
  await adminPage.getByRole("button", { name: "Створити за шаблоном" }).click();
  await expect.poll(async () => (await db.from("documents").select("id").eq("project_id", projectA).eq("kind", "contract")).data?.length, { timeout: 20_000 }).toBe(1);
  contractId = (await db.from("documents").select("id").eq("project_id", projectA).eq("kind", "contract").single()).data!.id as string;
  await adminPage.reload();
  await adminPage.waitForLoadState("networkidle");
  await adminPage.getByRole("button", { name: "Відправити клієнту (зафіксувати версію)" }).click();
  await expect.poll(async () => (await db.from("documents").select("status").eq("id", contractId).single()).data?.status, { timeout: 20_000 }).toBe("sent");

  await signIn(page, emailA);
  await page.goto("/app");
  await expect(page.getByText("Документ на погодження")).toBeVisible();
  await page.goto(`/app/projects/${projectA}/documents`);
  await page.getByRole("link", { name: new RegExp(`Договір на розробку ${ticketA}`) }).click();
  await expect(page.getByText(/не є юридично перевіреним/).first()).toBeVisible();
  await expect(page.getByText(/SHA-256 версії 1/)).toBeVisible();
  await page.getByRole("button", { name: "Погодити документ" }).click();
  await expect.poll(async () => (await db.from("documents").select("status").eq("id", contractId).single()).data?.status, { timeout: 20_000 }).toBe("approved");
  await page.reload();
  await expect(page.getByText("Погоджено").first()).toBeVisible();
  const log = await db.from("document_decisions").select("version, decision, content_hash").eq("document_id", contractId);
  expect(log.data).toHaveLength(1);
  expect(log.data![0]).toMatchObject({ version: 1, decision: "approved" });
  expect(log.data![0]!.content_hash).toHaveLength(64);
});

test("8. рахунок-передоплата: «Я сплатив(ла)» ≠ оплачено; після підтвердження студією адміністратор активує проєкт", async ({ page }) => {
  const proposalId = (await db.from("proposals").select("id").eq("project_id", projectA).eq("status", "approved").single()).data!.id as string;
  expect(await rpc<number>(studioApi, "admin_create_invoices_from_proposal", { p_proposal: proposalId })).toBe(3);
  const first = (await db.from("invoices").select("id").eq("project_id", projectA).order("created_at")).data![0]!.id as string;
  await rpc(studioApi, "admin_update_payment_settings", { p_recipient: "ФОП Тест", p_iban: "UA213223130000026007233566001", p_bank: "Банк", p_tax_id: "1234567890", p_hint: "Оплата, рахунок {number}" });
  await rpc(studioApi, "admin_set_invoice_purpose", { p_invoice: first, p_purpose: "prepayment" });
  await rpc(studioApi, "admin_issue_invoice", { p_invoice: first });

  await signIn(page, emailA);
  await page.goto(`/app/projects/${projectA}/payments`);
  await expect(page.getByText("UA213223130000026007233566001")).toBeVisible();
  await page.getByRole("button", { name: "Я сплатив(ла)" }).click();
  await expect(page.getByText(/Очікує підтвердження студією/).first()).toBeVisible();
  await expect(page.getByText("Сплачено", { exact: true })).toHaveCount(0);

  // Заява клієнта оплатою не є: активація все ще заблокована.
  await expect(rpc(studioApi, "admin_activate_project", { p_project: projectA })).rejects.toThrow(/conditions_not_met/);

  const pid = (await db.from("payments").select("id").eq("invoice_id", first).eq("status", "pending").single()).data!.id as string;
  await rpc(studioApi, "admin_confirm_payment", { p_payment: pid, p_amount: null, p_note: "Надійшло" });
  await page.reload();
  await expect(page.getByText("Сплачено", { exact: true }).first()).toBeVisible();

  await adminPage.goto(`/admin/projects/${projectA}/workflow`);
  await adminPage.waitForLoadState("networkidle");
  await adminPage.getByRole("button", { name: "Активувати проєкт" }).click();
  await expect.poll(async () => (await db.from("projects").select("activated_at").eq("id", projectA).single()).data?.activated_at, { timeout: 20_000 }).not.toBeNull();
  const scope = await db.from("project_scope").select("kind,title").eq("project_id", projectA);
  expect(scope.data).toEqual([{ kind: "baseline", title: "Сайт-платформа" }]);

  await page.goto("/app/projects");
  await expect(page.locator(`a[href="/app/projects/${projectA}"]`)).toBeVisible();
  await page.goto(`/app/projects/${projectA}`);
  await expect(page.getByText("Це заявка, а не активний проєкт")).toHaveCount(0);
  await expect(page.getByText("Дизайн").first()).toBeVisible();
});

test("9. результат етапу: правки → файл від клієнта; небезпечний файл відхиляється", async ({ page }) => {
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
  await page.locator('input[type="file"]').first().setInputFiles({ name: "shell.php.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Завантажити" }).first().click();
  await expect(page.getByText(/Некоректна назва файлу/)).toBeVisible();
});

test("10. зміна замовлення: клієнт просить магазин → адмін оцінює → клієнт погоджує → Scope доповнено, база незмінна", async ({ page }) => {
  await signIn(page, emailA);
  await page.goto(`/app/projects/${projectA}/changes`);
  await page.getByLabel("Що потрібно змінити чи додати?").fill("Інтернет-магазин із кошиком");
  await page.getByLabel("Опис").fill("Потрібно додати каталог товарів і кошик замість односторінкового сайту.");
  await page.getByRole("button", { name: "Надіслати запит на зміну" }).click();
  await expect.poll(async () => (await db.from("change_requests").select("status").eq("project_id", projectA)).data?.[0]?.status, { timeout: 20_000 }).toBe("submitted");
  const crId = (await db.from("change_requests").select("id").eq("project_id", projectA).single()).data!.id as string;
  expect((await db.from("project_scope").select("id").eq("project_id", projectA)).data).toHaveLength(1); // лише базова лінія

  await adminPage.goto(`/admin/projects/${projectA}/workflow`);
  await adminPage.waitForLoadState("networkidle");
  await adminPage.getByLabel("Що входить в оцінку (побачить клієнт)").fill("Каталог, кошик і оформлення замовлення, чотири тижні роботи.");
  await adminPage.getByLabel("Додаткова вартість").fill("48000.50");
  await adminPage.getByLabel("Додатковий термін, дн.").fill("28");
  await adminPage.getByRole("button", { name: "Надіслати оцінку клієнту" }).click();
  await expect.poll(async () => (await db.from("change_requests").select("status").eq("id", crId).single()).data?.status, { timeout: 20_000 }).toBe("quoted");

  await page.goto(`/app/projects/${projectA}/changes`);
  await expect(page.getByText("Оцінено — потрібне ваше рішення")).toBeVisible();
  await page.getByRole("link", { name: "Додаткова угода" }).click();
  await expect(page.getByText(/48000\.50 UAH/)).toBeVisible();
  await page.getByRole("button", { name: "Погодити документ" }).click();
  await expect.poll(async () => (await db.from("change_requests").select("status").eq("id", crId).single()).data?.status, { timeout: 20_000 }).toBe("approved");

  await page.goto(`/app/projects/${projectA}/changes`);
  await expect(page.getByText("Базовий обсяг", { exact: true })).toBeVisible();
  await expect(page.getByText("Погоджена зміна").first()).toBeVisible();
  const scope = (await db.from("project_scope").select("kind,title").eq("project_id", projectA).order("id")).data;
  expect(scope).toEqual([{ kind: "baseline", title: "Сайт-платформа" }, { kind: "amendment", title: "Інтернет-магазин із кошиком" }]);
  // Лише тепер можливі рахунок і робота за зміною.
  await rpc(studioApi, "admin_create_change_invoice", { p_cr: crId });
});

test("11. фінальні файли → вихід і повторний вхід; клієнт знову бачить проєкт", async ({ page }) => {
  await rpc(studioApi, "admin_register_file", { p_project: projectA, p_category: "final", p_name: "site.zip", p_mime: "application/zip", p_size: 4, p_path: `${projectA}/e2e-final-${Date.now()}`, p_visible: true, p_deliverable: null });
  await signIn(page, emailA);
  await page.goto(`/app/projects/${projectA}/documents`);
  await expect(page.getByText("site.zip")).toBeVisible();
  await expect(page.getByText("Погоджено").first()).toBeVisible();
  await expectNoA11yViolations(page, "/documents");

  await page.getByRole("button", { name: "Вийти" }).first().click();
  await page.waitForURL(/\/login/);
  await page.goto(`/app/projects/${projectA}`);
  await expect(page).toHaveURL(/\/login/);
  await loginWithCode(page, emailA);
  sessions.set(emailA, await page.context().cookies()); // вихід відкликає старі сесії
  await page.goto("/app/projects");
  await expect(page.locator(`a[href="/app/projects/${projectA}"]`)).toBeVisible();
});

test("12. передача: адмін готує і відправляє; секрет відхиляється; клієнт приймає; завершення лише після прийняття", async ({ page }) => {
  await adminPage.goto(`/admin/projects/${projectA}/handover`);
  await adminPage.waitForLoadState("networkidle");
  // Порожню передачу відправити не можна.
  await expect(rpc(studioApi, "admin_submit_handover", { p_project: projectA })).rejects.toThrow(/handover_incomplete|not_found/);
  await adminPage.getByLabel("Production URL", { exact: true }).fill("https://example.com");
  await adminPage.getByLabel("Документація (https)", { exact: true }).fill("not-a-url-password=hunter2");
  await adminPage.getByRole("button", { name: "Зберегти чернетку" }).click();
  await expect(adminPage.getByRole("alert").filter({ hasText: /https|паролі|недопустиме/i }).first()).toBeVisible({ timeout: 15_000 });

  // Після відхиленого збереження введене лишається у формі (нічого не скидається): виправляємо лише помилкове поле.
  await expect(adminPage.getByLabel("Production URL", { exact: true })).toHaveValue("https://example.com");
  await expect(adminPage.getByLabel("Документація (https)", { exact: true })).toHaveValue("not-a-url-password=hunter2");
  await adminPage.getByLabel("Документація (https)", { exact: true }).fill("https://example.com/docs");
  await adminPage.getByRole("button", { name: "Зберегти чернетку" }).click();
  await expect(adminPage.getByText("Чернетку передачі збережено.")).toBeVisible({ timeout: 15_000 });
  // Чернетку клієнт не бачить.
  await signIn(page, emailA);
  await page.goto(`/app/projects/${projectA}/handover`);
  await expect(page.getByText("Передачу ще не підготовлено")).toBeVisible();

  await adminPage.reload();
  await adminPage.getByRole("button", { name: "Відправити клієнту на приймання" }).click();
  await expect(adminPage.getByRole("status").filter({ hasText: "Передачу відправлено клієнту на приймання" })).toBeVisible({ timeout: 15_000 });
  await expect(rpc(studioApi, "admin_complete_project", { p_project: projectA, p_warranty_until: null })).rejects.toThrow(/handover_not_accepted/);
  // Повторна відправка тієї ж передачі відхиляється, а лист клієнту рівно один.
  await expect(rpc(studioApi, "admin_submit_handover", { p_project: projectA })).rejects.toThrow(/handover_locked|not_found/);
  expect((await db.from("email_outbox").select("id").eq("project_id", projectA).eq("template", "handover_ready")).data).toHaveLength(1);

  await page.goto(`/app/projects/${projectA}/handover`);
  await expect(page.getByText("https://example.com/docs")).toBeVisible();
  await page.getByRole("button", { name: "Потрібні правки" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Вкажіть, що саме потрібно виправити");
  await page.getByRole("button", { name: "Прийняти передачу" }).click();
  await expect.poll(async () => (await db.from("handover_records").select("status").eq("project_id", projectA).single()).data?.status, { timeout: 20_000 }).toBe("accepted");
  await page.reload();
  await expect(page.getByText("Прийнято", { exact: true }).first()).toBeVisible();

  await adminPage.goto(`/admin/projects/${projectA}/handover`);
  await adminPage.waitForLoadState("networkidle");
  await adminPage.getByRole("button", { name: "Завершити проєкт" }).click();
  await expect.poll(async () => (await db.from("projects").select("status").eq("id", projectA).single()).data?.status, { timeout: 20_000 }).toBe("completed");
});

test("13. підтримка: клієнт створює звернення; адмін відповідає, внутрішня нотатка прихована; результат → клієнт закриває; чужий не бачить", async ({ page, browser }) => {
  await signIn(page, emailA);
  await page.goto("/app/support");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Тема").fill("Кнопка оплати не натискається");
  await page.getByLabel("Опис").fill("Після оновлення кнопка на сторінці кошика не реагує на клік.");
  await page.getByRole("button", { name: "Створити звернення" }).click();
  await page.waitForURL(/\/app\/support\/[0-9a-f-]{36}/, { timeout: 20_000 });
  const ticketId = page.url().match(/support\/([0-9a-f-]{36})/)![1]!;
  await expect(page.getByText(/SUP-\d{4}-\d{5}/).first()).toBeVisible();

  await adminPage.goto(`/admin/support/${ticketId}`);
  await adminPage.waitForLoadState("networkidle");
  await adminPage.getByLabel("Повідомлення").fill("СЕКРЕТНА-ВНУТРІШНЯ-НОТАТКА");
  await adminPage.getByLabel("Внутрішня нотатка (клієнт не побачить)").check();
  await adminPage.getByRole("button", { name: "Надіслати" }).click();
  await expect(adminPage.getByText("Внутрішню нотатку додано.")).toBeVisible({ timeout: 15_000 });
  await adminPage.getByLabel("Повідомлення").fill("Дякуємо, перевіряємо.");
  await adminPage.getByRole("button", { name: "Надіслати" }).click();
  await expect(adminPage.getByText("Відповідь надіслано клієнту.")).toBeVisible({ timeout: 15_000 });

  await page.goto(`/app/support/${ticketId}`);
  await expect(page.getByText("Дякуємо, перевіряємо.")).toBeVisible();
  await expect(page.getByText("СЕКРЕТНА-ВНУТРІШНЯ-НОТАТКА")).toHaveCount(0);

  // Вирішити без результату не можна; з результатом — можна.
  await rpc(studioApi, "admin_update_ticket", { p_ticket: ticketId, p_status: "resolved", p_assignee: null, p_priority: "normal", p_result: "Виправлено в релізі 1.0.1" });
  await page.reload();
  await expect(page.getByText("Виправлено в релізі 1.0.1")).toBeVisible();
  await page.getByRole("button", { name: "Підтвердити, що питання вирішено" }).click();
  await expect.poll(async () => (await db.from("support_tickets").select("status").eq("id", ticketId).single()).data?.status, { timeout: 20_000 }).toBe("closed");

  // Клієнт Б не бачить чужого звернення.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await signIn(other, emailB);
  const res = await other.goto(`/app/support/${ticketId}`);
  expect(res?.status()).toBe(404);
  await ctx.close();
});

test("вхід: повторний запит коду скидає стару помилку; використаний код відхиляється", async ({ page }) => {
  test.setTimeout(300_000);
  // Усі запити з одного хоста CI ділять один IP-кошик; лічильники очищаються, щоб тест перевіряв логіку коду, а не ліміт (його покривають модульні тести).
  expect((await db.from("auth_throttle").delete().gte("window_start", "1970-01-01")).error).toBeNull();
  const since = Date.now();
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(emailB);
  await page.getByRole("button", { name: "Отримати код" }).click();
  await page.getByLabel("Код із листа").fill("000000");
  await page.getByRole("button", { name: "Увійти" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("Код невірний або застарів");
  // Supabase не дозволяє повторний лист тій самій адресі частіше за інтервал max_frequency (за замовчуванням 60 с).
  await page.waitForTimeout(Math.max(0, 62_000 - (Date.now() - since)));
  await page.getByRole("button", { name: "Надіслати код ще раз" }).click();
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
  const { code } = await latestLoginMail(emailB, since + 1);
  await page.getByLabel("Код із листа").fill(code);
  await page.getByRole("button", { name: "Увійти" }).click();
  await page.waitForURL(/\/app/);
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
    await expect(loading).toBeHidden();
    if ((await older.count()) === 0) break;
    await older.click();
  }
  await expect(page.getByText("Історія №1", { exact: true })).toBeVisible();
  const bodies = await page.locator('[role="log"] .whitespace-pre-wrap').allTextContents();
  expect(new Set(bodies).size).toBe(bodies.length);
  expect(bodies).toHaveLength(620);
});

test("адаптивність кабінету: без горизонтального скролу на 320–1920 px, axe на крайніх розмірах", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, emailA);
  const sections = ["", "/messages", "/proposal", "/milestones", "/files", "/documents", "/changes", "/payments", `/documents/${contractId}`];
  const urls = ["/app", "/app/requests", "/app/projects", "/app/profile", "/app/support", ...sections.map((s) => `/app/projects/${projectA}${s}`)];
  for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const url of urls) {
      const response = await page.goto(url, { waitUntil: "networkidle" });
      expect(response?.status(), `${url} @ ${width}`).toBe(200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `горизонтальний скрол ${url} @ ${width}px`).toBeLessThanOrEqual(1);
      if ((width === 320 || width === 1920) && (url.endsWith("/changes") || url.includes("/documents/"))) await expectNoA11yViolations(page, `${url} @ ${width}`);
    }
  }
});
