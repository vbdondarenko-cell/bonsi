import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const widths = [320, 375, 768, 1024, 1440];
const pages = ["/", "/services", "/portfolio", "/about", "/contact", "/privacy"];

for (const width of widths) {
  for (const url of pages) {
    test(`${url} @ ${width}px`, async ({ page, browserName }) => {
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(e.message));

      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(url, { waitUntil: "networkidle" });
      expect(response?.status()).toBe(200);

      // Прокрутка, щоб спрацювали reveal-анімації перед знімком.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 500) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 40));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(600);

      const overflow = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const bad: string[] = [];
        if (document.documentElement.scrollWidth > vw + 1) bad.push(`document scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
        for (const el of Array.from(document.body.querySelectorAll("*"))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > vw + 1 && !el.closest("[data-allow-overflow]")) {
            const cs = getComputedStyle(el);
            if (cs.position === "fixed" || cs.visibility === "hidden") continue;
            bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`);
            if (bad.length > 5) break;
          }
        }
        return bad;
      });
      expect(overflow, "елементи виходять за межі екрана").toEqual([]);
      expect(errors).toEqual([]);

      if (browserName === "chromium") {
        mkdirSync(".ci/shots", { recursive: true });
        const name = `${url === "/" ? "home" : url.slice(1)}-${width}.png`;
        await page.screenshot({ path: `.ci/shots/${name}`, fullPage: true });

        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        const serious = results.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")}`);
        expect(serious, "a11y").toEqual([]);
      }
    });
  }
}
