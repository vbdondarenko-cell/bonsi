import "server-only";
import { createClient } from "@supabase/supabase-js";

export class ServiceConfigError extends Error {}

/** Клієнт з ключем service_role: лише для серверних операцій, що не залежать від користувача. */
export function createSupabaseServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ServiceConfigError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не задані");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
