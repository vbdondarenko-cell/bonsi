"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { queueProjectEmail } from "@/lib/email/events";
import type { ActionState } from "./actions";

const uuid = z.string().uuid();
const ERRORS: Record<string, string> = {
  forbidden: "Недостатньо прав.",
  not_found: "Запис не знайдено.",
  handover_locked: "Передача вже відправлена або прийнята — змінити її не можна.",
  handover_incomplete: "Передача неповна: для сайту потрібні production URL і документація чи інструкція; для застосунку — версія й артефакти.",
  handover_not_accepted: "Проєкт можна завершити лише після прийняття передачі клієнтом.",
  invalid_artifacts: "Артефакти: потрібні тип, назва та https-посилання.",
  "check constraint": "Поля містять недопустиме значення: посилання мають бути https, а паролі, токени й ключі зберігати тут не можна — передавайте їх окремим захищеним каналом.",
  not_pending: "Дія вже виконана.",
  result_required: "Для статусу «Вирішено» або «Закрито» вкажіть результат.",
  already_converted: "Звернення вже оформлено як запит на зміну.",
};
const message = (e: { message: string }) => ERRORS[Object.keys(ERRORS).find((k) => e.message.includes(k)) ?? ""] ?? "Не вдалося виконати дію. Спробуйте ще раз.";

const text = (name: string, fd: FormData) => String(fd.get(name) ?? "").trim();

export async function saveHandoverAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const projectId = uuid.safeParse(formData.get("projectId"));
  const kind = z.enum(["website", "mobile", "other"]).safeParse(formData.get("product_kind"));
  if (!projectId.success || !kind.success) return { error: "Некоректні дані." };
  const artifacts = text("artifacts", formData)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [artifactKind, ...rest] = line.split(/\s+/);
      const url = rest.pop() ?? "";
      return { kind: artifactKind.toLowerCase(), label: rest.join(" ") || artifactKind, url };
    });
  const fields: Record<string, unknown> = { product_kind: kind.data, artifacts };
  for (const key of ["production_url", "domain", "domain_owner", "hosting", "repository_url", "docs_url", "manual_url", "backup_note", "app_version", "store_state", "backend_note", "rights_note"]) fields[key] = text(key, formData);
  const { error } = await admin.supabase.rpc("admin_save_handover", { p_project: projectId.data, p_fields: fields });
  if (error) return { error: message(error) };
  revalidatePath(`/admin/projects/${projectId.data}/handover`);
  return { ok: true, notice: "Чернетку передачі збережено." };
}

export async function submitHandoverAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const projectId = uuid.safeParse(formData.get("projectId"));
  if (!projectId.success) return { error: "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_submit_handover", { p_project: projectId.data });
  if (error) return { error: message(error) };
  await queueProjectEmail({ projectId: projectId.data, template: "handover_ready", key: `handover-ready:${projectId.data}:${Date.now() >> 16}` });
  revalidatePath(`/admin/projects/${projectId.data}/handover`);
  revalidatePath(`/app/projects/${projectId.data}`, "layout");
  return { ok: true, notice: "Передачу відправлено клієнту на приймання." };
}

export async function completeProjectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ projectId: uuid, warranty: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).transform((v) => v || null) })
    .safeParse({ projectId: formData.get("projectId"), warranty: formData.get("warranty") ?? "" });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_complete_project", { p_project: parsed.data.projectId, p_warranty_until: parsed.data.warranty });
  if (error) return { error: message(error) };
  await queueProjectEmail({ projectId: parsed.data.projectId, template: "project_completed", key: `project-completed:${parsed.data.projectId}` });
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  revalidatePath(`/admin/projects/${parsed.data.projectId}/handover`);
  return { ok: true, notice: "Проєкт завершено. Підтримка лишається доступною клієнту." };
}

// ---------------------------------------------------------------------------
// Підтримка (адміністратор)
// ---------------------------------------------------------------------------
export async function replyTicketAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ id: uuid, body: z.string().trim().min(1, "Напишіть відповідь.").max(4000), internal: z.boolean() }).safeParse({ id: formData.get("id"), body: formData.get("body"), internal: formData.get("internal") === "on" });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Напишіть відповідь." };
  const { data, error } = await admin.supabase.rpc("admin_ticket_reply", { p_ticket: parsed.data.id, p_body: parsed.data.body, p_internal: parsed.data.internal });
  if (error) return { error: message(error) };
  if (!parsed.data.internal) {
    const ticket = await admin.supabase.from("support_tickets").select("project_id,number").eq("id", parsed.data.id).maybeSingle();
    if (ticket.data) await queueProjectEmail({ projectId: ticket.data.project_id as string, template: "support_update", key: `support-reply:${parsed.data.id}:${String(data)}`, payload: { number: ticket.data.number } });
  }
  revalidatePath(`/admin/support/${parsed.data.id}`);
  return { ok: true, notice: parsed.data.internal ? "Внутрішню нотатку додано." : "Відповідь надіслано клієнту." };
}

export async function updateTicketAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      id: uuid, status: z.enum(["new", "in_progress", "waiting_client", "resolved", "closed"]), priority: z.enum(["low", "normal", "high", "urgent"]),
      assignee: z.union([uuid, z.literal("")]).transform((v) => v || null), result: z.string().trim().max(4000),
    })
    .safeParse({ id: formData.get("id"), status: formData.get("status"), priority: formData.get("priority"), assignee: formData.get("assignee") ?? "", result: formData.get("result") ?? "" });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_update_ticket", { p_ticket: parsed.data.id, p_status: parsed.data.status, p_assignee: parsed.data.assignee, p_priority: parsed.data.priority, p_result: parsed.data.result || null });
  if (error) return { error: message(error) };
  revalidatePath(`/admin/support/${parsed.data.id}`);
  revalidatePath("/admin/support");
  return { ok: true, notice: "Збережено." };
}

export async function ticketToChangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_ticket_to_change", { p_ticket: id.data });
  if (error) return { error: message(error) };
  revalidatePath(`/admin/support/${id.data}`);
  return { ok: true, notice: "Створено запит на платне доопрацювання. Оцінка й погодження — у розділі проєкту «Життєвий цикл»." };
}
