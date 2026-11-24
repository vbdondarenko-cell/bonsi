import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { answerToConfirm, fillAndConsent, skipToName, stubTelegram } from "./support/order-chat";

// Без анімації «друкує…»: тести проходять швидше, а сама пауза покрита reduced-motion логікою компонента.
test.use({ reducedMotion: "reduce" });

test.describe("чат-заявка", () => {
  test("без згоди заявка не надсилається", async ({ page }) => {
    await page.goto("/contact?service=landing");
    await answerToConfirm(page);
    await page.getByRole("button", { name: "Надіслати заявку" }).click();
    await expect(page.getByText("Потрібна згода на обробку").first()).toBeVisible();
  });

  test("порожнє імʼя блокує перехід і повертає фокус у поле", async ({ page }) => {
    await page.goto("/contact?service=landing");
    await skipToName(page);
    await page.getByRole("button", { name: "Далі" }).click();
    await expect(page.locator("#field-name-error")).toBeVisible();
    await expect(page.locator("#field-name")).toBeFocused();
  });

  test("посилання на політику конфіденційності ведеться з підтвердження", async ({ page }) => {
    await page.goto("/contact?service=landing");
    await answerToConfirm(page);
    const link = page.getByRole("link", { name: "політики конфіденційності" });
    await expect(link).toHaveAttribute("href", "/privacy");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("успішна відправка показує номер і веде в Telegram @bonsi_studio з готовим повідомленням", async ({ page }) => {
    await page.route("**/api/orders", (route) =>
      route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket: "BON-2026-00042" }) }),
    );
    await page.goto("/contact");
    await page.waitForTimeout(3200);
    await page.getByRole("button", { name: "Landing Page" }).click();
    await fillAndConsent(page);
    await page.route("https://t.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>telegram</body></html>" }));
    await page.getByRole("button", { name: "Надіслати заявку" }).click();
    // Миттєве автоматичне перенаправлення в чат студії з номером звернення в тексті.
    await page.waitForURL(/^https:\/\/t\.me\/bonsi_studio\?text=/);
    const url = new URL(page.url());
    expect(url.origin + url.pathname).toBe("https://t.me/bonsi_studio");
    expect(url.searchParams.get("text")).toContain("BON-2026-00042");
  });

  test("збій сервера не імітує успіх, а перекидає в Telegram напряму з готовим текстом", async ({ page }) => {
    await page.route("**/api/orders", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }),
    );
    await page.goto("/contact?service=landing");
    await page.waitForTimeout(3200);
    await fillAndConsent(page);
    await page.route("https://t.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>telegram</body></html>" }));
    await page.getByRole("button", { name: "Надіслати заявку" }).click();
    await page.waitForURL(/^https:\/\/t\.me\/bonsi_studio\?text=/);
    const text = new URL(page.url()).searchParams.get("text") ?? "";
    expect(text).toContain("сайт не зберіг");
    expect(text).not.toContain("BON-2026");
  });
});

