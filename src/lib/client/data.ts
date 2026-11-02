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
