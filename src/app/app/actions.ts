"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClient } from "@/lib/client/auth";
import { queueProjectEmail } from "@/lib/email/events";
import { getMessages, getMessagesAfter } from "@/lib/client/data";
import { toThreadMessages, type ThreadMessage } from "@/lib/client/thread";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type FormState = { ok?: boolean; error?: string; notice?: string; sentAt?: number } | null;

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
  const fileIds = z.array(uuid).max(5).safeParse(formData.getAll("fileId").map(String));
  const body = z.string().trim().max(4000, "Максимум 4000 символів.").safeParse(formData.get("body") ?? "");
  if (!projectId.success) return { error: "Проєкт не знайдено." };
  if (!body.success || !fileIds.success) return { error: body.success ? "Некоректні вкладення." : (body.error.issues[0]?.message ?? "Перевірте повідомлення.") };
  if (body.data === "" && fileIds.data.length === 0) return { error: "Напишіть повідомлення або додайте файл." };

  const { supabase } = await requireClient();
  const sent = await supabase.rpc("client_send_message", { p_project: projectId.data, p_body: body.data || "Вкладення" });
  if (sent.error) return { error: rpcError(sent.error.message, MESSAGE_ERRORS, "Не вдалося надіслати. Спробуйте ще раз.") };
  if (fileIds.data.length > 0) {
    const attach = await supabase.rpc("attach_files_to_message", { p_message: sent.data, p_files: fileIds.data });
    if (attach.error) return { error: "Повідомлення надіслано, але вкладення прикріпити не вдалося." };
  }
  return { ok: true, sentAt: Date.now() };
}

export type ThreadPage =
  | { ok: true; messages: ThreadMessage[]; hasMore: boolean }
  | { ok: false; error: string };

/** Підвантаження історії (before) або нових повідомлень (after) за курсором id; відповідь без дублікатів визначається клієнтом за id. */
export async function loadMessagesAction(projectId: string, cursor: { before?: number; after?: number }): Promise<ThreadPage> {
  const id = uuid.safeParse(projectId);
  const before = z.number().int().positive().optional().safeParse(cursor.before);
  const after = z.number().int().min(0).optional().safeParse(cursor.after);
  if (!id.success || !before.success || !after.success) return { ok: false, error: "Некоректний запит." };
  try {
    const { supabase } = await requireClient();
    if (after.data !== undefined) {
      const rows = await getMessagesAfter(supabase, id.data, after.data);
      return { ok: true, messages: await toThreadMessages(supabase, id.data, rows), hasMore: false };
    }
    const page = await getMessages(supabase, id.data, { before: before.data });
    return { ok: true, messages: await toThreadMessages(supabase, id.data, page.messages), hasMore: page.hasMore };
  } catch {
    return { ok: false, error: "Не вдалося завантажити повідомлення. Перевірте зʼєднання." };
  }
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
  await queueProjectEmail({ projectId: parsed.data.projectId, template: "proposal_decision", key: `proposal-decision:${parsed.data.proposalId}` });
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

const deliverableDecision = z.object({
  deliverableId: z.string().uuid(),
  projectId: z.string().uuid(),
  decision: z.enum(["approved", "changes_requested"]),
  comment: z.string().trim().max(2000, "Максимум 2000 символів.").optional(),
});

export async function decideDeliverableAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = deliverableDecision.safeParse({
    deliverableId: formData.get("deliverableId"),
    projectId: formData.get("projectId"),
    decision: formData.get("decision"),
    comment: formData.get("comment") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Перевірте дані." };
  if (parsed.data.decision === "changes_requested" && !parsed.data.comment) return { error: "Опишіть, що саме потрібно виправити." };

  const { supabase } = await requireClient();
  const { error } = await supabase.rpc("client_decide_deliverable", {
    p_id: parsed.data.deliverableId,
    p_decision: parsed.data.decision,
    p_comment: parsed.data.comment ?? null,
  });
  if (error) {
    return {
      error: rpcError(
        error.message,
        { not_pending: "Ця версія вже не очікує рішення. Оновіть сторінку.", forbidden: "Немає доступу до цього результату.", comment_required: "Опишіть, що саме потрібно виправити." },
        "Не вдалося зберегти рішення. Спробуйте ще раз.",
      ),
    };
  }
  await queueProjectEmail({ projectId: parsed.data.projectId, template: "deliverable_decision", key: `deliverable-decision:${parsed.data.deliverableId}` });
  revalidatePath(`/app/projects/${parsed.data.projectId}`, "layout");
  return { ok: true, notice: parsed.data.decision === "approved" ? "Результат погоджено." : "Запит на правки надіслано студії." };
}

/** Клієнт повідомляє про банківський переказ. Це заявка на перевірку: статус «Сплачено» змінює лише студія після звірки з банком. */
export async function reportPaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ invoiceId: z.string().uuid(), projectId: z.string().uuid(), reference: z.string().trim().max(200, "Максимум 200 символів.").optional() })
    .safeParse({ invoiceId: formData.get("invoiceId"), projectId: formData.get("projectId"), reference: formData.get("reference") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Перевірте дані." };
  const { supabase } = await requireClient();
  const { error } = await supabase.rpc("client_report_payment", { p_invoice: parsed.data.invoiceId, p_reference: parsed.data.reference ?? null });
  if (error) {
    return {
      error: rpcError(
        error.message,
        { already_reported: "Ви вже повідомили про оплату. Студія перевіряє надходження.", already_paid: "Рахунок уже сплачено.", forbidden: "Рахунок недоступний." },
        "Не вдалося надіслати повідомлення. Спробуйте ще раз.",
      ),
    };
  }
  revalidatePath(`/app/projects/${parsed.data.projectId}/payments`);
  return { ok: true, notice: "Дякуємо! Студія перевірить надходження й підтвердить оплату." };
}

export async function deleteFileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z.object({ fileId: z.string().uuid(), projectId: z.string().uuid() }).safeParse({ fileId: formData.get("fileId"), projectId: formData.get("projectId") });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { supabase } = await requireClient();
  const { data, error } = await supabase.rpc("delete_project_file", { p_file: parsed.data.fileId });
  if (error) return { error: "Цей файл не можна видалити." };
  try {
    if (typeof data === "string") await createSupabaseServiceClient().storage.from("project-files").remove([data]);
  } catch {
    // Запис позначено видаленим; прибирання об'єкта довершить регулярне очищення.
  }
  revalidatePath(`/app/projects/${parsed.data.projectId}/files`);
  return { ok: true, notice: "Файл видалено." };
}
