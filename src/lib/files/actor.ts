import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthState } from "@/lib/admin/guard";
import { getClientState } from "@/lib/client/auth";

export type Actor = { role: "admin" | "client"; supabase: SupabaseClient; userId: string };

/** Хто робить запит до файлового API: адміністратор (aal2) або клієнт. Усе інше — без доступу. */
export async function getActor(): Promise<Actor | null> {
  const admin = await getAuthState();
  if (admin.kind === "admin") return { role: "admin", supabase: admin.supabase, userId: admin.userId };
  const client = await getClientState();
  if (client.kind === "client") return { role: "client", supabase: client.supabase, userId: client.userId };
  return null;
}
