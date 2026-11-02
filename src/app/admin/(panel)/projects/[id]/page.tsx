import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AdminChat,
  CreateProposalForm,
  InternalNoteForm,
  ProjectControlForm,
  ProposalEditor,
  StageForm,
  type DraftProposal,
} from "@/components/admin/project-forms";
import { PageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { ProjectStatusPill, StageTimeline } from "@/components/workspace/ui";
import { requireAdmin } from "@/lib/admin/guard";
import { uuidSchema } from "@/lib/admin/orders";
import { PROPOSAL_STATUS_LABELS, formatMoney } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Проєкт" };

export default async function AdminProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase } = await requireAdmin();

  const project = await supabase
    .from("projects")
    .select("id,title,service,status,stage,assignee_id,next_action_owner,next_action,order_id,order:orders(name,email,phone)")
    .eq("id", id)
    .maybeSingle();
  if (project.error) return <p role="alert" className="text-danger">Не вдалося завантажити проєкт.</p>;
  if (!project.data) notFound();
  const p = project.data as unknown as {
    id: string;
    title: string;
    status: string;
    stage: string;
    assignee_id: string | null;
    next_action_owner: string | null;
    next_action: string | null;
    order_id: string | null;
    order: { name: string; email: string; phone: string | null } | Array<{ name: string; email: string; phone: string | null }> | null;
  };
  const order = Array.isArray(p.order) ? p.order[0] : p.order;

  const [stages, messages, reads, notes, proposals, decisions, events, admins] = await Promise.all([
    supabase.from("project_stages").select("stage,state,position").eq("project_id", id).order("position"),
    supabase.from("project_messages").select("id,author_role,body,created_at").eq("project_id", id).order("id").limit(500),
    supabase.from("project_message_reads").select("last_read_id").eq("project_id", id).eq("reader_role", "client").maybeSingle(),
    supabase.from("project_internal_notes").select("id,body,created_at").eq("project_id", id).order("id", { ascending: false }),
    supabase.from("proposals").select("*").eq("project_id", id).order("version", { ascending: false }),
    supabase.from("proposal_decisions").select("id,proposal_version,decision,comment,created_at").eq("project_id", id).order("id", { ascending: false }),
    supabase.from("project_events").select("id,type,actor_role,data,client_visible,created_at").eq("project_id", id).order("id", { ascending: false }).limit(50),
    supabase.from("admin_users").select("user_id,display_name").eq("active", true),
  ]);

  const clientRead = Number(reads.data?.last_read_id ?? 0);
  const chat = (messages.data ?? []) as Array<{ id: number; author_role: "client" | "admin"; body: string; created_at: string }>;
  const lastClientId = chat.filter((m) => m.author_role === "client").at(-1)?.id ?? 0;
  const allProposals = (proposals.data ?? []) as Array<DraftProposal & { status: string; sent_at: string | null }>;
  const draft = allProposals.find((item) => item.status === "draft");

  return (
    <div className="flex flex-col gap-8">
      <Link prefetch={false} href="/admin/projects" className="text-sm text-muted hover:text-fg">
        ← Усі проєкти
      </Link>
      <PageHeader eyebrow={p.title} title={order?.name ?? "Проєкт"}>
        <ProjectStatusPill status={p.status} />
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <Panel title="Етапи">
            <StageTimeline rows={(stages.data ?? []) as Array<{ stage: string; state: string; position: number }>} />
          </Panel>

          <Panel title="Чат із клієнтом">
            <AdminChat
              projectId={id}
              lastClientId={lastClientId}
              messages={chat.map((m) => ({ id: m.id, role: m.author_role, body: m.body, at: m.created_at, readByClient: m.author_role === "admin" && m.id <= clientRead }))}
            />
          </Panel>

          <Panel title="Комерційні пропозиції">
            {draft ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted">Чернетка · версія {draft.version}</p>
                <ProposalEditor projectId={id} proposal={draft} />
              </div>
            ) : (
              <CreateProposalForm projectId={id} copyFrom={allProposals[0]?.id ?? null} />
            )}
            {allProposals.filter((item) => item.status !== "draft").length > 0 ? (
              <ul className="mt-6 flex flex-col gap-2 border-t border-line pt-5">
                {allProposals
                  .filter((item) => item.status !== "draft")
                  .map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-4 py-3 text-sm">
                      <span>
                        Версія {item.version}: {item.title}
                        {item.price_amount ? ` · ${formatMoney(item.price_amount, item.currency)}` : ""}
                      </span>
                      <span className="text-muted">{PROPOSAL_STATUS_LABELS[item.status] ?? item.status}</span>
                    </li>
                  ))}
              </ul>
            ) : null}
          </Panel>

          <Panel title="Журнал погоджень">
            {(decisions.data ?? []).length === 0 ? (
              <p className="text-sm text-muted">Рішень клієнта ще немає.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {(decisions.data ?? []).map((d) => (
                  <li key={d.id as number} className="border-l-2 border-line pl-4 text-sm">
                    <strong>{d.decision === "approved" ? "Погоджено" : "Запитано зміни"}</strong> · версія {d.proposal_version as number} · {formatDateTime(d.created_at as string)}
                    {d.comment ? <p className="mt-1 text-muted">«{d.comment as string}»</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Керування проєктом">
            <div className="flex flex-col gap-6">
              <StageForm projectId={id} stage={p.stage} />
              <ProjectControlForm
                projectId={id}
                status={p.status}
                assignee={p.assignee_id}
                nextOwner={p.next_action_owner}
                nextAction={p.next_action}
                admins={(admins.data ?? []) as Array<{ user_id: string; display_name: string }>}
              />
            </div>
          </Panel>

          <Panel title="Клієнт">
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-muted">Контакти зі заявки</dt>
                <dd className="mt-1 break-all">{order?.email}{order?.phone ? ` · ${order.phone}` : ""}</dd>
              </div>
              {p.order_id ? (
                <div>
                  <Link prefetch={false} href={`/admin/orders/${p.order_id}`} className="text-accent-soft underline underline-offset-4">
                    Відкрити вихідну заявку
                  </Link>
                </div>
              ) : null}
            </dl>
          </Panel>

          <Panel title="Внутрішні нотатки">
            <InternalNoteForm projectId={id} />
            <ul className="mt-5 flex flex-col gap-3">
              {(notes.data ?? []).map((note) => (
                <li key={note.id as number} className="rounded-xl border border-line bg-surface-2/60 p-3 text-sm">
                  <p className="whitespace-pre-wrap break-words">{note.body as string}</p>
                  <p className="mt-1 text-xs text-muted">{formatDateTime(note.created_at as string)}</p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Історія подій">
            <ol className="flex flex-col gap-3 text-sm">
              {(events.data ?? []).map((event) => (
                <li key={event.id as number}>
                  <span>{event.type as string}</span>
                  {event.client_visible ? null : <span className="ml-2 text-xs text-muted">(службова)</span>}
                  <p className="text-xs text-muted">{event.actor_role as string} · {formatDateTime(event.created_at as string)}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
