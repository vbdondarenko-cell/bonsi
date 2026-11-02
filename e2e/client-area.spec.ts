import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";

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
    await expectNoA11yViolations(page, "/login");
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

test.describe("видимі точки входу в кабінет", () => {
  test("у шапці й футері є посилання «Кабінет», що веде на /login", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "Кабінет" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Кабінет клієнта" })).toBeVisible();
  });

  test("у мобільному меню є «Кабінет клієнта»", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "Відкрити меню" }).click();
    await expect(page.locator("#mobile-menu").getByRole("link", { name: "Кабінет клієнта" })).toHaveAttribute("href", "/login");
  });

  test("після заявки пропонується увійти в кабінет із підставленою поштою", async ({ page }) => {
    await page.route("**/api/orders", (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ticket: "BON-2026-00099" }) }));
    await page.goto("/contact?service=landing");
    await page.waitForTimeout(3200);
    await page.locator("#field-name").fill("Іван");
    await page.locator("#field-email").fill("Ivan@Example.com");
    await page.locator("#field-consent").check();
    await page.getByRole("button", { name: "Надіслати заявку" }).click();
    const link = page.getByRole("link", { name: "Увійти в кабінет за цією поштою" });
    await expect(link).toHaveAttribute("href", "/login?email=ivan%40example.com");
  });
});

test.describe("розділення входів: на сайті немає шляху до адмінки", () => {
  test("шапка, футер, мобільне меню й sitemap не містять посилань на /admin", async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const path of ["/", "/services", "/contact", "/login"]) {
      await page.goto(path);
      const hrefs = await page.locator("a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
      expect(hrefs.filter((href) => href.includes("/admin")), path).toEqual([]);
    }
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "Відкрити меню" }).click();
    const mobile = await page.locator("#mobile-menu a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(mobile.filter((href) => href.includes("/admin"))).toEqual([]);
    expect(await (await request.get("/sitemap.xml")).text()).not.toContain("/admin");
  });

  test("сторінка входу клієнта не згадує адмінпанель, а вхід адміністратора не пропонує клієнтський вхід", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("main")).not.toContainText(/адмін/i);
    await page.goto("/admin/login");
    await expect(page.locator("main").getByRole("link", { name: /Кабінет клієнта|Отримати код/ })).toHaveCount(0);
  });
});
