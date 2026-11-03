"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { operationErrorText, rpcOnce } from "@/lib/operations";
import { buildSchedule, parseFeatures, proposalInput, validateSchedule } from "@/lib/admin/proposal-input";
import { STAGES } from "@/lib/client/labels";
import { queueProjectEmail, quarterHour } from "@/lib/email/events";
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
  const guard = operationErrorText({ message });
  if (guard) return guard;
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
  if (parsed.data.status === "completed") {
    await queueProjectEmail({ projectId: parsed.data.projectId, template: "project_completed", key: `project-completed:${parsed.data.projectId}` });
  }
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
  const { error } = await rpcOnce(admin.supabase, formData, "admin_send_message", { p_project: parsed.data.projectId, p_body: parsed.data.body });
  if (error) return { error: rpcMessage(error.message) };
  // Текст повідомлення в лист не потрапляє: клієнт читає його в кабінеті. Не частіше одного листа на 15 хвилин.
  await queueProjectEmail({ projectId: parsed.data.projectId, template: "new_message", key: `new-message:${parsed.data.projectId}:${quarterHour()}` });
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
  const { error } = await rpcOnce(admin.supabase, formData, "admin_add_internal_note", { p_project: parsed.data.projectId, p_body: parsed.data.body });
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
  const { error } = await rpcOnce(admin.supabase, formData, "admin_create_proposal", {
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
  const { error } = await rpcOnce(admin.supabase, formData, "admin_send_proposal", { p_proposal: parsed.data.proposalId });
  if (error) return { error: rpcMessage(error.message) };
  const proposal = await admin.supabase.from("proposals").select("version").eq("id", parsed.data.proposalId).maybeSingle();
  await queueProjectEmail({ projectId: parsed.data.projectId, template: "new_proposal", key: `new-proposal:${parsed.data.proposalId}`, payload: { version: proposal.data?.version ?? "" } });
  refresh(parsed.data.projectId);
  return { ok: true, notice: "Пропозицію надіслано клієнту." };
}

// ---------------------------------------------------------------------------
// Етап 2: результати етапів, файли, рахунки й оплати
// ---------------------------------------------------------------------------
Object.assign(RPC_ERRORS, {
  not_pending: "Запис уже не очікує рішення.",
  overpayment: "Сума перевищує залишок за рахунком.",
  refund_exceeds_paid: "Повернення перевищує сплачене.",
  has_payments: "У рахунку є платежі: його не можна анулювати.",
  proposal_not_approved: "Рахунки створюються лише за погодженою пропозицією.",
  invalid_iban: "Некоректний IBAN.",
  mime_not_allowed: "Цей тип файлу не підтримується.",
});

const stageEnum = z.enum(STAGES);
const deliverableFields = z.object({
  title: z.string().trim().min(1, "Вкажіть назву.").max(160),
  description: z.string().trim().max(4000),
  previewUrl: z.string().trim().max(500).refine((value) => value === "" || /^https?:\/\//i.test(value), "Прев’ю: лише http(s)-посилання."),
});

export async function createDeliverableAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const base = z.object({ projectId: uuid, stage: stageEnum }).safeParse({ projectId: formData.get("projectId"), stage: formData.get("stage") });
  const fields = deliverableFields.safeParse({ title: formData.get("title"), description: formData.get("description") ?? "", previewUrl: formData.get("previewUrl") ?? "" });
  if (!base.success) return { error: "Некоректні дані." };
  if (!fields.success) return { fieldError: fields.error.issues[0]?.message ?? "Перевірте поля." };
  const { error } = await rpcOnce(admin.supabase, formData, "admin_create_deliverable", {
    p_project: base.data.projectId,
    p_stage: base.data.stage,
    p_title: fields.data.title,
    p_description: fields.data.description,
    p_preview_url: fields.data.previewUrl || null,
  });
  if (error) return { error: rpcMessage(error.message) };
  refresh(base.data.projectId);
  return { ok: true, notice: "Чернетку створено." };
}

export async function saveDeliverableAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const base = z.object({ id: uuid, projectId: uuid }).safeParse({ id: formData.get("id"), projectId: formData.get("projectId") });
  const fields = deliverableFields.safeParse({ title: formData.get("title"), description: formData.get("description") ?? "", previewUrl: formData.get("previewUrl") ?? "" });
  if (!base.success) return { error: "Некоректні дані." };
  if (!fields.success) return { fieldError: fields.error.issues[0]?.message ?? "Перевірте поля." };
  const { error } = await admin.supabase.rpc("admin_update_deliverable", {
    p_id: base.data.id,
    p_title: fields.data.title,
    p_description: fields.data.description,
    p_preview_url: fields.data.previewUrl || null,
  });
  if (error) return { error: rpcMessage(error.message) };
  refresh(base.data.projectId);
  return { ok: true, notice: "Збережено." };
}

