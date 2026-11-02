"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClient } from "@/lib/client/auth";

export type FormState = { ok?: boolean; error?: string; notice?: string } | null;

const uuid = z.string().uuid();
const MESSAGE_ERRORS: Record<string, string> = {
  invalid_message: "Повідомлення має містити від 1 до 4000 символів.",
  forbidden: "Немає доступу до цього проєкту.",
};

function rpcError(message: string, map: Record<string, string>, fallback: string) {
  for (const [key, text] of Object.entries(map)) if (message.includes(key)) return text;
  return fallback;
}

export async function sendClientMessageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = uuid.safeParse(formData.get("projectId"));
  const body = z.string().trim().min(1, "Напишіть повідомлення.").max(4000, "Максимум 4000 символів.").safeParse(formData.get("body"));
  if (!projectId.success) return { error: "Проєкт не знайдено." };
  if (!body.success) return { error: body.error.issues[0]?.message ?? "Перевірте повідомлення." };

  const { supabase } = await requireClient();
  const { error } = await supabase.rpc("client_send_message", { p_project: projectId.data, p_body: body.data });
  if (error) return { error: rpcError(error.message, MESSAGE_ERRORS, "Не вдалося надіслати. Спробуйте ще раз.") };
  revalidatePath(`/app/projects/${projectId.data}/messages`);
  return { ok: true };
}

export async function markReadAction(projectId: string) {
  const id = uuid.safeParse(projectId);
  if (!id.success) return;
  const { supabase } = await requireClient();
  await supabase.rpc("client_mark_read", { p_project: id.data });
  revalidatePath("/app", "layout");
}

const decisionSchema = z.object({
  proposalId: z.string().uuid(),
  projectId: z.string().uuid(),
  decision: z.enum(["approved", "changes_requested"]),
  comment: z.string().trim().max(2000, "Максимум 2000 символів.").optional(),
});

export async function decideProposalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = decisionSchema.safeParse({
    proposalId: formData.get("proposalId"),
    projectId: formData.get("projectId"),
    decision: formData.get("decision"),
    comment: formData.get("comment") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Перевірте дані." };
  if (parsed.data.decision === "changes_requested" && !parsed.data.comment) {
    return { error: "Опишіть, що саме потрібно змінити." };
  }

  const { supabase } = await requireClient();
  const { error } = await supabase.rpc("client_decide_proposal", {
    p_proposal: parsed.data.proposalId,
    p_decision: parsed.data.decision,
    p_comment: parsed.data.comment ?? null,
  });
  if (error) {
    return {
      error: rpcError(
        error.message,
        {
          not_pending: "Ця версія пропозиції вже не очікує рішення. Оновіть сторінку.",
          forbidden: "Немає доступу до цієї пропозиції.",
          comment_required: "Опишіть, що саме потрібно змінити.",
        },
        "Не вдалося зберегти рішення. Спробуйте ще раз.",
      ),
    };
  }
  revalidatePath(`/app/projects/${parsed.data.projectId}`, "layout");
  return { ok: true, notice: parsed.data.decision === "approved" ? "Пропозицію погоджено. Студія побачить ваше рішення." : "Запит на зміни надіслано студії." };
}

const profileSchema = z.object({
  name: z.string().trim().max(100, "Імʼя: максимум 100 символів."),
  phone: z.string().trim().max(30, "Телефон: максимум 30 символів.").regex(/^[+\d\s()-]*$/, "Телефон: лише цифри, пробіли та + ( ) -"),
});

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = profileSchema.safeParse({ name: formData.get("name") ?? "", phone: formData.get("phone") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Перевірте дані." };
  const { supabase } = await requireClient();
  const { error } = await supabase.rpc("client_update_profile", { p_name: parsed.data.name, p_phone: parsed.data.phone });
  if (error) return { error: "Не вдалося зберегти профіль." };
  revalidatePath("/app", "layout");
  return { ok: true, notice: "Профіль збережено." };
}

/** Завершує всі інші сесії (інші браузери й пристрої), лишаючи поточну. */
export async function signOutOtherSessionsAction(): Promise<FormState> {
  const { supabase } = await requireClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) return { error: "Не вдалося завершити інші сесії." };
  return { ok: true, notice: "Інші сесії завершено." };
}
