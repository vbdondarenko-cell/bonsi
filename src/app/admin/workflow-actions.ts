"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { DOCUMENT_KINDS, renderTemplate, type DocumentKind } from "@/lib/documents/templates";
import { formatMoney } from "@/lib/client/labels";
import { services } from "@/lib/services";
import type { ActionState } from "./actions";

const uuid = z.string().uuid();

const ERRORS: Record<string, string> = {
  forbidden: "Недостатньо прав.",
  not_found: "Запис не знайдено.",
  conditions_not_met: "Умови активації ще не виконано: потрібні погоджені пропозиція, договір і (якщо є) оплачена передоплата.",
  already_active: "Проєкт уже активовано.",
  document_locked: "Цей документ уже відправлено або погоджено — змінити його не можна. Створіть нову версію чи додаткову угоду.",
  reason_required: "Вкажіть причину (від 10 символів).",
  invalid_quote: "Перевірте оцінку: опис від 10 символів, сума й термін не від'ємні.",
  not_pending: "Запис уже не очікує цієї дії. Оновіть сторінку.",
  invalid_transition: "Ця дія зараз недоступна для цього запиту.",
  invoice_exists: "Рахунок на цю зміну вже створено.",
  invoice_frozen: "Призначення можна змінювати лише в чернетці рахунку.",
};

function message(error: { message: string }, fallback = "Не вдалося виконати дію. Спробуйте ще раз.") {
  const key = Object.keys(ERRORS).find((code) => error.message.includes(code));
  return key ? ERRORS[key]! : fallback;
}

