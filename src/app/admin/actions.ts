"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthState } from "@/lib/admin/guard";
import { getClientIp, ipBucket, parseTrustedProxy } from "@/lib/orders/client-ip";
import { hashValue } from "@/lib/orders/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type ActionState = { ok?: boolean; error?: string; fieldError?: string; notice?: string } | null;

const GENERIC_LOGIN_ERROR = "Невірний email або пароль.";
const TOO_MANY_ATTEMPTS = "Забагато спроб. Спробуйте пізніше.";

/** Серверний ліміт спроб входу адміна (поверх лімітів Supabase): за годину з однієї підмережі та для однієї адреси/фактора. */
async function adminThrottleOk(kind: "login" | "mfa", subject: string, limit: number): Promise<boolean> {
  try {
    const proxy = parseTrustedProxy(process.env.TRUSTED_PROXY);
    const ip = ipBucket(getClientIp(await headers(), proxy)) ?? "unknown";
    const service = createSupabaseServiceClient();
    for (const [scope, who, max] of [["ip", ip, limit * 3], ["id", subject, limit]] as const) {
      const { data, error } = await service.rpc("auth_throttle_hit", {
        p_key: hashValue(`admin:${kind}:${scope}:${who}`),
        p_limit: max,
        p_window: "1 hour",
      });
      if (error || data !== true) return false;
    }
    return true;
  } catch {
    // Якщо лічильник недоступний, краще відмовити, ніж пропустити перебір.
    return false;
  }
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: GENERIC_LOGIN_ERROR };
  if (!(await adminThrottleOk("login", parsed.data.email, 10))) return { error: TOO_MANY_ATTEMPTS };

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return { error: "Адмін-панель ще не налаштована на сервері." };
  }

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: GENERIC_LOGIN_ERROR };

  // Не в allowlist → та сама загальна помилка (не розкриваємо, чи існує акаунт).
  const allowlisted = await supabase.rpc("admin_is_allowlisted");
  if (allowlisted.error || allowlisted.data !== true) {
    await supabase.auth.signOut();
    return { error: GENERIC_LOGIN_ERROR };
  }
  redirect("/admin");
}

export async function signOutAction(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } finally {
    redirect("/admin/login");
  }
}

// ---------------------------------------------------------------------------
// MFA (TOTP)
// ---------------------------------------------------------------------------
export type EnrollResult =
  | { ok: true; factorId: string; qr: string; secret: string }
  | { ok: false; error: string };

export async function startMfaEnrollAction(): Promise<EnrollResult> {
  const state = await getAuthState();
  if (state.kind !== "needs_mfa" || state.hasFactor) return { ok: false, error: "Налаштування MFA недоступне." };

  const supabase = await createSupabaseServerClient();
  // Прибираємо покинуті неверифіковані фактори, щоб не накопичувались.
  const factors = await supabase.auth.mfa.listFactors();
  for (const factor of factors.data?.all ?? []) {
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "BONSI Admin" });
  if (error || !data) return { ok: false, error: "Не вдалося почати налаштування MFA." };
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

const codeSchema = z.object({
  factorId: z.string().uuid(),
  code: z.string().trim().regex(/^\d{6}$/),
});

export async function verifyMfaAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const state = await getAuthState();
  if (state.kind !== "needs_mfa") redirect("/admin/login");

  const parsed = codeSchema.safeParse({ factorId: formData.get("factorId"), code: formData.get("code") });
  if (!parsed.success) return { fieldError: "Введіть 6 цифр з додатка-автентифікатора." };
  if (!(await adminThrottleOk("mfa", parsed.data.factorId, 10))) return { fieldError: TOO_MANY_ATTEMPTS };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error) return { fieldError: "Код не підійшов. Спробуйте ще раз." };
  redirect("/admin");
}
