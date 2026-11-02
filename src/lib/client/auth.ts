import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { AuthConfigError, createSupabaseServerClient } from "@/lib/supabase/server";

export const CLIENT_LOGIN_URL = "/login";

export type ClientState =
  | { kind: "unconfigured" }
  | { kind: "anonymous" }
  /** Адміністратор студії: його місце в /admin, у кабінеті клієнта він не працює. */
  | { kind: "admin" }
  | { kind: "client"; supabase: SupabaseClient; userId: string; email: string; displayName: string };

/**
 * Єдине місце, де визначається, чи є поточна сесія клієнтською. getUser() перевіряє сесію в Supabase Auth,
 * а всі подальші читання йдуть через RLS від імені користувача: навіть помилка тут не віддасть чужих даних.
 */
export const getClientState = cache(async (): Promise<ClientState> => {
  let supabase: SupabaseClient;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (error instanceof AuthConfigError) return { kind: "unconfigured" };
    throw error;
  }

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return { kind: "anonymous" };

  const allowlisted = await supabase.rpc("admin_is_allowlisted");
  if (allowlisted.data === true) return { kind: "admin" };

  // Заявки, подані з цією (підтвердженою) поштою, прив'язуються до користувача; операція ідемпотентна.
  await supabase.rpc("client_claim_orders");

  const profile = await supabase.from("client_profiles").select("display_name").eq("user_id", user.id).maybeSingle();
  return {
    kind: "client",
    supabase,
    userId: user.id,
    email: user.email ?? "",
    displayName: (profile.data?.display_name as string | undefined) || "",
  };
});

/** Для сторінок і дій кабінету: повертає контекст клієнта або перенаправляє. */
export async function requireClient() {
  const state = await getClientState();
  switch (state.kind) {
    case "client":
      return state;
    case "admin":
      // Кабінет клієнта для адміністратора не існує: його вхід і робоче місце — лише /admin.
      notFound();
    default:
      redirect(CLIENT_LOGIN_URL);
  }
}
