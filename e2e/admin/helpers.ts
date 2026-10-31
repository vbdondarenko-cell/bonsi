import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import { freshCode, saveSecret } from "./totp";

export const url = process.env.SUPABASE_URL ?? "";
export const db = createClient(url || "http://invalid.local", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "x", {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const STUB = "http://127.0.0.1:4010";
export const CRON_SECRET = "e2e-cron-secret-0123456789abcdef";

export type Account = { email: string; password: string; name: string };

export const founder1: Account = { email: "founder1@bonsi.test", password: "Test-Pass-founder1-9f3k2", name: "Засновник 1" };
export const founder2: Account = { email: "founder2@bonsi.test", password: "Test-Pass-founder2-7h1x8", name: "Засновник 2" };
export const outsider: Account = { email: "outsider@bonsi.test", password: "Test-Pass-outsider-4m6q0", name: "Сторонній" };

/** Створює акаунти в Supabase Auth і заносить двох засновників до allowlist. Ідемпотентно. */
export async function ensureAccounts() {
  const existing = await db.auth.admin.listUsers({ perPage: 100 });
  if (existing.error) throw existing.error;
  const ids = new Map<string, string>(existing.data.users.map((u) => [u.email ?? "", u.id]));

  for (const account of [founder1, founder2, outsider]) {
    if (ids.has(account.email)) continue;
    const created = await db.auth.admin.createUser({ email: account.email, password: account.password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("createUser failed");
    ids.set(account.email, created.data.user.id);
  }

  for (const account of [founder1, founder2]) {
    const { error } = await db
      .from("admin_users")
      .upsert({ user_id: ids.get(account.email)!, email: account.email, display_name: account.name }, { onConflict: "user_id" });
    if (error) throw error;
  }
  return ids;
}

export async function login(page: Page, account: Account) {
  await page.goto("/admin/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Пароль").fill(account.password);
  await page.getByRole("button", { name: "Увійти" }).click();
  await page.waitForURL(/\/admin\/mfa/);
  await page.waitForLoadState("networkidle");

  const enroll = page.getByRole("button", { name: "Налаштувати MFA" });
  const challenge = page.getByLabel(/Код із додатка/);
  await expect(enroll.or(challenge)).toBeVisible();

  if (await enroll.isVisible()) {
    await enroll.click();
    const secret = (await page.getByTestId("mfa-secret").textContent())?.trim();
    expect(secret).toBeTruthy();
    saveSecret(account.email, secret!);
  }

  const code = await freshCode(account.email);
  await page.getByLabel(/Код із додатка/).fill(code);
  await page.getByRole("button", { name: "Підтвердити" }).click();
  await page.waitForURL(/\/admin$/);
}

export async function stub<T = unknown>(path: string): Promise<T> {
  const response = await fetch(`${STUB}${path}`);
  return (await response.json()) as T;
}

export type StubMessage = { path: string; body: { chat_id: string; text: string; parse_mode: string } };

export async function waitForTelegram(match: string, timeoutMs = 20_000): Promise<StubMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const received = await stub<StubMessage[]>("/__received");
    const found = received.find((m) => m.body.text.includes(match));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Telegram не отримав повідомлення з «${match}»`);
}

export function uniqueEmail(prefix: string) {
  return `${prefix}+${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
}
