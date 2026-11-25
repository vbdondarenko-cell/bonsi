"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { financeInput } from "@/lib/finance/catalog";

export type FinanceActionState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string> } | null;

const RPC_ERRORS: Record<string, string> = {
  forbidden: "Недостатньо прав.",
  invalid_entry: "Некоректні дані запису.",
  not_found: "Запис не знайдено.",
};

function rpcMessage(message: string): string {
  const key = Object.keys(RPC_ERRORS).find((code) => message.includes(code));
  return key ? RPC_ERRORS[key]! : "Не вдалося зберегти. Спробуйте ще раз.";
}

export async function addFinanceAction(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  const admin = await requireAdmin();
  const parsed = financeInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      fieldErrors[field] ??= issue.message;
    }
    return { fieldErrors };
  }

  const { error } = await admin.supabase.rpc("admin_add_finance", {
    p_kind: parsed.data.kind,
    p_date: parsed.data.date,
    p_category: parsed.data.category,
    p_title: parsed.data.title,
    p_amount: parsed.data.amount,
    p_client: parsed.data.client,
    p_note: parsed.data.note,
  });
  if (error) return { error: rpcMessage(error.message) };

  revalidatePath("/admin/finance");
  return { ok: true };
}

const deleteInput = z.object({ id: z.string().uuid() });

export async function deleteFinanceAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = deleteInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await admin.supabase.rpc("admin_delete_finance", { p_id: parsed.data.id });
  revalidatePath("/admin/finance");
}
