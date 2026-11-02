import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import { ensureAccounts, founder1 } from "../admin/helpers";
import { freshCode, saveSecret } from "../admin/totp";

export const MAIL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type MailSummary = { ID: string; To: Array<{ Address: string }>; Created: string };

/** Читає останній лист для адреси з Mailpit (локальний SMTP-приймач Supabase) і дістає з нього код та посилання входу. */
export async function latestLoginMail(email: string, since: number, timeoutMs = 20_000): Promise<{ code: string; link: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${MAIL}/api/v1/messages?limit=100`)).json()) as { messages: MailSummary[] };
    const hit = list.messages.filter((m) => m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()) && new Date(m.Created).getTime() >= since - 2000)[0];
    if (hit) {
      const full = (await (await fetch(`${MAIL}/api/v1/message/${hit.ID}`)).json()) as { Text?: string; HTML?: string };
      const text = `${full.Text ?? ""}\n${full.HTML ?? ""}`;
      const code = text.match(/\b(\d{6,8})\b/)?.[1];
      const link = text.match(/https?:\/\/[^\s"'<>]+\/auth\/confirm\?[^\s"'<>]+/)?.[0]?.replace(/&amp;/g, "&");
      if (code && link) return { code, link };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Лист із кодом для ${email} не надійшов у Mailpit`);
}

/** Вхід клієнта: email → код із листа → кабінет. */
export async function loginWithCode(page: Page, email: string) {
  const since = Date.now();
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Отримати код" }).click();
  await expect(page.getByLabel("Код із листа")).toBeVisible();
  const { code } = await latestLoginMail(email, since);
  await page.getByLabel("Код із листа").fill(code);
  await page.getByRole("button", { name: "Увійти" }).click();
  await page.waitForURL(/\/app/);
}

/** Сеанс студії (адміністратор з aal2) для дій, яких клієнт не бачить: відповіді, пропозиції, рахунки, підтвердження оплат. */
export async function studio(): Promise<SupabaseClient> {
  await ensureAccounts();
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await client.auth.signInWithPassword({ email: founder1.email, password: founder1.password });
  if (signed.error) throw signed.error;
  const factors = await client.auth.mfa.listFactors();
  let factorId = factors.data?.totp.find((f) => f.status === "verified")?.id;
  if (!factorId) {
    const enrolled = await client.auth.mfa.enroll({ factorType: "totp" });
    if (enrolled.error) throw enrolled.error;
    saveSecret(founder1.email, enrolled.data.totp.secret);
    factorId = enrolled.data.id;
  }
  const challenge = await client.auth.mfa.challenge({ factorId });
  if (challenge.error) throw challenge.error;
  const verified = await client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: await freshCode(founder1.email) });
  if (verified.error) throw verified.error;
  return client;
}

export async function rpc<T = unknown>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as T;
}