function refresh(projectId: string) {
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}/workflow`);
  revalidatePath(`/app/projects/${projectId}`, "layout");
}

export async function activateProjectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const projectId = uuid.safeParse(formData.get("projectId"));
  if (!projectId.success) return { error: "Некоректні дані." };
  const note = String(formData.get("note") ?? "").slice(0, 500);
  const { error } = await admin.supabase.rpc("admin_activate_project", { p_project: projectId.data, p_note: note || null });
  if (error) return { error: message(error) };
  refresh(projectId.data);
  return { ok: true, notice: "Проєкт активовано. Базовий обсяг робіт зафіксовано." };
}

export async function rejectOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const orderId = uuid.safeParse(formData.get("orderId"));
  const reason = z.string().trim().min(10, "Вкажіть причину (від 10 символів).").max(1000).safeParse(formData.get("reason"));
  if (!orderId.success) return { error: "Некоректні дані." };
  if (!reason.success) return { fieldError: reason.error.issues[0]?.message ?? "Вкажіть причину." };
  const { error } = await admin.supabase.rpc("admin_reject_order", { p_order: orderId.data, p_reason: reason.data });
  if (error) return { error: message(error) };
  revalidatePath(`/admin/orders/${orderId.data}`);
  return { ok: true, notice: "Заявку відхилено. Клієнт бачить причину в кабінеті." };
}

export async function createDocumentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ projectId: uuid, kind: z.enum(DOCUMENT_KINDS as [DocumentKind, ...DocumentKind[]]) }).safeParse({ projectId: formData.get("projectId"), kind: formData.get("kind") });
  if (!parsed.success) return { error: "Некоректні дані." };

  const projectRes = await admin.supabase.from("projects").select("title,service,order:orders(name)").eq("id", parsed.data.projectId).maybeSingle();
  const project = projectRes.data;
  if (projectRes.error || !project) return { error: "Проєкт не знайдено." };
  const order = (Array.isArray(project.order) ? project.order[0] : project.order) as { name: string } | null;
  const proposal = await admin.supabase
    .from("proposals")
    .select("price_amount,currency,duration_days,features")
    .eq("project_id", parsed.data.projectId)
    .eq("status", "approved")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { title, body } = renderTemplate(parsed.data.kind, {
    clientName: order?.name ?? "[замовник]",
    ticket: project.title as string,
    serviceTitle: services.find((s) => s.id === project.service)?.title ?? (project.service as string),
    price: proposal.data?.price_amount ? formatMoney(String(proposal.data.price_amount), proposal.data.currency as string) : null,
    durationDays: (proposal.data?.duration_days as number | null) ?? null,
    features: (proposal.data?.features as string[] | undefined) ?? undefined,
    date: new Date().toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv" }),
  });
  const { error } = await admin.supabase.rpc("admin_create_document", { p_project: parsed.data.projectId, p_kind: parsed.data.kind, p_title: title, p_body: body });
  if (error) return { error: message(error) };
  refresh(parsed.data.projectId);
  return { ok: true, notice: "Чернетку створено за шаблоном. Перегляньте й відредагуйте перед відправкою." };
}

export async function saveDocumentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ projectId: uuid, id: uuid, title: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(60000) })
    .safeParse({ projectId: formData.get("projectId"), id: formData.get("id"), title: formData.get("title"), body: formData.get("body") });
  if (!parsed.success) return { fieldError: "Назва й текст обов'язкові." };
  const { error } = await admin.supabase.rpc("admin_save_document", { p_doc: parsed.data.id, p_title: parsed.data.title, p_body: parsed.data.body });
  if (error) return { error: message(error) };
  refresh(parsed.data.projectId);
  return { ok: true, notice: "Збережено." };
}

export async function sendDocumentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ projectId: uuid, id: uuid }).safeParse({ projectId: formData.get("projectId"), id: formData.get("id") });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_send_document", { p_doc: parsed.data.id });
  if (error) return { error: message(error) };
  refresh(parsed.data.projectId);
  return { ok: true, notice: "Документ відправлено клієнту на погодження. Текст цієї версії зафіксовано." };
}

export async function voidDocumentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ projectId: uuid, id: uuid, reason: z.string().trim().max(500) }).safeParse({ projectId: formData.get("projectId"), id: formData.get("id"), reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_void_document", { p_doc: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return { error: message(error) };
  refresh(parsed.data.projectId);
  return { ok: true, notice: "Документ позначено недійсним." };
}

export async function setInvoicePurposeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ projectId: uuid, invoiceId: uuid, purpose: z.enum(["regular", "prepayment", "change"]) }).safeParse({ projectId: formData.get("projectId"), invoiceId: formData.get("invoiceId"), purpose: formData.get("purpose") });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { error } = await admin.supabase.rpc("admin_set_invoice_purpose", { p_invoice: parsed.data.invoiceId, p_purpose: parsed.data.purpose });
  if (error) return { error: message(error) };
  refresh(parsed.data.projectId);
  return { ok: true, notice: "Призначення рахунку збережено." };
}

export async function quoteChangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      projectId: uuid,
      id: uuid,
      summary: z.string().trim().min(10, "Опишіть оцінку (від 10 символів).").max(4000),
      price: z.coerce.number({ invalid_type_error: "Вкажіть вартість числом." }).min(0).max(1_000_000_000),
      currency: z.enum(["UAH", "USD", "EUR"]),
      days: z.coerce.number({ invalid_type_error: "Вкажіть термін числом." }).int().min(0).max(1000),
    })
    .safeParse({ projectId: formData.get("projectId"), id: formData.get("id"), summary: formData.get("summary"), price: formData.get("price"), currency: formData.get("currency"), days: formData.get("days") });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Перевірте поля." };
  const { error } = await admin.supabase.rpc("admin_quote_change_request", {
    p_cr: parsed.data.id,
    p_summary: parsed.data.summary,
    p_price: parsed.data.price,
    p_currency: parsed.data.currency,
    p_days: parsed.data.days,
  });
  if (error) return { error: message(error) };
  refresh(parsed.data.projectId);
  return { ok: true, notice: "Оцінку надіслано клієнту як додаткову угоду." };
}

export async function rejectChangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ projectId: uuid, id: uuid, reason: z.string().trim().min(10, "Вкажіть причину (від 10 символів).").max(1000) }).safeParse({ projectId: formData.get("projectId"), id: formData.get("id"), reason: formData.get("reason") });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Вкажіть причину." };
  const { error } = await admin.supabase.rpc("admin_reject_change_request", { p_cr: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return { error: message(error) };
  refresh(parsed.data.projectId);
  return { ok: true, notice: "Запит відхилено." };
}

export async function changeProgressAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ projectId: uuid, id: uuid, op: z.enum(["in_progress", "done", "invoice"]) }).safeParse({ projectId: formData.get("projectId"), id: formData.get("id"), op: formData.get("op") });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { error } =
    parsed.data.op === "invoice"
      ? await admin.supabase.rpc("admin_create_change_invoice", { p_cr: parsed.data.id })
      : await admin.supabase.rpc("admin_set_change_request_status", { p_cr: parsed.data.id, p_status: parsed.data.op });
  if (error) return { error: message(error) };
  refresh(parsed.data.projectId);
  return { ok: true, notice: parsed.data.op === "invoice" ? "Чернетку рахунку створено. Виставте її в розділі «Оплата»." : "Статус оновлено." };
}
