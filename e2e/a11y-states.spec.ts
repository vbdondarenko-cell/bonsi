import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";

/** Контраст і доступність у всіх станах форми заявки й входу: звичайний, hover, focus, selected, error, disabled, success. */
const viewports = [
  { name: "mobile 375", width: 375, height: 800 },
  { name: "desktop 1280", width: 1280, height: 900 },
];

async function fillValid(page: Page) {
  await page.locator("#field-name").fill("Іван");
  await page.locator("#field-email").fill("ivan@example.com");
  await page.locator("#field-consent").check();
}

for (const viewport of viewports) {
  test.describe(`a11y-стани @ ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

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
      await page.getByText("До 50 товарів").click();
      await expectNoA11yViolations(page, "selected chip");
      await page.getByText("Понад 500 товарів").hover();
      await expectNoA11yViolations(page, "chip hover");
      await page.locator("input[name='detail-payments']").first().focus();
      await page.keyboard.press("Tab");
      await expectNoA11yViolations(page, "chip focus-visible");
    });

    test("вибір послуги радіокнопками: hover і selected", async ({ page }) => {
      await page.goto("/contact");
      await page.getByText("Інтернет-магазини").click();
      await expectNoA11yViolations(page, "service selected");
      await page.getByText("Вебзастосунки").hover();
      await expectNoA11yViolations(page, "service hover");
    });

    test("помилки валідації (error state)", async ({ page }) => {
      await page.goto("/contact?service=landing");
      await page.locator("#field-links").fill("javascript:alert(1)");
      await page.getByRole("button", { name: "Надіслати заявку" }).click();
      await expect(page.locator("#field-links-error")).toBeVisible();
      await expectNoA11yViolations(page, "error");
    });

    test("форма під час відправки (disabled state)", async ({ page }) => {
      await page.route("**/api/orders", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket: "BON-2026-00001" }) });
      });
      await page.goto("/contact?service=landing");
      await page.waitForTimeout(3200); // мінімальний час заповнення форми (антиспам), а не маскування тесту
      await fillValid(page);
      await page.getByRole("button", { name: "Надіслати заявку" }).click();
      await expect(page.getByRole("button", { name: "Надсилаємо…" })).toBeDisabled();
      await expectNoA11yViolations(page, "submitting");
    });

    test("успішна відправка (success state)", async ({ page }) => {
      await page.route("**/api/orders", (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket: "BON-2026-00001" }) }));
      await page.goto("/contact?service=landing");
      await page.waitForTimeout(3200);
      await fillValid(page);
      await page.getByRole("button", { name: "Надіслати заявку" }).click();
      await expect(page.getByText("BON-2026-00001")).toBeVisible();
      await expectNoA11yViolations(page, "success");
    });

    test("/login і сторінка помилки посилання", async ({ page }) => {
      await page.goto("/login");
      await expectNoA11yViolations(page, "login");
      await page.goto("/login?error=link");
      await expectNoA11yViolations(page, "login error");
    });

    test("головна, послуги, портфоліо, про нас", async ({ page }) => {
      for (const path of ["/", "/services", "/portfolio", "/about", "/privacy"]) {
        await page.goto(path);
        await expectNoA11yViolations(page, path);
      }
    });
  });
}
