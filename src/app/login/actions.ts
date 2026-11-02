"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNext } from "@/lib/client/safe-next";
import { isStaffEmail, sessionIsStaff } from "@/lib/client/separation";
import { getClientIp, ipBucket, parseTrustedProxy } from "@/lib/orders/client-ip";
import { hashValue } from "@/lib/orders/service";
import { site } from "@/lib/site";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type LoginState =
  | null
  | { step: "email"; error?: string }
  | { step: "code"; email: string; error?: string; notice?: string };

const emailSchema = z.string().trim().toLowerCase().email().max(200);
const codeSchema = z.string().trim().regex(/^\d{6,8}$/);

const UNAVAILABLE = "Вхід тимчасово недоступний. Спробуйте пізніше.";
const TOO_MANY = "Забагато спроб. Спробуйте за годину.";

/** Скільки разів за годину можна просити код / вводити його: з однієї підмережі та для однієї пошти. */
const LIMITS = { requestIp: 12, requestEmail: 5, verifyEmail: 12, verifyIp: 30 } as const;

async function allowed(kind: keyof typeof LIMITS, subject: string, limit: number) {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("auth_throttle_hit", {
    p_key: hashValue(`login:${kind}:${subject}`),
    p_limit: limit,
    p_window: "1 hour",
  });
  if (error) throw new Error("throttle_failed");
  return data === true;
}

async function ipSubject() {
  const proxy = parseTrustedProxy(process.env.TRUSTED_PROXY);
  return ipBucket(getClientIp(await headers(), proxy)) ?? "unknown";
}

/** Крок 1: надсилає одноразовий код (і посилання) на пошту. Відповідь однакова для нових і наявних адрес. */
export async function requestCodeAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { step: "email", error: "Перевірте адресу email." };

  try {
    const ip = await ipSubject();
    if (!(await allowed("requestIp", ip, LIMITS.requestIp)) || !(await allowed("requestEmail", email.data, LIMITS.requestEmail))) {
      return { step: "email", error: TOO_MANY };
    }
    // Адміністратори входять лише через /admin: код їм не надсилаємо, а відповідь та сама, що й для всіх.
    if (await isStaffEmail(email.data)) {
      return { step: "code", email: email.data, notice: "Ми надіслали лист із кодом і посиланням для входу." };
    }
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.data,
      options: { shouldCreateUser: true, emailRedirectTo: `${site.url}/auth/confirm` },
    });
    // Лише службові поля (без email/токенів), щоб відрізнити ліміт Supabase від збою доставки.
    if (error) console.error("[login] signInWithOtp failed", error.status, error.code);
    if (error && error.status !== 429) return { step: "email", error: UNAVAILABLE };
    if (error) return { step: "email", error: TOO_MANY };
  } catch {
    return { step: "email", error: UNAVAILABLE };
  }
  return { step: "code", email: email.data, notice: "Ми надіслали лист із кодом і посиланням для входу." };
}

/** Крок 2: перевіряє код, створює сесію, прив'язує заявки до підтвердженої особи. */
export async function verifyCodeAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const code = codeSchema.safeParse(formData.get("code"));
  if (!email.success) return { step: "email", error: "Перевірте адресу email." };
  if (!code.success) return { step: "code", email: email.data, error: "Введіть код із листа (6–8 цифр)." };

  try {
    const ip = await ipSubject();
    if (!(await allowed("verifyEmail", email.data, LIMITS.verifyEmail)) || !(await allowed("verifyIp", ip, LIMITS.verifyIp))) {
      return { step: "code", email: email.data, error: TOO_MANY };
    }
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ email: email.data, token: code.data, type: "email" });
    if (error) return { step: "code", email: email.data, error: "Код невірний або застарів. Запросіть новий." };
    // Сесія адміністратора через клієнтські двері не допускається: закриваємо її й відповідаємо як на невірний код.
    if (await sessionIsStaff(supabase)) {
      await supabase.auth.signOut();
      return { step: "code", email: email.data, error: "Код невірний або застарів. Запросіть новий." };
    }
    await supabase.rpc("client_claim_orders");
  } catch {
    return { step: "code", email: email.data, error: UNAVAILABLE };
  }
  redirect(safeNext(String(formData.get("next") ?? "")));
}

export async function signOutClientAction() {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // без сесії виходити нема з чого
  }
  redirect("/login");
}
