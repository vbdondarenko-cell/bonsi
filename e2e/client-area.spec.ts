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

test.describe("етап 2: захист нових маршрутів без авторизації", () => {
  const project = "00000000-0000-4000-8000-000000000000";
  for (const section of ["milestones", "files", "documents", "payments"]) {
    test(`/app/projects/[id]/${section} без сесії веде на /login`, async ({ page }) => {
      await page.goto(`/app/projects/${project}/${section}`);
      await expect(page).toHaveURL(/\/login(\?|$)/);
    });
  }

  test("файли не віддаються без сесії, завантаження без сесії відхиляється", async ({ request }) => {
    const download = await request.get(`/api/files/${project}`, { maxRedirects: 0 });
    expect([401, 503]).toContain(download.status());
    expect(download.headers()["cache-control"]).toContain("no-store");
    const upload = await request.post(`/api/projects/${project}/files`, { multipart: { files: { name: "a.png", mimeType: "image/png", buffer: Buffer.from([1, 2, 3]) } } });
    expect([401, 503]).toContain(upload.status());
  });

  test("webhook платіжного провайдера без ключів мерчанта не активний", async ({ request }) => {
    const response = await request.post("/api/payments/webhook/liqpay", { form: { data: "e30=", signature: "x" } });
    expect(response.status()).toBe(503);
    expect((await request.post("/api/payments/webhook/monobank", { data: {} })).status()).toBe(503);
    expect((await request.post("/api/payments/webhook/unknown", { data: {} })).status()).toBe(404);
    expect((await request.get("/api/payments/webhook/liqpay")).status()).toBe(405);
  });
});