export async function submitDeliverableAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ id: uuid, projectId: uuid }).safeParse({ id: formData.get("id"), projectId: formData.get("projectId") });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { error } = await rpcOnce(admin.supabase, formData, "admin_submit_deliverable", { p_id: parsed.data.id });
  if (error) return { error: rpcMessage(error.message) };
  const version = await admin.supabase.from("deliverables").select("version").eq("id", parsed.data.id).maybeSingle();
  await queueProjectEmail({ projectId: parsed.data.projectId, template: "stage_completed", key: `deliverable:${parsed.data.id}:${version.data?.version ?? 0}` });
  refresh(parsed.data.projectId);
  return { ok: true, notice: "Надіслано клієнту на погодження." };
}

export async function deleteProjectFileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ fileId: uuid, projectId: uuid }).safeParse({ fileId: formData.get("fileId"), projectId: formData.get("projectId") });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { data, error } = await admin.supabase.rpc("delete_project_file", { p_file: parsed.data.fileId });
  if (error) return { error: rpcMessage(error.message) };
  try {
    if (typeof data === "string") await createSupabaseServiceClient().storage.from("project-files").remove([data]);
  } catch {
    // запис позначено видаленим; об'єкт прибере регулярне очищення
  }
  refresh(parsed.data.projectId);
  return { ok: true, notice: "Файл видалено." };
}

export async function createInvoicesFromProposalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ proposalId: uuid, projectId: uuid }).safeParse({ proposalId: formData.get("proposalId"), projectId: formData.get("projectId") });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { data, error } = await rpcOnce(admin.supabase, formData, "admin_create_invoices_from_proposal", { p_proposal: parsed.data.proposalId });
  if (error) return { error: rpcMessage(error.message) };
  refresh(parsed.data.projectId);
  return { ok: true, notice: data === 0 ? "Рахунки за цією пропозицією вже створені." : `Створено чернеток рахунків: ${String(data)}.` };
}

export async function createInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      projectId: uuid,
      label: z.string().trim().min(1, "Вкажіть призначення.").max(120),
      amount: z.coerce.number({ invalid_type_error: "Вкажіть суму числом." }).positive("Сума має бути більшою за 0.").max(1_000_000_000),
      currency: z.enum(["UAH", "USD", "EUR"]),
      due: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]),
    })
    .safeParse({ projectId: formData.get("projectId"), label: formData.get("label"), amount: formData.get("amount"), currency: formData.get("currency"), due: formData.get("due") ?? "" });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Перевірте поля." };
  const { error } = await rpcOnce(admin.supabase, formData, "admin_create_invoice", {
    p_project: parsed.data.projectId,
    p_label: parsed.data.label,
    p_amount: parsed.data.amount,
    p_currency: parsed.data.currency,
    p_due: parsed.data.due || null,
  });
  if (error) return { error: rpcMessage(error.message) };
  refresh(parsed.data.projectId);
  return { ok: true, notice: "Чернетку рахунку створено." };
}

export async function invoiceLifecycleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ invoiceId: uuid, projectId: uuid, op: z.enum(["issue", "void"]), due: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]) })
    .safeParse({ invoiceId: formData.get("invoiceId"), projectId: formData.get("projectId"), op: formData.get("op"), due: formData.get("due") ?? "" });
  if (!parsed.success) return { error: "Некоректні дані." };
  const { error } =
    parsed.data.op === "issue"
      ? await rpcOnce(admin.supabase, formData, "admin_issue_invoice", { p_invoice: parsed.data.invoiceId, p_due: parsed.data.due || null })
      : await rpcOnce(admin.supabase, formData, "admin_void_invoice", { p_invoice: parsed.data.invoiceId });
  if (error) return { error: rpcMessage(error.message) };
  if (parsed.data.op === "issue") {
    const invoice = await admin.supabase.from("invoices").select("number, amount, currency").eq("id", parsed.data.invoiceId).maybeSingle();
    if (invoice.data) {
      await queueProjectEmail({
        projectId: parsed.data.projectId,
        template: "invoice_issued",
        key: `invoice-issued:${parsed.data.invoiceId}`,
        payload: { number: invoice.data.number, amount: invoice.data.amount, currency: invoice.data.currency },
      });
    }
  }
  refresh(parsed.data.projectId);
  return { ok: true, notice: parsed.data.op === "issue" ? "Рахунок виставлено клієнту." : "Рахунок анульовано." };
}

