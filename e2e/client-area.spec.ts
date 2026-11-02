import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Без Supabase у середовищі e2e кабінет чесно показує, що не налаштований, і нічого не імітує.
test.describe("кабінет клієнта без авторизації", () => {
  for (const path of ["/app", "/app/projects", "/app/projects/00000000-0000-4000-8000-000000000000/messages", "/app/profile"]) {
    test(`${path} без сесії веде на /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login(\?|$)/);
    });
  }

  test("/login: порожній стан без Supabase, без індексації, доступний за axe", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Кабінет клієнта" })).toBeVisible();
    await expect(page.locator("main [role=alert]")).toContainText("не налаштований");
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("/login не допускає відкритих перенаправлень через next", async ({ page }) => {
    await page.goto("/login?next=https://evil.example");
    await expect(page).toHaveURL(/\/login/);
    expect(new URL(page.url()).host).not.toContain("evil");
  });

  test("посилання входу з невалідним токеном повертає на /login з помилкою", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=bad&type=email");
    await expect(page).toHaveURL(/\/login\?error=link/);
  });

  test("сторінки кабінету не кешуються й закриті від пошуковиків", async ({ request }) => {
    const response = await request.get("/login");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
  });
});
