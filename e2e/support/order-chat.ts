import type { Page } from "@playwright/test";

/** Пропускає всі необов'язкові питання, поки чат не дійде до імені. */
export async function skipToName(page: Page) {
  const nameOrSkip = page.locator("#field-name, button:has-text('Пропустити')").first();
  for (let guard = 0; guard < 12; guard += 1) {
    await nameOrSkip.waitFor();
    if (await page.locator("#field-name").isVisible()) return;
    await page.getByRole("button", { name: "Пропустити" }).click();
  }
}

/** Проходить чат до кроку підтвердження: ім'я, email, без телефону. */
export async function answerToConfirm(page: Page, contact = { name: "Іван", email: "ivan@example.com" }) {
  await skipToName(page);
  await page.locator("#field-name").fill(contact.name);
  await page.getByRole("button", { name: "Далі" }).click();
  await page.locator("#field-phone").waitFor();
  await page.getByRole("button", { name: "Пропустити" }).click();
  await page.locator("#field-email").fill(contact.email);
  await page.getByRole("button", { name: "Далі" }).click();
  await page.locator("#field-consent").waitFor();
}

/** Повна заявка до кнопки «Надіслати заявку» включно з відміткою про згоду. */
export async function fillAndConsent(page: Page) {
  await answerToConfirm(page);
  await page.locator("#field-consent").check();
}

/** Підміняє t.me порожньою сторінкою, щоб тест не ходив у зовнішню мережу. */
export async function stubTelegram(page: Page) {
  await page.route("https://t.me/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>telegram</body></html>" }),
  );
}

/** Перехід у Telegram «зависає»: сторінка лишається з екраном успіху, можна перевірити її стан. */
export async function holdTelegram(page: Page) {
  await page.route("https://t.me/**", () => new Promise<void>(() => undefined));
}
