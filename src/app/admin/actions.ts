"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assignInput, noteInput, statusInput } from "@/lib/admin/orders";
import { getAuthState, requireAdmin } from "@/lib/admin/guard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type ActionState = { ok?: boolean; error?: string; fieldError?: string; notice?: string } | null;

const GENERIC_LOGIN_ERROR = "Невірний email або пароль.";

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

// ---------------------------------------------------------------------------
// Закрита реєстрація: лише запрошені адреси (таблиця admin_invites), лише після підтвердження пошти
// ---------------------------------------------------------------------------
const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Вкажіть коректний email.").max(200),
    password: z.string().min(12, "Пароль має містити щонайменше 12 символів.").max(200),
    confirm: z.string().max(200),
  })
  .refine((value) => value.password === value.confirm, { path: ["confirm"], message: "Паролі не збігаються." });

/** Однакова відповідь для запрошених і незапрошених адрес: не розкриваємо, хто є адміном. */
const REGISTER_NOTICE =
  "Якщо цю адресу запрошено, ми надіслали лист із підтвердженням. Підтвердіть пошту, після цього можна входити.";

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Перевірте введені дані." };

  let invited = false;
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service.rpc("admin_invite_exists", { p_email: parsed.data.email });
    if (error) return { error: "Реєстрація тимчасово недоступна. Спробуйте пізніше." };
    invited = data === true;
  } catch {
    return { error: "Адмін-панель ще не налаштована на сервері." };
  }

  // Незапрошену адресу не передаємо в Supabase: не створюємо акаунтів і не розсилаємо листів стороннім.
  if (!invited) return { ok: true, notice: REGISTER_NOTICE };

  try {
    const supabase = await createSupabaseServerClient();
    const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: site ? { emailRedirectTo: `${site}/admin/login` } : undefined,
    });
    if (error) return { error: "Не вдалося створити акаунт. Перевірте пароль і спробуйте ще раз." };
  } catch {
    return { error: "Адмін-панель ще не налаштована на сервері." };
  }
  return { ok: true, notice: REGISTER_NOTICE };
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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error) return { fieldError: "Код не підійшов. Спробуйте ще раз." };
  redirect("/admin");
}

// ---------------------------------------------------------------------------
// Операції із заявками (кожна перевіряє адміністратора на сервері, а БД — ще раз через RLS/функції)
// ---------------------------------------------------------------------------
const RPC_ERRORS: Record<string, string> = {
  forbidden: "Недостатньо прав.",
  not_found: "Заявку не знайдено.",
  invalid_status: "Некоректний статус.",
  invalid_assignee: "Некоректний виконавець.",
  invalid_note: "Некоректна нотатка.",
};

function rpcMessage(message: string): string {
  const key = Object.keys(RPC_ERRORS).find((code) => message.includes(code));
  return key ? RPC_ERRORS[key]! : "Не вдалося зберегти зміни. Спробуйте ще раз.";
}

export async function updateStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = statusInput.safeParse({ orderId: formData.get("orderId"), status: formData.get("status") });
  if (!parsed.success) return { error: "Некоректні дані." };

  const { error } = await admin.supabase.rpc("admin_set_order_status", {
    p_order: parsed.data.orderId,
    p_status: parsed.data.status,
  });
  if (error) return { error: rpcMessage(error.message) };
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return { ok: true };
}

export async function assignOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = assignInput.safeParse({ orderId: formData.get("orderId"), assignee: formData.get("assignee") ?? "" });
  if (!parsed.success) return { error: "Некоректні дані." };

  const { error } = await admin.supabase.rpc("admin_assign_order", {
    p_order: parsed.data.orderId,
    p_assignee: parsed.data.assignee,
  });
  if (error) return { error: rpcMessage(error.message) };
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true };
}

export async function addNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = noteInput.safeParse({ orderId: formData.get("orderId"), body: formData.get("body") });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Некоректна нотатка." };

  const { error } = await admin.supabase.rpc("admin_add_note", {
    p_order: parsed.data.orderId,
    p_body: parsed.data.body,
  });
  if (error) return { error: rpcMessage(error.message) };
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  return { ok: true };
}
