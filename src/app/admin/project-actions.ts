"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { buildSchedule, parseFeatures, proposalInput, validateSchedule } from "@/lib/admin/proposal-input";
import { STAGES } from "@/lib/client/labels";
import { hashValue } from "@/lib/orders/service";
import { site } from "@/lib/site";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { ActionState } from "./actions";

const RPC_ERRORS: Record<string, string> = {
  forbidden: "Недостатньо прав.",
  not_found: "Проєкт не знайдено.",
  invalid_input: "Некоректні дані.",
  invalid_message: "Повідомлення має містити від 1 до 4000 символів.",
  invalid_note: "Нотатка має містити від 1 до 4000 символів.",
  invalid_stage: "Невідомий етап.",
  draft_exists: "Чернетка вже існує: відредагуйте її або надішліть клієнту.",
  not_editable: "Цю версію вже не можна змінювати. Створіть нову версію.",
  incomplete: "Заповніть вартість, термін і склад робіт.",
  schedule_must_total_100: "Сума відсотків графіка платежів має дорівнювати 100.",
};

function rpcMessage(message: string): string {
  const key = Object.keys(RPC_ERRORS).find((code) => message.includes(code));
  return key ? RPC_ERRORS[key]! : "Не вдалося зберегти зміни. Спробуйте ще раз.";
}

const uuid = z.string().uuid();

function refresh(projectId: string) {
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/admin/projects");
}

/** Запрошення клієнта до кабінету: надсилає одноразовий код/посилання на пошту з заявки. Пошту вводити вручну не потрібно. */
export async function inviteClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const orderId = uuid.safeParse(formData.get("orderId"));
  if (!orderId.success) return { error: "Некоректні дані." };

  const order = await admin.supabase.from("orders").select("email").eq("id", orderId.data).maybeSingle();
  if (order.error || !order.data) return { error: "Заявку не знайдено." };

  try {
    const service = createSupabaseServiceClient();
    const allowed = await service.rpc("auth_throttle_hit", { p_key: hashValue(`invite:${orderId.data}`), p_limit: 3, p_window: "1 hour" });
    if (allowed.data !== true) return { error: "Забагато запрошень за годину. Спробуйте пізніше." };
  } catch {
    return { error: "Сервіс запрошень не налаштований." };
  }

  const { error } = await admin.supabase.auth.signInWithOtp({
    email: order.data.email as string,
    options: { shouldCreateUser: true, emailRedirectTo: `${site.url}/auth/confirm` },
  });
  if (error) return { error: "Не вдалося надіслати запрошення." };
  return { ok: true, notice: `Запрошення надіслано на ${order.data.email as string}. Проєкт зʼявиться після першого входу клієнта.` };
}

const projectInput = z.object({
  projectId: uuid,
  status: z.enum(["active", "on_hold", "completed", "cancelled"]),
  assignee: z.union([uuid, z.literal("")]),
  nextOwner: z.enum(["client", "studio", ""]),
  nextAction: z.string().trim().max(300),
});

export async function updateProjectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = projectInput.safeParse({
    projectId: formData.get("projectId"),
    status: formData.get("status"),
    assignee: formData.get("assignee") ?? "",
    nextOwner: formData.get("nextOwner") ?? "",
    nextAction: formData.get("nextAction") ?? "",
  });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_update_project", {
    p_project: parsed.data.projectId,
    p_status: parsed.data.status,
    p_assignee: parsed.data.assignee || null,
    p_next_owner: parsed.data.nextOwner || null,
    p_next_action: parsed.data.nextAction || null,
  });
  if (error) return { error: rpcMessage(error.message) };
  refresh(parsed.data.projectId);
  return { ok: true };
}

export async function setStageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ projectId: uuid, stage: z.enum(STAGES) }).safeParse({ projectId: formData.get("projectId"), stage: formData.get("stage") });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_set_project_stage", { p_project: parsed.data.projectId, p_stage: parsed.data.stage });
  if (error) return { error: rpcMessage(error.message) };
  refresh(parsed.data.projectId);
  return { ok: true };
}

export async function sendAdminMessageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ projectId: uuid, body: z.string().trim().min(1, "Напишіть повідомлення.").max(4000) })
    .safeParse({ projectId: formData.get("projectId"), body: formData.get("body") });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Перевірте повідомлення." };
  const { error } = await admin.supabase.rpc("admin_send_message", { p_project: parsed.data.projectId, p_body: parsed.data.body });
  if (error) return { error: rpcMessage(error.message) };
  refresh(parsed.data.projectId);
  return { ok: true };
}

export async function markAdminReadAction(projectId: string) {
  const id = uuid.safeParse(projectId);
  if (!id.success) return;
  const admin = await requireAdmin();
  await admin.supabase.rpc("admin_mark_read", { p_project: id.data });
}

export async function addInternalNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ projectId: uuid, body: z.string().trim().min(1, "Напишіть нотатку.").max(4000) })
    .safeParse({ projectId: formData.get("projectId"), body: formData.get("body") });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Перевірте нотатку." };
  const { error } = await admin.supabase.rpc("admin_add_internal_note", { p_project: parsed.data.projectId, p_body: parsed.data.body });
  if (error) return { error: rpcMessage(error.message) };
  refresh(parsed.data.projectId);
  return { ok: true };
}

export async function createProposalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ projectId: uuid, copyFrom: z.union([uuid, z.literal("")]) })
    .safeParse({ projectId: formData.get("projectId"), copyFrom: formData.get("copyFrom") ?? "" });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_create_proposal", {
    p_project: parsed.data.projectId,
    p_copy_from: parsed.data.copyFrom || null,
  });
  if (error) return { error: rpcMessage(error.message) };
  refresh(parsed.data.projectId);
  return { ok: true };
}

export async function saveProposalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = proposalInput.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Перевірте поля пропозиції." };
  const data = parsed.data;

  const schedule = buildSchedule(data.preset, data.customSchedule);
  const scheduleProblem = validateSchedule(schedule);
  if (scheduleProblem) return { fieldError: scheduleProblem };
  const features = parseFeatures(data.features);
  if (features.length === 0) return { fieldError: "Додайте хоча б один пункт у складі робіт." };

  const { error } = await admin.supabase.rpc("admin_update_proposal", {
    p_proposal: data.proposalId,
    p_title: data.title,
    p_summary: data.summary,
    p_features: features,
    p_price: data.price,
    p_currency: data.currency,
    p_duration_days: data.durationDays,
    p_schedule: schedule,
    p_revisions: data.revisions,
    p_terms: data.terms,
  });
  if (error) return { error: rpcMessage(error.message) };
  refresh(data.projectId);
  return { ok: true, notice: "Чернетку збережено." };
}

export async function sendProposalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ proposalId: uuid, projectId: uuid }).safeParse({ proposalId: formData.get("proposalId"), projectId: formData.get("projectId") });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_send_proposal", { p_proposal: parsed.data.proposalId });
  if (error) return { error: rpcMessage(error.message) };
  refresh(parsed.data.projectId);
  return { ok: true, notice: "Пропозицію надіслано клієнту." };
}
