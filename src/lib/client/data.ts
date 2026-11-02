import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProposalSchedule, StageRow } from "./labels";

/** Усі читання йдуть від імені користувача, тож RLS гарантує: клієнт отримує лише рядки власних проєктів. */

/**
 * Помилка читання даних. Раніше помилки Supabase глушились і сторінка показувала «порожньо» / «не сплачено»;
 * тепер кожне читання або повертає реальні дані, або кидає DataError, який показує error.tsx із кнопкою «Спробувати ще раз».
 */
export class DataError extends Error {
  constructor(
    readonly what: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(`data_unavailable:${what}`, options);
    this.name = "DataError";
  }
}

type PgResult<T> = { data: T | null; error: { message: string; code?: string; status?: number } | null };

/** Помилки мережі/шлюзу/перевантаження повторюємо один раз; логічні (RLS, синтаксис) — одразу. */
function transient(error: { message: string; code?: string; status?: number }) {
  if (error.status && error.status >= 500) return true;
  if (error.code && /^(08|53|57P0)/.test(error.code)) return true;
  return /fetch failed|network|timeout|timed out|ECONN|ETIMEDOUT|503|502|504/i.test(error.message);
}

export async function read<T>(what: string, run: () => PromiseLike<PgResult<T>>, attempts = 2): Promise<T | null> {
  let last: PgResult<T>["error"] = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let result: PgResult<T>;
    try {
      result = await run();
    } catch (cause) {
      last = { message: cause instanceof Error ? cause.message : "fetch failed" };
      if (attempt < attempts) continue;
      throw new DataError(what, true, { cause });
    }
    if (!result.error) return result.data;
    last = result.error;
    if (!transient(result.error) || attempt === attempts) break;
  }
  throw new DataError(what, last ? transient(last) : false, { cause: last });
}

export type ProjectRow = {
  id: string;
  title: string;
  service: string;
  status: string;
  stage: string;
  next_action_owner: "client" | "studio" | null;
  next_action: string | null;
  created_at: string;
  updated_at: string;
};

const PROJECT_COLUMNS = "id,title,service,status,stage,next_action_owner,next_action,created_at,updated_at";

export async function listProjects(supabase: SupabaseClient): Promise<ProjectRow[]> {
  const data = await read("projects", () => supabase.from("projects").select(PROJECT_COLUMNS).order("created_at", { ascending: false }));
  return (data ?? []) as ProjectRow[];
}

export async function getProject(supabase: SupabaseClient, id: string): Promise<ProjectRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const data = await read("project", () => supabase.from("projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle());
  return (data as ProjectRow | null) ?? null;
}

export async function getStages(supabase: SupabaseClient, projectId: string): Promise<StageRow[]> {
  const data = await read("stages", () => supabase.from("project_stages").select("stage,state,position").eq("project_id", projectId).order("position"));
  return (data ?? []) as StageRow[];
}

export type EventRow = { id: number; type: string; actor_role: string; data: Record<string, unknown>; created_at: string };

export async function getEvents(supabase: SupabaseClient, projectId: string, limit = 30): Promise<EventRow[]> {
  const data = await read("events", () =>
    supabase.from("project_events").select("id,type,actor_role,data,created_at").eq("project_id", projectId).order("id", { ascending: false }).limit(limit),
  );
  return (data ?? []) as EventRow[];
}

export async function getAssigneeName(supabase: SupabaseClient, projectId: string): Promise<string | null> {
  const data = await read("assignee", () => supabase.rpc("project_assignee_name", { p_project: projectId }));
  return typeof data === "string" ? data : null;
}

export type MessageRow = { id: number; author_role: "client" | "admin"; body: string; created_at: string };

export const MESSAGES_PAGE = 50;

/**
 * Остання сторінка чату (або сторінка перед курсором `before`). Читаємо з кінця (id desc) і розвертаємо:
 * раніше брались перші 500 повідомлень, тож у довгому листуванні найновіші не показувались.
 */
export async function getMessages(supabase: SupabaseClient, projectId: string, options: { before?: number; limit?: number } = {}): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(options.limit ?? MESSAGES_PAGE, 1), 200);
  const data = await read("messages", () => {
    let query = supabase.from("project_messages").select("id,author_role,body,created_at").eq("project_id", projectId);
    if (options.before) query = query.lt("id", options.before);
    return query.order("id", { ascending: false }).limit(limit + 1);
  });
  const rows = (data ?? []) as MessageRow[];
  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).reverse(), hasMore };
}

