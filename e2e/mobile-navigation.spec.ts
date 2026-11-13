import { expect, test } from "@playwright/test";

const mobileViewports = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

test.describe("mobile navigation", () => {
  for (const viewport of mobileViewports) {
    test(`opens, closes, and fits at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");

      const toggle = page.getByRole("button", { name: "Відкрити меню" });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(page.locator("#mobile-menu")).toBeVisible();
      await expect(page.getByRole("button", { name: "Закрити меню" })).toHaveAttribute("aria-expanded", "true");
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden");

      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        menu: document.querySelector<HTMLElement>("#mobile-menu")?.getBoundingClientRect().width ?? 0,
        menuTop: document.querySelector<HTMLElement>("#mobile-menu")?.getBoundingClientRect().top ?? 0,
        headerBottom: document.querySelector("header")?.getBoundingClientRect().bottom ?? 0,
      }));
      expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
      expect(dimensions.menu).toBeLessThanOrEqual(dimensions.viewport);
      expect(dimensions.menuTop).toBeGreaterThanOrEqual(dimensions.headerBottom);
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);

      await page.getByRole("button", { name: "Закрити меню" }).click();
      await expect(page.locator("#mobile-menu")).toBeHidden();
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe("hidden");
    });
  }

  test("closes on Escape and restores focus to the toggle", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Відкрити меню" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#mobile-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#mobile-menu")).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test("closes when the user taps outside the panel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Відкрити меню" }).click();
    await expect(page.locator("#mobile-menu")).toBeVisible();
    await page.touchscreen.tap(195, 32);
    await expect(page.locator("#mobile-menu")).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe("hidden");
  });

  test("closes on navigation and on same-page hash links", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Відкрити меню" }).click();
    await page.locator("#mobile-menu").getByRole("link", { name: "Послуги" }).click();
    await expect(page).toHaveURL(/\/services$/);
    await expect(page.locator("#mobile-menu")).toBeHidden();

    await page.goto("/");
    await page.getByRole("button", { name: "Відкрити меню" }).click();
    await page.locator("#mobile-menu").getByRole("link", { name: "Обговорити проєкт" }).click();
    await expect(page).toHaveURL(/#order$/);
    await expect(page.locator("#mobile-menu")).toBeHidden();
  });

  test("hydrates without React hydration errors", async ({ page }) => {
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /hydration|hydrated|server html/i.test(message.text())) {
        hydrationErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      if (/hydration|hydrated|server html/i.test(error.message)) hydrationErrors.push(error.message);
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Відкрити меню" })).toBeVisible();
    expect(hydrationErrors).toEqual([]);
  });

  test("browser back restores the previous route with the menu closed", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Відкрити меню" }).tap();
    await page.locator("#mobile-menu").getByRole("link", { name: "Послуги" }).tap();
    await expect(page).toHaveURL(/\/services$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("#mobile-menu")).toBeHidden();
    await expect(page.getByRole("button", { name: "Відкрити меню" })).toHaveAttribute("aria-expanded", "false");
  });

  test("supports keyboard focus traversal and has a 44px touch target", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const previous = await page.evaluate(() => ({
      body: document.body.style.overflow,
      root: document.documentElement.style.overflow,
    }));
    await page.getByRole("button", { name: "Відкрити меню" }).focus();
    await page.keyboard.press("Enter");
    const toggle = page.getByRole("button", { name: "Закрити меню" });
    const target = await toggle.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(target?.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Tab");
    await expect(page.locator("#mobile-menu").getByRole("link").first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => ({
      body: document.body.style.overflow,
      root: document.documentElement.style.overflow,
    }))).toEqual(previous);
  });

  test("opens and follows a link with touch input", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Відкрити меню" }).tap();
    await expect(page.locator("#mobile-menu")).toBeVisible();
    await page.locator("#mobile-menu").getByRole("link", { name: "Послуги" }).tap();
    await expect(page).toHaveURL(/\/services$/);
    await expect(page.locator("#mobile-menu")).toBeHidden();
  });

  test("handles rapid toggles and closes when crossing to desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole("button", { name: "Відкрити меню" }).click();
      await page.getByRole("button", { name: "Закрити меню" }).click();
    }
    await page.getByRole("button", { name: "Відкрити меню" }).click();
    await page.setViewportSize({ width: 667, height: 375 });
    await expect(page.locator("#mobile-menu")).toBeVisible();
    const landscapeWidths = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.scrollWidth]);
    expect(landscapeWidths[1]).toBeLessThanOrEqual(landscapeWidths[0] + 1);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator("#mobile-menu")).toBeHidden();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe("hidden");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#mobile-menu")).toBeHidden();
  });

  test("keeps page scrolling locked while the menu is open and honors reduced motion", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 500));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.getByRole("button", { name: "Відкрити меню" }).click();
    await page.mouse.wheel(0, 800);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await expect(page.locator("#mobile-menu")).toBeVisible();
    await expect(page.locator("header button span > span").first()).toHaveCSS("transition-property", "none");
    await page.getByRole("button", { name: "Закрити меню" }).tap();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });

  for (const viewport of [{ width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    test(`keeps desktop/tablet layouts within ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      const toggle = page.getByRole("button", { name: /меню/ });
      await expect(toggle).toBeHidden();
      const widths = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.scrollWidth]);
      expect(widths[1]).toBeLessThanOrEqual(widths[0] + 1);
    });
  }
});