export async function paymentDecisionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      paymentId: uuid,
      projectId: uuid,
      op: z.enum(["confirm", "reject"]),
      amount: z.union([z.coerce.number().positive().max(1_000_000_000), z.literal("")]),
      note: z.string().trim().max(1000),
    })
    .safeParse({ paymentId: formData.get("paymentId"), projectId: formData.get("projectId"), op: formData.get("op"), amount: formData.get("amount") ?? "", note: formData.get("note") ?? "" });
  if (!parsed.success) return { fieldError: "Перевірте суму й коментар." };
  const { error } =
    parsed.data.op === "confirm"
      ? await rpcOnce(admin.supabase, formData, "admin_confirm_payment", { p_payment: parsed.data.paymentId, p_amount: parsed.data.amount === "" ? null : parsed.data.amount, p_note: parsed.data.note || null })
      : await rpcOnce(admin.supabase, formData, "admin_reject_payment", { p_payment: parsed.data.paymentId, p_note: parsed.data.note || null });
  if (error) return { error: rpcMessage(error.message) };
  if (parsed.data.op === "confirm") {
    // Лист лише після підтвердження в журналі: беремо фактичну суму з підтвердженого платежу, а не з форми.
    const payment = await admin.supabase.from("payments").select("amount, currency, status, invoice_id").eq("id", parsed.data.paymentId).maybeSingle();
    if (payment.data?.status === "confirmed") {
      const invoice = await admin.supabase.from("invoices").select("number").eq("id", payment.data.invoice_id as string).maybeSingle();
      await queueProjectEmail({
        projectId: parsed.data.projectId,
        template: "payment_confirmed",
        key: `payment-confirmed:${parsed.data.paymentId}`,
        payload: { number: invoice.data?.number ?? "", amount: payment.data.amount, currency: payment.data.currency },
      });
    }
  }
  refresh(parsed.data.projectId);
  revalidatePath(`/app/projects/${parsed.data.projectId}/payments`);
  return { ok: true, notice: parsed.data.op === "confirm" ? "Надходження підтверджено." : "Платіж відхилено." };
}

export async function refundAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ invoiceId: uuid, projectId: uuid, amount: z.coerce.number({ invalid_type_error: "Вкажіть суму числом." }).positive("Сума має бути більшою за 0."), note: z.string().trim().max(1000) })
    .safeParse({ invoiceId: formData.get("invoiceId"), projectId: formData.get("projectId"), amount: formData.get("amount"), note: formData.get("note") ?? "" });
  if (!parsed.success) return { fieldError: parsed.error.issues[0]?.message ?? "Перевірте поля." };
  const { error } = await rpcOnce(admin.supabase, formData, "admin_record_refund", { p_invoice: parsed.data.invoiceId, p_amount: parsed.data.amount, p_note: parsed.data.note || null });
  if (error) return { error: rpcMessage(error.message) };
  refresh(parsed.data.projectId);
  return { ok: true, notice: "Повернення записано." };
}

export async function updatePaymentSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      recipient: z.string().trim().max(200),
      iban: z.string().trim().max(40),
      bank: z.string().trim().max(200),
      taxId: z.string().trim().max(40),
      hint: z.string().trim().max(300),
    })
    .safeParse({ recipient: formData.get("recipient") ?? "", iban: formData.get("iban") ?? "", bank: formData.get("bank") ?? "", taxId: formData.get("taxId") ?? "", hint: formData.get("hint") ?? "" });
  if (!parsed.success) return { fieldError: "Перевірте поля." };
  const { error } = await admin.supabase.rpc("admin_update_payment_settings", {
    p_recipient: parsed.data.recipient,
    p_iban: parsed.data.iban,
    p_bank: parsed.data.bank,
    p_tax_id: parsed.data.taxId,
    p_hint: parsed.data.hint,
  });
  if (error) return { error: rpcMessage(error.message) };
  revalidatePath("/admin/settings");
  return { ok: true, notice: "Реквізити збережено." };
}
