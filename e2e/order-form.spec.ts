import { expect, test } from "@playwright/test";

test.describe("форма заявки", () => {
  test("показує помилки валідації й фокусує перше невалідне поле", async ({ page }) => {
    await page.goto("/contact");
    await page.getByRole("button", { name: "Надіслати заявку" }).click();
    await expect(page.getByText("Потрібна згода на обробку").first()).toBeVisible();
    await expect(page.locator("[aria-invalid='true']").first()).toBeFocused();
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

test("skip-link доступний з клавіатури", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти до вмісту" })).toBeFocused();
});
