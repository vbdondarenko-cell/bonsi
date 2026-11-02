import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("форма заявки", () => {
  test("показує помилки валідації й фокусує перше невалідне поле", async ({ page }) => {
    await page.goto("/contact");
    await page.getByRole("button", { name: "Надіслати заявку" }).click();
    await expect(page.getByText("Потрібна згода на обробку").first()).toBeVisible();
    // Перша помилка — не обрано тип послуги: фокус переходить на групу радіокнопок.
    await expect(page.locator("#field-service")).toBeFocused();
  });

  test("посилання на політику конфіденційності ведеться з форми", async ({ page }) => {
    await page.goto("/contact");
    const link = page.getByRole("link", { name: "політики конфіденційності" });
    await expect(link).toHaveAttribute("href", "/privacy");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("успішна відправка показує номер звернення", async ({ page }) => {
    await page.route("**/api/orders", (route) =>
      route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket: "BON-2026-00042" }) }),
    );
    await page.goto("/contact");
    await page.waitForTimeout(3200);
    await page.locator("input[name='service']").first().check();
    await page.locator("#field-idea").fill("Потрібен односторінковий сайт для нового продукту.");
    await page.locator("select#field-budget").selectOption({ index: 1 });
    await page.locator("select#field-deadline").selectOption({ index: 1 });
    await page.locator("#field-name").fill("Іван");
    await page.locator("#field-email").fill("ivan@example.com");
    await page.locator("#field-consent").check();
    await page.getByRole("button", { name: "Надіслати заявку" }).click();
    await expect(page.getByText("BON-2026-00042")).toBeVisible();
  });

  test("помилка сервера не імітує успіх", async ({ page }) => {
    await page.route("**/api/orders", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }),
    );
    await page.goto("/contact");
    await page.getByRole("button", { name: "Надіслати заявку" }).click();
    await expect(page.getByText("BON-2026")).toHaveCount(0);
  });
});

test.describe("замовлення без зайвих запитань", () => {
  test("послуга з посилання підставляється й не перепитується, показуються лише її уточнення", async ({ page }) => {
    await page.goto("/contact?service=shop");
    await expect(page.locator("#field-service")).toContainText("Інтернет-магазини");
    await expect(page.locator("input[name='service']")).toHaveCount(0);
    const questions = page.getByTestId("service-questions");
    await expect(questions).toContainText("Розмір каталогу");
    await expect(questions).not.toContainText("Для якої платформи?");
    // Усі уточнення, бюджет і терміни — необов'язкові.
    await expect(page.getByText("(необовʼязково)").first()).toBeVisible();
  });

  test("послугу можна змінити, а відповіді іншої послуги скидаються", async ({ page }) => {
    await page.goto("/contact?service=shop");
    await page.getByText("До 50 товарів").click();
    await expect(page.getByRole("radio", { name: "До 50 товарів" })).toBeChecked();
    await page.getByRole("button", { name: "Змінити послугу" }).click();
    await page.locator("label", { hasText: "Мобільні додатки" }).click();
    await expect(page.getByTestId("service-questions")).toContainText("Для якої платформи?");
    await expect(page.getByRole("radio", { name: "До 50 товарів" })).toHaveCount(0);
  });

  test("форма з обраною послугою та уточненнями доступна за axe", async ({ page }) => {
    await page.goto("/contact?service=webapp");
    await expect(page.getByTestId("service-questions")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("невідома послуга в адресі ігнорується", async ({ page }) => {
    await page.goto("/contact?service=hack");
    await expect(page.locator("input[name='service']")).toHaveCount(7);
  });

  test("мінімальна заявка (лише послуга, імʼя, email, згода) надсилається без опису, бюджету й термінів", async ({ page }) => {
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/orders", async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket: "BON-2026-00043" }) });
    });
    await page.goto("/contact?service=landing");
    await page.waitForTimeout(3200);
    await page.locator("#field-name").fill("Іван");
    await page.locator("#field-email").fill("ivan@example.com");
    await page.locator("#field-links").fill("https://example.com/a\nhttps://example.com/b");
    await page.locator("#field-consent").check();
    await page.getByRole("button", { name: "Надіслати заявку" }).click();
    await expect(page.getByText("BON-2026-00043")).toBeVisible();
    expect(sent).toMatchObject({ service: "landing", links: ["https://example.com/a", "https://example.com/b"] });
    expect(sent).not.toHaveProperty("idea");
    expect(sent).not.toHaveProperty("budget");
    expect(sent).not.toHaveProperty("deadline");
  });

  test("некоректне посилання блокується на клієнті", async ({ page }) => {
    await page.goto("/contact?service=landing");
    await page.locator("#field-name").fill("Іван");
    await page.locator("#field-email").fill("ivan@example.com");
    await page.locator("#field-links").fill("javascript:alert(1)");
    await page.locator("#field-consent").check();
    await page.getByRole("button", { name: "Надіслати заявку" }).click();
    await expect(page.locator("#field-links-error")).toBeVisible();
    await expect(page.locator("#field-links")).toBeFocused();
  });

  test("сторінка послуг веде до заявки з уже обраною послугою", async ({ page }) => {
    await page.goto("/services");
    await page.getByRole("link", { name: "Замовити цю послугу" }).first().click();
    await expect(page).toHaveURL(/\/contact\?service=landing/);
    await expect(page.locator("#field-service")).toContainText("Landing Pages");
  });
});

test("skip-link доступний з клавіатури", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти до вмісту" })).toBeFocused();
});