/** Нові повідомлення після курсора (для опитування); порядок за зростанням id. */
export async function getMessagesAfter(supabase: SupabaseClient, projectId: string, after: number, limit = 200): Promise<MessageRow[]> {
  const data = await read("messages", () =>
    supabase.from("project_messages").select("id,author_role,body,created_at").eq("project_id", projectId).gt("id", after).order("id", { ascending: true }).limit(limit),
  );
  return (data ?? []) as MessageRow[];
}

/** Скільки повідомлень студії клієнт ще не прочитав у кожному проєкті (один запит у БД, а не вибірка всіх повідомлень). */
export async function unreadByProject(supabase: SupabaseClient, projectIds: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = Object.fromEntries(projectIds.map((id) => [id, 0]));
  if (projectIds.length === 0) return result;
  const data = await read("unread", () => supabase.rpc("client_unread_counts"));
  for (const row of (data ?? []) as Array<{ project_id: string; unread: number | string }>) {
    if (row.project_id in result) result[row.project_id] = Number(row.unread);
  }
  return result;
}

export type ProposalRow = {
  id: string;
  version: number;
  status: string;
  title: string;
  summary: string;
  features: string[];
  price_amount: string | null;
  currency: string;
  duration_days: number | null;
  payment_schedule: ProposalSchedule;
  included_revisions: number;
  acceptance_terms: string;
  sent_at: string | null;
  decided_at: string | null;
};

const PROPOSAL_COLUMNS =
  "id,version,status,title,summary,features,price_amount,currency,duration_days,payment_schedule,included_revisions,acceptance_terms,sent_at,decided_at";

export async function getProposals(supabase: SupabaseClient, projectId: string): Promise<ProposalRow[]> {
  const data = await read("proposals", () => supabase.from("proposals").select(PROPOSAL_COLUMNS).eq("project_id", projectId).order("version", { ascending: false }));
  return (data ?? []) as ProposalRow[];
}

export type DecisionRow = { id: number; proposal_version: number; decision: string; comment: string | null; created_at: string };

export async function getDecisions(supabase: SupabaseClient, projectId: string): Promise<DecisionRow[]> {
  const data = await read("proposal_decisions", () =>
    supabase.from("proposal_decisions").select("id,proposal_version,decision,comment,created_at").eq("project_id", projectId).order("id", { ascending: false }),
  );
  return (data ?? []) as DecisionRow[];
}

export type DeliverableRow = {
  id: string;
  stage: string;
  version: number;
  status: string;
  title: string;
  description: string;
  preview_url: string | null;
  submitted_at: string | null;
  decided_at: string | null;
};

export async function getDeliverables(supabase: SupabaseClient, projectId: string): Promise<DeliverableRow[]> {
  const data = await read("deliverables", () =>
    supabase.from("deliverables").select("id,stage,version,status,title,description,preview_url,submitted_at,decided_at").eq("project_id", projectId).order("stage").order("version", { ascending: false }),
  );
  return (data ?? []) as DeliverableRow[];
}

export type DeliverableDecisionRow = { id: number; stage: string; version: number; decision: string; comment: string | null; created_at: string };

export async function getDeliverableDecisions(supabase: SupabaseClient, projectId: string): Promise<DeliverableDecisionRow[]> {
  const data = await read("deliverable_decisions", () =>
    supabase.from("deliverable_decisions").select("id,stage,version,decision,comment,created_at").eq("project_id", projectId).order("id", { ascending: false }),
  );
  return (data ?? []) as DeliverableDecisionRow[];
}

