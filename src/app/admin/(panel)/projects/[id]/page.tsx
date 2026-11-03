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
import {
  DeleteFileForm,
  DeliverableDraftForm,
  InvoicesFromProposalForm,
  IssueInvoiceForm,
  NewDeliverableForm,
  NewInvoiceForm,
  PaymentDecisionForms,
  RefundForm,
  VoidInvoiceForm,
} from "@/components/admin/stage2-forms";
import { PageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { FileUploader } from "@/components/workspace/file-uploader";
import { ADMIN_CATEGORIES } from "@/lib/files/policy";
import { ProjectStatusPill, StageTimeline } from "@/components/workspace/ui";
import { requireAdmin } from "@/lib/admin/guard";
import { uuidSchema } from "@/lib/admin/orders";
import { DELIVERABLE_STATUS_LABELS, FILE_CATEGORY_LABELS, PAYMENT_STATE_LABELS, PROPOSAL_STATUS_LABELS, STAGE_LABELS, formatBytes, formatMoney, type Stage } from "@/lib/client/labels";

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

  const [stages, messages, reads, notes, proposals, decisions, events, admins, deliverables, files, invoicesRes, paymentsRes] = await Promise.all([
    supabase.from("project_stages").select("stage,state,position").eq("project_id", id).order("position"),
    supabase.from("project_messages").select("id,author_role,body,created_at").eq("project_id", id).order("id").limit(500),
    supabase.from("project_message_reads").select("last_read_id").eq("project_id", id).eq("reader_role", "client").maybeSingle(),
    supabase.from("project_internal_notes").select("id,body,created_at").eq("project_id", id).order("id", { ascending: false }),
    supabase.from("proposals").select("*").eq("project_id", id).order("version", { ascending: false }),
    supabase.from("proposal_decisions").select("id,proposal_version,decision,comment,created_at").eq("project_id", id).order("id", { ascending: false }),
    supabase.from("project_events").select("id,type,actor_role,data,client_visible,created_at").eq("project_id", id).order("id", { ascending: false }).limit(50),
    supabase.from("admin_users").select("user_id,display_name").eq("active", true),
    supabase.from("deliverables").select("id,stage,version,status,title,description,preview_url").eq("project_id", id).order("stage").order("version", { ascending: false }),
    supabase.from("project_files").select("id,category,display_name,size_bytes,uploader_role,client_visible,message_id,deliverable_id,created_at").eq("project_id", id).is("deleted_at", null).order("created_at", { ascending: false }).limit(300),
    supabase.from("invoices").select("id,number,label,amount,currency,status,due_date").eq("project_id", id).order("created_at"),
    supabase.from("payments").select("id,invoice_id,kind,method,amount,currency,status,reference,note,created_at").eq("project_id", id).order("created_at"),
  ]);
  const invoiceList = (invoicesRes.data ?? []) as Array<{ id: string; number: string; label: string; amount: string; currency: string; status: string; due_date: string | null }>;
  const paymentList = (paymentsRes.data ?? []) as Array<{ id: string; invoice_id: string; kind: string; method: string; amount: string; currency: string; status: string; reference: string | null; note: string | null; created_at: string }>;
  const invoiceStates = new Map<string, string>();
  for (const invoice of invoiceList) {
    const { data } = await supabase.rpc("invoice_payment_state", { p_invoice: invoice.id });
    invoiceStates.set(invoice.id, typeof data === "string" ? data : "unpaid");
  }
  const deliverableList = (deliverables.data ?? []) as Array<{ id: string; stage: string; version: number; status: string; title: string; description: string; preview_url: string | null }>;
  const fileList = (files.data ?? []) as Array<{ id: string; category: string; display_name: string; size_bytes: number; uploader_role: string; client_visible: boolean; message_id: number | null; deliverable_id: string | null; created_at: string }>;

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
        <Link prefetch={false} href={`/admin/projects/${id}/workflow`} className="text-sm text-accent-soft underline underline-offset-4">
          Життєвий цикл, документи, зміни
        </Link>
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

          <Panel title="Результати етапів (дизайн-рев’ю, прев’ю, QA, передача)">
            <div className="flex flex-col gap-6">
              {deliverableList.length === 0 ? <p className="text-sm text-muted">Результатів ще немає.</p> : null}
              {deliverableList.map((item) => (
                <div key={item.id} className="rounded-xl border border-line p-4">
                  <p className="font-medium">
                    {STAGE_LABELS[item.stage as Stage] ?? item.stage} · версія {item.version}: {item.title}
                  </p>
                  <p className="text-sm text-muted">{DELIVERABLE_STATUS_LABELS[item.status] ?? item.status}</p>
                  {item.status === "draft" ? (
                    <div className="mt-4 flex flex-col gap-4">
                      <DeliverableDraftForm projectId={id} id={item.id} title={item.title} description={item.description} previewUrl={item.preview_url} />
                      <FileUploader projectId={id} categories={ADMIN_CATEGORIES} fixedCategory="mockup" deliverableId={item.id} label="Файли результату" />
                    </div>
                  ) : null}
                </div>
              ))}
              {!deliverableList.some((item) => item.status === "draft") ? <NewDeliverableForm projectId={id} /> : null}
            </div>
          </Panel>

          <Panel title="Файли проєкту">
            <FileUploader projectId={id} categories={ADMIN_CATEGORIES} allowVisibility />
            <ul className="mt-6 flex flex-col gap-2">
              {fileList.filter((file) => !file.message_id).map((file) => (
                <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <a href={`/api/files/${file.id}`} rel="nofollow" className="break-all text-accent-soft underline-offset-4 hover:underline">
                      {file.display_name}
                    </a>
                    <span className="block text-xs text-muted">
                      {FILE_CATEGORY_LABELS[file.category] ?? file.category} · {formatBytes(file.size_bytes)} · {file.uploader_role === "admin" ? "студія" : "клієнт"}
                      {file.client_visible ? "" : " · прихований від клієнта"} · {formatDateTime(file.created_at)}
                    </span>
                  </span>
                  <DeleteFileForm projectId={id} fileId={file.id} />
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Рахунки й оплати">
            <div className="flex flex-col gap-6">
              {allProposals.find((item) => item.status === "approved") ? (
                <InvoicesFromProposalForm proposalId={allProposals.find((item) => item.status === "approved")!.id} projectId={id} />
              ) : (
                <p className="text-sm text-muted">Рахунки за графіком пропозиції створюються після того, як клієнт погодить пропозицію. Окремий рахунок можна створити вручну.</p>
              )}
              {invoiceList.map((invoice) => {
                const state = invoiceStates.get(invoice.id) ?? "unpaid";
                const pending = paymentList.filter((payment) => payment.invoice_id === invoice.id && payment.status === "pending");
                const history = paymentList.filter((payment) => payment.invoice_id === invoice.id && payment.status !== "pending");
                return (
                  <div key={invoice.id} className="flex flex-col gap-4 rounded-xl border border-line p-4">
                    <p className="font-medium">
                      {invoice.number} · {invoice.label} · {formatMoney(invoice.amount, invoice.currency)}
                    </p>
                    <p className="text-sm text-muted">
                      Документ: {invoice.status === "draft" ? "чернетка" : invoice.status === "issued" ? "виставлено" : "анульовано"} · Оплата: {PAYMENT_STATE_LABELS[state] ?? state}
                    </p>
                    {history.length > 0 ? (
                      <ul className="flex flex-col gap-1 text-xs text-muted">
                        {history.map((payment) => (
                          <li key={payment.id}>
                            {payment.kind === "refund" ? "Повернення" : "Платіж"} {formatMoney(payment.amount, payment.currency)} · {payment.status === "confirmed" ? "підтверджено" : "відхилено/помилка"} · {payment.method}
                            {payment.note ? ` · ${payment.note}` : ""} · {formatDateTime(payment.created_at)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {pending.map((payment) => (
                      <PaymentDecisionForms key={payment.id} paymentId={payment.id} projectId={id} amount={formatMoney(payment.amount, payment.currency)} />
                    ))}
                    {invoice.status === "draft" ? <IssueInvoiceForm invoiceId={invoice.id} projectId={id} /> : null}
                    {invoice.status !== "void" && (state === "paid" || state === "partial") ? <RefundForm invoiceId={invoice.id} projectId={id} /> : null}
                    {invoice.status !== "void" && state === "unpaid" ? <VoidInvoiceForm invoiceId={invoice.id} projectId={id} /> : null}
                  </div>
                );
              })}
              <NewInvoiceForm projectId={id} />
            </div>
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
