"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { TASK_PRIORITIES, TASK_STATUSES, parseChecklist, parseLinks } from "@/lib/admin/tasks";
import type { ActionState } from "./actions";

const uuid = z.string().uuid();
const optionalUuid = z.union([uuid, z.literal("")]).transform((v) => (v === "" ? null : v));
const optionalDate = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).transform((v) => (v === "" ? null : v));

const ERRORS: Record<string, string> = {
  forbidden: "Недостатньо прав.",
  not_found: "Запис не знайдено.",
  stale: "Це завдання вже змінив інший адміністратор. Оновіть сторінку, щоб побачити актуальні дані, і повторіть дію.",
  blocked_reason_required: "Для статусу Blocked вкажіть причину блокування.",
  estimate_final: "Кошторис уже зафіксований і не редагується.",
  not_pending: "Дія вже виконана.",
};
const message = (e: { message: string }) => ERRORS[Object.keys(ERRORS).find((k) => e.message.includes(k)) ?? ""] ?? "Не вдалося виконати дію. Спробуйте ще раз.";

function refreshTasks(id?: string) {
  revalidatePath("/admin/tasks");
  if (id) revalidatePath(`/admin/tasks/${id}`);
}

const createInput = z.object({
  title: z.string().trim().min(1, "Вкажіть назву.").max(200),
  description: z.string().trim().max(8000),
  projectId: optionalUuid,
  assigneeId: optionalUuid,
  priority: z.enum(TASK_PRIORITIES),
  deadline: optionalDate,
  status: z.enum(["backlog", "todo", "in_progress", "in_review", "done"]),
});

export async function createTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = createInput.safeParse({
    title: formData.get("title"), description: formData.get("description") ?? "", projectId: formData.get("projectId") ?? "", assigneeId: formData.get("assigneeId") ?? "",
    priority: formData.get("priority") ?? "normal", deadline: formData.get("deadline") ?? "", status: formData.get("status") ?? "backlog",
  });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Перевірте поля." };
  const { error } = await admin.supabase.rpc("admin_create_task", {
    p_title: parsed.data.title, p_description: parsed.data.description, p_project: parsed.data.projectId, p_assignee: parsed.data.assigneeId,
    p_priority: parsed.data.priority, p_deadline: parsed.data.deadline, p_status: parsed.data.status,
  });
  if (error) return { error: message(error) };
  refreshTasks();
  return { ok: true, notice: "Завдання створено." };
}

export async function moveTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ id: uuid, version: z.coerce.number().int().min(1), status: z.enum(TASK_STATUSES), reason: z.string().trim().max(1000) })
    .safeParse({ id: formData.get("id"), version: formData.get("version"), status: formData.get("status"), reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_move_task", { p_id: parsed.data.id, p_expected: parsed.data.version, p_status: parsed.data.status, p_reason: parsed.data.reason || null });
  if (error) return { error: message(error) };
  refreshTasks(parsed.data.id);
  return { ok: true, notice: "Статус оновлено." };
}

export async function updateTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      id: uuid, version: z.coerce.number().int().min(1), title: z.string().trim().min(1, "Вкажіть назву.").max(200), description: z.string().trim().max(8000),
      projectId: optionalUuid, assigneeId: optionalUuid, priority: z.enum(TASK_PRIORITIES), deadline: optionalDate, risk: z.string().trim().max(1000),
      checklist: z.string().max(8000), links: z.string().max(8000),
    })
    .safeParse({
      id: formData.get("id"), version: formData.get("version"), title: formData.get("title"), description: formData.get("description") ?? "", projectId: formData.get("projectId") ?? "",
      assigneeId: formData.get("assigneeId") ?? "", priority: formData.get("priority") ?? "normal", deadline: formData.get("deadline") ?? "", risk: formData.get("risk") ?? "",
      checklist: formData.get("checklist") ?? "", links: formData.get("links") ?? "",
    });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Перевірте поля." };
  const { links, invalid } = parseLinks(parsed.data.links);
  if (invalid.length > 0) return { fieldError: `Некоректні посилання (потрібен https): ${invalid.slice(0, 2).join("; ")}` };
  const { error } = await admin.supabase.rpc("admin_update_task", {
    p_id: parsed.data.id, p_expected: parsed.data.version, p_title: parsed.data.title, p_description: parsed.data.description, p_project: parsed.data.projectId,
    p_assignee: parsed.data.assigneeId, p_priority: parsed.data.priority, p_deadline: parsed.data.deadline, p_risk: parsed.data.risk || null,
    p_checklist: parseChecklist(parsed.data.checklist), p_links: links,
  });
  if (error) return { error: message(error) };
  refreshTasks(parsed.data.id);
  return { ok: true, notice: "Завдання збережено." };
}