export type FileRow = {
  id: string;
  category: string;
  display_name: string;
  mime: string;
  size_bytes: number;
  uploader_role: "client" | "admin";
  message_id: number | null;
  deliverable_id: string | null;
  client_visible: boolean;
  created_at: string;
};

export async function getFiles(supabase: SupabaseClient, projectId: string): Promise<FileRow[]> {
  const data = await read("files", () =>
    supabase
      .from("project_files")
      .select("id,category,display_name,mime,size_bytes,uploader_role,message_id,deliverable_id,client_visible,created_at")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500),
  );
  return (data ?? []) as FileRow[];
}

export type InvoiceRow = {
  id: string;
  number: string;
  label: string;
  amount: string;
  currency: string;
  due_date: string | null;
  status: string;
  issued_at: string | null;
  created_at: string;
};

export type PaymentRow = {
  id: string;
  invoice_id: string;
  kind: "payment" | "refund";
  method: string;
  amount: string;
  currency: string;
  status: "pending" | "confirmed" | "failed";
  reference: string | null;
  note: string | null;
  created_at: string;
  decided_at: string | null;
};

export type PaymentState = "unpaid" | "awaiting_confirmation" | "partial" | "paid" | "void";

/** Оплата рахунків: статус «оплачено» береться лише з підтверджених записів журналу (invoice_payment_state у БД). */
export async function getInvoicesWithPayments(supabase: SupabaseClient, projectId: string) {
  const [invoices, payments, states] = await Promise.all([
    read("invoices", () => supabase.from("invoices").select("id,number,label,amount,currency,due_date,status,issued_at,created_at").eq("project_id", projectId).order("created_at")),
    read("payments", () => supabase.from("payments").select("id,invoice_id,kind,method,amount,currency,status,reference,note,created_at,decided_at").eq("project_id", projectId).order("created_at")),
    read("invoice_states", () => supabase.rpc("project_invoice_states", { p_project: projectId })),
  ]);
  // Стан береться лише з БД. Якщо для рахунку стану немає — це помилка даних, а не «не сплачено».
  const stateById = new Map(((states ?? []) as Array<{ invoice_id: string; state: PaymentState }>).map((row) => [row.invoice_id, row.state]));
  const list = (invoices ?? []) as InvoiceRow[];
  return {
    invoices: list.map((invoice) => {
      const state = stateById.get(invoice.id);
      if (!state) throw new DataError("invoice_states", false);
      return { ...invoice, state };
    }),
    payments: (payments ?? []) as PaymentRow[],
  };
}

export type BankDetails = { recipient: string; iban: string; bank_name: string; tax_id: string; purpose_hint: string };

export async function getBankDetails(supabase: SupabaseClient): Promise<BankDetails | null> {
  const data = await read("bank_details", () => supabase.rpc("client_bank_details"));
  return (data as BankDetails | null) ?? null;
}

export async function getMessageAttachments(supabase: SupabaseClient, projectId: string, messageIds?: number[]): Promise<Record<number, Array<{ id: string; name: string; size: number }>>> {
  const result: Record<number, Array<{ id: string; name: string; size: number }>> = {};
  if (messageIds && messageIds.length === 0) return result;
  const data = await read("attachments", () => {
    const query = supabase.from("project_files").select("id,display_name,size_bytes,message_id").eq("project_id", projectId).is("deleted_at", null);
    return messageIds ? query.in("message_id", messageIds) : query.not("message_id", "is", null);
  });
  for (const row of data ?? []) {
    const key = Number(row.message_id);
    (result[key] ??= []).push({ id: row.id as string, name: row.display_name as string, size: Number(row.size_bytes) });
  }
  return result;
}

/** Скільки повідомлень клієнта студія вже прочитала (до цього id включно). */
export async function getStudioReadCursor(supabase: SupabaseClient, projectId: string): Promise<number> {
  const data = await read("reads", () => supabase.from("project_message_reads").select("last_read_id").eq("project_id", projectId).eq("reader_role", "admin").maybeSingle());
  return Number((data as { last_read_id?: number | string } | null)?.last_read_id ?? 0);
}
