import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Прозорість нижче цього порогу вважається «ще з'являється». Відхилення до 5% (наприклад, scroll-linked ефект героя у WebKit:
 * 0.98 на верху сторінки) змінює контраст менш ніж на 0.1:1 і не є анімацією появи.
 */
const FADING_BELOW = 0.95;

/**
 * Дочікується, поки всі анімації появи (Reveal: opacity 0 → 1) завершаться. axe рахує контраст за поточним кольором елемента,
 * тож під час появи (напівпрозорий текст) він дає хибні порушення 3.3–4.4:1. Очікування детерміноване: умова на стан DOM, а не пауза.
 */
export async function settleMotion(page: Page) {
  await expect
    .poll(
      async () => {
        // whileInView спрацьовує лише для елемента, що реально перетнув вʼюпорт: на кожній ітерації підводимо до вʼюпорту ще прихований блок
        // (у WebKit IntersectionObserver інколи потребує кількох кадрів, тому перевірка повторюється, а не чекає фіксований час).
        return page.evaluate(async (threshold) => {
          const hidden = () =>
            Array.from(document.querySelectorAll<HTMLElement>("[style*='opacity']")).filter(
              (el) => !el.closest("[aria-hidden='true']") && Number(getComputedStyle(el).opacity) < threshold,
            );
          for (const el of hidden()) {
            el.scrollIntoView({ block: "center", behavior: "instant" });
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
          // Анімації, привʼязані до прокручування (індикатор прогресу), не «завершуються» за часом: рахуємо лише часові.
          const running = document
            .getAnimations()
            .filter((animation) => animation.timeline === document.timeline && animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity);
          const left = hidden().map((el) => `${el.tagName}.${String(el.className).slice(0, 40)} opacity=${getComputedStyle(el).opacity} text="${(el.textContent ?? "").slice(0, 30)}"`);
          return { fading: left, running: running.length };
        }, FADING_BELOW);
      },
      { message: "анімації появи не завершились", timeout: 15_000, intervals: [100, 250, 500, 1000] },
    )
    .toEqual({ fading: [], running: 0 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
}

/** axe без жодних вимкнених правил; повертає порушення з коротким описом для зрозумілого звіту. */
export async function expectNoA11yViolations(page: Page, context = "") {
  await settleMotion(page);
  const results = await new AxeBuilder({ page }).analyze();
  const summary = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => ({
      target: node.target.join(" "),
      detail: node.any[0]?.message ?? node.failureSummary,
    })),
  }));
  expect(summary, `a11y ${context}`).toEqual([]);
}
