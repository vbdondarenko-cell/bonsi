import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { AuthConfigError, createSupabaseServerClient } from "@/lib/supabase/server";

export const LOGIN_URL = "/admin/login";
export const MFA_URL = "/admin/mfa";

export type AuthState =
  | { kind: "unconfigured" }
  | { kind: "anonymous" }
  | { kind: "forbidden" }
  | { kind: "needs_mfa"; email: string; hasFactor: boolean; factorId: string | null }
  | { kind: "admin"; supabase: SupabaseClient; userId: string; email: string; displayName: string };

/**
 * Єдине місце, де визначається, хто користувач. Порядок: сесія (getUser звертається до
 * Supabase Auth і не довіряє cookie наосліп) → allowlist → MFA (aal2) → профіль.
 * Навіть якщо цей код пропустить помилково, RLS у базі не віддасть дані без aal2.
 */
export const getAuthState = cache(async (): Promise<AuthState> => {
  let supabase: SupabaseClient;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (error instanceof AuthConfigError) return { kind: "unconfigured" };
    throw error;
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return { kind: "anonymous" };

  const allowlisted = await supabase.rpc("admin_is_allowlisted");
  if (allowlisted.error || allowlisted.data !== true) return { kind: "forbidden" };

  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.error || aal.data.currentLevel !== "aal2") {
    const factors = await supabase.auth.mfa.listFactors();
    const verified = factors.data?.totp.find((factor) => factor.status === "verified") ?? null;
    return {
      kind: "needs_mfa",
      email: user.email ?? "",
      hasFactor: Boolean(verified),
      factorId: verified?.id ?? null,
    };
  }

  const profile = await supabase
    .from("admin_users")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profile.error || !profile.data) return { kind: "forbidden" };

  return {
    kind: "admin",
    supabase,
    userId: user.id,
    email: user.email ?? "",
    displayName: profile.data.display_name as string,
  };
});

/** Для сторінок і дій адмінки: повертає контекст адміністратора або перенаправляє. */
export async function requireAdmin() {
  const state = await getAuthState();
  switch (state.kind) {
    case "admin":
      return state;
    case "needs_mfa":
      redirect(MFA_URL);
    case "forbidden":
      // Користувач увійшов, але не в allowlist: сесію одразу закриваємо.
      await (await createSupabaseServerClient()).auth.signOut();
      redirect(`${LOGIN_URL}?error=forbidden`);
    default:
      redirect(LOGIN_URL);
  }
}
