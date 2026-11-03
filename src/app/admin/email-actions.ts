"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/guard";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { ActionState } from "./actions";

/** Повертає в чергу невдалі листи (крім прострочених) для нової спроби. Лише адміністратор; зміну виконує сервер від service_role. */
export async function retryFailedEmailsAction(): Promise<ActionState> {
  await requireAdmin();
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("email_outbox")
      .update({ status: "pending", attempts: 0, next_attempt_at: new Date().toISOString(), locked_until: null })
      .eq("status", "failed")
      .neq("last_error", "expired")
      .select("id");
    if (error) return { error: "Не вдалося повернути листи в чергу." };
    revalidatePath("/admin/settings");
    return { ok: true, notice: `Повернуто в чергу: ${data?.length ?? 0}.` };
  } catch {
    return { error: "Сервіс не налаштований." };
  }
}
