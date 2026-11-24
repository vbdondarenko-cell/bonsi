import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { fillAndConsent, skipToName } from "./support/order-chat";

/** Контраст і доступність у всіх станах чат-заявки й входу: звичайний, hover, focus, selected, error, disabled, success. */
const viewports = [
  { name: "mobile 375", width: 375, height: 800 },
  { name: "desktop 1280", width: 1280, height: 900 },
];

async function fillValid(page: Page) {
  await fillAndConsent(page);
}

for (const viewport of viewports) {
  test.describe(`a11y-стани @ ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: "reduce" });

    test("/contact: звичайний стан без обраної послуги", async ({ page }) => {
      await page.goto("/contact");
      await expectNoA11yViolations(page, "default");
    });

    test("/contact?service=shop: обрана послуга й уточнення", async ({ page }) => {
      await page.goto("/contact?service=shop");
      await expectNoA11yViolations(page, "preselected");
    });

    test("вибрана відповідь, hover і keyboard focus на уточненнях", async ({ page }) => {
      await page.goto("/contact?service=shop");
      await page.getByRole("button", { name: "Понад 500 товарів" }).hover();
      await expectNoA11yViolations(page, "chip hover");
      await page.getByRole("button", { name: "До 50 товарів" }).focus();
      await expectNoA11yViolations(page, "chip focus-visible");
      await page.getByRole("button", { name: "До 50 товарів" }).click();
      await expect(page.getByRole("log")).toContainText("До 50 товарів");
      await expectNoA11yViolations(page, "answered chip");
    });

    test("вибір послуги чипами: hover і відповідь у чаті", async ({ page }) => {
      await page.goto("/contact");
      await page.getByRole("button", { name: "Вебзастосунки" }).hover();
      await expectNoA11yViolations(page, "service hover");
      await page.getByRole("button", { name: "Інтернет-магазини" }).click();
      await expect(page.getByRole("log")).toContainText("Розмір каталогу");
      await expectNoA11yViolations(page, "service answered");
    });

    test("помилки валідації (error state)", async ({ page }) => {
      await page.goto("/contact?service=landing");
      await skipToName(page);
      await page.getByRole("button", { name: "Далі" }).click();
      await expect(page.locator("#field-name-error")).toBeVisible();
      await expectNoA11yViolations(page, "error");
    });

    test("форма під час відправки (disabled state)", async ({ page }) => {
      // Сервер «думає» без кінця: стан відправки стабільний для перевірки axe.
      await page.route("**/api/orders", () => new Promise<void>(() => undefined));
      await page.goto("/contact?service=landing");
      await page.waitForTimeout(3200); // мінімальний час заповнення форми (антиспам), а не маскування тесту
      await fillValid(page);
      await page.getByRole("button", { name: "Надіслати заявку" }).click();
      await expect(page.getByRole("button", { name: "Надсилаємо…" })).toBeDisabled();
      await expectNoA11yViolations(page, "submitting");
    });

    // Екран успіху більше не перевіряється axe: після 201 клієнта одразу перекидає в Telegram
    // (див. «успішна відправка…» в order-form.spec.ts).

    test("головна, послуги, портфоліо, про нас", async ({ page }) => {      for (const path of ["/", "/services", "/portfolio", "/about", "/privacy", "/process", "/faq", "/terms", "/cooperation"]) {
        await page.goto(path);
        await expectNoA11yViolations(page, path);
      }
    });
  });
}
