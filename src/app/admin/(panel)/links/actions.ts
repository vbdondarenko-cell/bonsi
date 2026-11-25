"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { linkInput } from "@/lib/analytics/links";

export type LinkActionState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string>; code?: string } | null;

const RPC_ERRORS: Record<string, string> = {
  forbidden: "Недостатньо прав.",
  code_taken: "Такий код уже існує. Оберіть інший.",
  invalid_link: "Некоректні дані посилання.",
  not_found: "Посилання не знайдено.",
};

function rpcMessage(message: string): string {
  const key = Object.keys(RPC_ERRORS).find((code) => message.includes(code));
  return key ? RPC_ERRORS[key]! : "Не вдалося зберегти. Спробуйте ще раз.";
}

export async function createLinkAction(_prev: LinkActionState, formData: FormData): Promise<LinkActionState> {
  const admin = await requireAdmin();
  const parsed = linkInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      fieldErrors[field] ??= issue.message;
    }
    return { fieldErrors };
  }

  const { error } = await admin.supabase.rpc("admin_create_link", {
    p_code: parsed.data.code,
    p_name: parsed.data.name,
    p_destination: parsed.data.destination,
    p_source: parsed.data.source,
    p_medium: parsed.data.medium,
    p_campaign: parsed.data.campaign,
    p_content: parsed.data.content,
    p_note: parsed.data.note,
  });
  if (error) return { error: rpcMessage(error.message) };

  revalidatePath("/admin/links");
  return { ok: true, code: parsed.data.code };
}

const toggleInput = z.object({ code: z.string().min(3).max(40), active: z.enum(["true", "false"]) });

export async function toggleLinkAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = toggleInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await admin.supabase.rpc("admin_set_link_active", { p_code: parsed.data.code, p_active: parsed.data.active === "true" });
  revalidatePath("/admin/links");
}
