import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAuthEnv } from "./env";

export class AuthConfigError extends Error {}

/** Supabase-клієнт від імені поточного користувача: усі запити проходять через RLS. */
export async function createSupabaseServerClient() {
  const env = getSupabaseAuthEnv();
  if (!env) throw new AuthConfigError("SUPABASE_URL / SUPABASE_ANON_KEY не задані");
  const cookieStore = await cookies();

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          for (const { name, value, options } of items) cookieStore.set(name, value, options);
        } catch {
          // Виклик із Server Component: оновлення cookie виконує middleware.
        }
      },
    },
  });
}