test.describe("опитування без зайвих запитань і без цін", () => {
  test("у чаті немає жодних цін: ні в послугах, ні в пакетах підтримки", async ({ page }) => {
    await page.goto("/contact");
    await expect(page.getByRole("button", { name: "Landing Page" })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("₴");
    await page.getByRole("button", { name: "Технічна підтримка" }).click();
    await expect(page.getByRole("button", { name: /Business/ })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("₴");
    await expect(page.locator("main")).not.toContainText("бюджет");
  });

  test("послуга з посилання підставляється й не перепитується, показуються лише її уточнення", async ({ page }) => {
    await page.goto("/contact?service=shop");
    await expect(page.getByRole("log")).toContainText("Інтернет-магазини");
    await expect(page.getByRole("log")).toContainText("Розмір каталогу");
    await expect(page.getByRole("log")).not.toContainText("Для якої платформи?");
    await expect(page.getByRole("button", { name: "Пропустити" })).toBeVisible();
  });

  test("послугу можна змінити, а відповіді іншої послуги скидаються", async ({ page }) => {
    await page.goto("/contact?service=shop");
    await page.getByRole("button", { name: "До 50 товарів" }).click();
    await page.getByRole("button", { name: /Інтернет-магазини.*Змінити відповідь/ }).click();
    await page.getByRole("button", { name: "Мобільні застосунки" }).click();
    await expect(page.getByRole("log")).toContainText("Для якої платформи?");
    await expect(page.getByRole("log")).not.toContainText("До 50 товарів");
  });

  test("чат із обраною послугою доступний за axe", async ({ page }) => {
    await page.goto("/contact?service=webapp");
    await expect(page.getByRole("log")).toContainText("Що саме потрібно?");
    await expectNoA11yViolations(page, "/contact?service=webapp");
  });

  test("невідома послуга в адресі ігнорується: чат починається з вибору послуги", async ({ page }) => {
    await page.goto("/contact?service=hack");
    await expect(page.getByRole("log")).toContainText("Яка послуга вас цікавить?");
  });

  test("email обов'язковий, а заявка без опису й термінів надсилається", async ({ page }) => {
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/orders", async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket: "BON-2026-00043" }) });
    });
    await stubTelegram(page);
    await page.goto("/contact?service=landing");
    await page.waitForTimeout(3200);
    await skipToName(page);
    await page.locator("#field-name").fill("Іван");
    await page.getByRole("button", { name: "Далі" }).click();
    await page.locator("#field-phone").fill("@bonsi_client");
    await page.getByRole("button", { name: "Далі" }).click();
    await page.getByRole("button", { name: "Далі" }).click();
    await expect(page.locator("#field-email-error")).toBeVisible();
    await expect(page.locator("#field-email")).toBeFocused();
    await page.locator("#field-email").fill("ivan@example.com");
    await page.getByRole("button", { name: "Далі" }).click();
    await page.locator("#field-consent").check();
    await page.getByRole("button", { name: "Надіслати заявку" }).click();
    await page.waitForURL(/^https:\/\/t\.me\/bonsi_studio/);
    expect(sent).toMatchObject({ service: "landing", phone: "@bonsi_client", email: "ivan@example.com" });
    expect(sent).not.toHaveProperty("idea");
    expect(sent).not.toHaveProperty("budget");
    expect(sent).not.toHaveProperty("deadline");
  });

  test("посилання на приклади йдуть у заявку, а некоректне блокується на клієнті", async ({ page }) => {
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/orders", async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket: "BON-2026-00044" }) });
    });
    await stubTelegram(page);
    await page.goto("/contact?service=landing");
    await page.waitForTimeout(3200);
    // goal, content, deadline, idea → links
    for (let i = 0; i < 4; i += 1) await page.getByRole("button", { name: "Пропустити" }).click();
    await page.locator("#field-links").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Далі" }).click();
    await expect(page.locator("#field-links-error")).toBeVisible();
    await expect(page.locator("#field-links")).toBeFocused();
    await page.locator("#field-links").fill("https://example.com/a\nhttps://example.com/b");
    await page.getByRole("button", { name: "Далі" }).click();
    await page.locator("#field-name").fill("Іван");
    await page.getByRole("button", { name: "Далі" }).click();
    await page.getByRole("button", { name: "Пропустити" }).click();
    await page.locator("#field-email").fill("ivan@example.com");
    await page.getByRole("button", { name: "Далі" }).click();
    await page.locator("#field-consent").check();
    await page.getByRole("button", { name: "Надіслати заявку" }).click();
    await page.waitForURL(/^https:\/\/t\.me\/bonsi_studio/);
    expect(sent).toMatchObject({ links: ["https://example.com/a", "https://example.com/b"] });
  });

  test("сторінка послуг веде до заявки з уже обраною послугою", async ({ page }) => {
    await page.goto("/services");
    await page.getByRole("link", { name: "Замовити послугу" }).first().click();
    await expect(page).toHaveURL(/\/contact\?service=landing/);
    await expect(page.getByRole("log")).toContainText("Landing Page");
  });
});

test("skip-link доступний з клавіатури", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти до вмісту" })).toBeFocused();
});
