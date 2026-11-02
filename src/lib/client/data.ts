import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProposalSchedule, StageRow } from "./labels";

/** Усі читання йдуть від імені користувача, тож RLS гарантує: клієнт отримує лише рядки власних проєктів. */

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
  const { data, error } = await supabase.from("projects").select(PROJECT_COLUMNS).order("created_at", { ascending: false });
  if (error) throw new Error("projects_unavailable");
  return (data ?? []) as ProjectRow[];
}

export async function getProject(supabase: SupabaseClient, id: string): Promise<ProjectRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabase.from("projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error("project_unavailable");
  return (data as ProjectRow | null) ?? null;
}

export async function getStages(supabase: SupabaseClient, projectId: string): Promise<StageRow[]> {
  const { data } = await supabase.from("project_stages").select("stage,state,position").eq("project_id", projectId).order("position");
  return (data ?? []) as StageRow[];
}

export type EventRow = { id: number; type: string; actor_role: string; data: Record<string, unknown>; created_at: string };

export async function getEvents(supabase: SupabaseClient, projectId: string, limit = 30): Promise<EventRow[]> {
  const { data } = await supabase
    .from("project_events")
    .select("id,type,actor_role,data,created_at")
    .eq("project_id", projectId)
    .order("id", { ascending: false })
    .limit(limit);
  return (data ?? []) as EventRow[];
}

export async function getAssigneeName(supabase: SupabaseClient, projectId: string): Promise<string | null> {
  const { data } = await supabase.rpc("project_assignee_name", { p_project: projectId });
  return typeof data === "string" ? data : null;
}

export type MessageRow = { id: number; author_role: "client" | "admin"; body: string; created_at: string };

export async function getMessages(supabase: SupabaseClient, projectId: string): Promise<MessageRow[]> {
  const { data } = await supabase
    .from("project_messages")
    .select("id,author_role,body,created_at")
    .eq("project_id", projectId)
    .order("id", { ascending: true })
    .limit(500);
  return (data ?? []) as MessageRow[];
}

/** Скільки повідомлень студії клієнт ще не прочитав у кожному проєкті. */
export async function unreadByProject(supabase: SupabaseClient, projectIds: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = Object.fromEntries(projectIds.map((id) => [id, 0]));
  if (projectIds.length === 0) return result;
  const [reads, messages] = await Promise.all([
    supabase.from("project_message_reads").select("project_id,last_read_id").eq("reader_role", "client").in("project_id", projectIds),
    supabase.from("project_messages").select("id,project_id").eq("author_role", "admin").in("project_id", projectIds),
  ]);
  const lastRead = new Map<string, number>((reads.data ?? []).map((row) => [row.project_id as string, Number(row.last_read_id)]));
  for (const message of messages.data ?? []) {
    if (Number(message.id) > (lastRead.get(message.project_id as string) ?? 0)) {
      result[message.project_id as string] = (result[message.project_id as string] ?? 0) + 1;
    }
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
  const { data } = await supabase.from("proposals").select(PROPOSAL_COLUMNS).eq("project_id", projectId).order("version", { ascending: false });
  return (data ?? []) as ProposalRow[];
}

export type DecisionRow = { id: number; proposal_version: number; decision: string; comment: string | null; created_at: string };

export async function getDecisions(supabase: SupabaseClient, projectId: string): Promise<DecisionRow[]> {
  const { data } = await supabase
    .from("proposal_decisions")
    .select("id,proposal_version,decision,comment,created_at")
    .eq("project_id", projectId)
    .order("id", { ascending: false });
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
  const { data } = await supabase
    .from("deliverables")
    .select("id,stage,version,status,title,description,preview_url,submitted_at,decided_at")
    .eq("project_id", projectId)
    .order("stage")
    .order("version", { ascending: false });
  return (data ?? []) as DeliverableRow[];
}

export type DeliverableDecisionRow = { id: number; stage: string; version: number; decision: string; comment: string | null; created_at: string };

export async function getDeliverableDecisions(supabase: SupabaseClient, projectId: string): Promise<DeliverableDecisionRow[]> {
  const { data } = await supabase
    .from("deliverable_decisions")
    .select("id,stage,version,decision,comment,created_at")
    .eq("project_id", projectId)
    .order("id", { ascending: false });
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
  const { data } = await supabase
    .from("project_files")
    .select("id,category,display_name,mime,size_bytes,uploader_role,message_id,deliverable_id,client_visible,created_at")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);
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
  const [invoices, payments] = await Promise.all([
    supabase.from("invoices").select("id,number,label,amount,currency,due_date,status,issued_at,created_at").eq("project_id", projectId).order("created_at"),
    supabase.from("payments").select("id,invoice_id,kind,method,amount,currency,status,reference,note,created_at,decided_at").eq("project_id", projectId).order("created_at"),
  ]);
  const list = (invoices.data ?? []) as InvoiceRow[];
  const states = await Promise.all(
    list.map(async (invoice) => {
      const { data } = await supabase.rpc("invoice_payment_state", { p_invoice: invoice.id });
      return [invoice.id, (typeof data === "string" ? data : "unpaid") as PaymentState] as const;
    }),
  );
  const stateById = new Map(states);
  return {
    invoices: list.map((invoice) => ({ ...invoice, state: stateById.get(invoice.id) ?? ("unpaid" as PaymentState) })),
    payments: (payments.data ?? []) as PaymentRow[],
  };
}

export type BankDetails = { recipient: string; iban: string; bank_name: string; tax_id: string; purpose_hint: string };

export async function getBankDetails(supabase: SupabaseClient): Promise<BankDetails | null> {
  const { data } = await supabase.rpc("client_bank_details");
  return (data as BankDetails | null) ?? null;
}

export async function getMessageAttachments(supabase: SupabaseClient, projectId: string): Promise<Record<number, Array<{ id: string; name: string; size: number }>>> {
  const { data } = await supabase
    .from("project_files")
    .select("id,display_name,size_bytes,message_id")
    .eq("project_id", projectId)
    .not("message_id", "is", null)
    .is("deleted_at", null);
  const result: Record<number, Array<{ id: string; name: string; size: number }>> = {};
  for (const row of data ?? []) {
    const key = Number(row.message_id);
    (result[key] ??= []).push({ id: row.id as string, name: row.display_name as string, size: Number(row.size_bytes) });
  }
  return result;
}