export async function commentTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ id: uuid, body: z.string().trim().min(1, "Напишіть коментар.").max(4000) }).safeParse({ id: formData.get("id"), body: formData.get("body") });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Напишіть коментар." };
  const { error } = await admin.supabase.rpc("admin_comment_task", { p_id: parsed.data.id, p_body: parsed.data.body });
  if (error) return { error: message(error) };
  refreshTasks(parsed.data.id);
  return { ok: true, notice: "Коментар додано." };
}

// ---------------------------------------------------------------------------
// Кошториси й витрати
// ---------------------------------------------------------------------------
const CATEGORIES = ["design", "frontend", "backend", "database", "android", "ios", "integrations", "qa", "deployment", "support"] as const;

export async function createEstimateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ title: z.string().trim().min(1, "Вкажіть назву.").max(160), projectId: uuid, currency: z.enum(["UAH", "USD", "EUR"]) })
    .safeParse({ title: formData.get("title"), projectId: formData.get("projectId"), currency: formData.get("currency") ?? "UAH" });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Перевірте поля." };
  const { error } = await admin.supabase.rpc("admin_create_estimate", { p_title: parsed.data.title, p_project: parsed.data.projectId, p_order: null, p_currency: parsed.data.currency });
  if (error) return { error: message(error) };
  revalidatePath("/admin/finance");
  return { ok: true, notice: "Кошторис створено." };
}

export async function saveEstimateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const num = (name: string) => z.coerce.number().min(0).max(1_000_000_000).safeParse(formData.get(name) || 0);
  const id = uuid.safeParse(formData.get("id"));
  const reserve = num("reserve");
  const margin = z.coerce.number().min(0).max(89.99).safeParse(formData.get("margin") || 0);
  const other = num("other");
  const finalRaw = String(formData.get("finalPrice") ?? "").trim();
  const finalPrice = finalRaw === "" ? null : z.coerce.number().min(0).max(1_000_000_000).safeParse(finalRaw);
  if (!id.success || !reserve.success || !margin.success || !other.success || (finalPrice && !finalPrice.success)) return { fieldError: "Перевірте числові поля (маржа менше 90%)." };
  const lines = CATEGORIES.flatMap((category) => {
    const hours = Number(formData.get(`hours_${category}`) || 0);
    const rate = Number(formData.get(`rate_${category}`) || 0);
    return hours > 0 ? [{ category, hours, rate }] : [];
  });
  if (lines.some((l) => !Number.isFinite(l.hours) || !Number.isFinite(l.rate) || l.rate < 0 || l.hours > 5000)) return { fieldError: "Перевірте години (до 5000) і ставки." };
  const { error } = await admin.supabase.rpc("admin_save_estimate", {
    p_id: id.data, p_reserve: reserve.data, p_margin: margin.data, p_other: other.data, p_final_price: finalPrice ? finalPrice.data : null,
    p_note: String(formData.get("note") ?? ""), p_lines: lines,
  });
  if (error) return { error: message(error) };
  revalidatePath(`/admin/finance/estimates/${id.data}`);
  revalidatePath("/admin/finance");
  return { ok: true, notice: "Кошторис збережено. Це внутрішній розрахунок, а не пропозиція ціни клієнту." };
}

export async function finalizeEstimateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_finalize_estimate", { p_id: id.data });
  if (error) return { error: message(error) };
  revalidatePath(`/admin/finance/estimates/${id.data}`);
  return { ok: true, notice: "Кошторис зафіксовано." };
}

export async function addExpenseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ projectId: uuid, category: z.string().trim().min(1, "Вкажіть категорію.").max(60), amount: z.coerce.number({ invalid_type_error: "Вкажіть суму числом." }).positive("Сума має бути більшою за 0.").max(1_000_000_000), currency: z.enum(["UAH", "USD", "EUR"]), on: optionalDate, note: z.string().trim().max(500) })
    .safeParse({ projectId: formData.get("projectId"), category: formData.get("category"), amount: formData.get("amount"), currency: formData.get("currency") ?? "UAH", on: formData.get("on") ?? "", note: formData.get("note") ?? "" });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Перевірте поля." };
  const { error } = await admin.supabase.rpc("admin_add_expense", { p_project: parsed.data.projectId, p_category: parsed.data.category, p_amount: parsed.data.amount, p_currency: parsed.data.currency, p_on: parsed.data.on, p_note: parsed.data.note || null });
  if (error) return { error: message(error) };
  revalidatePath("/admin/finance");
  return { ok: true, notice: "Витрату записано." };
}
