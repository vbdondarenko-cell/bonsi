import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivateProjectForm, ChangeProgressForm, DocumentEditor, InvoicePurposeForm, NewDocumentForm, QuoteChangeForm, RejectChangeForm, VoidDocumentForm } from "@/components/admin/workflow-forms";
import { PageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { Pill } from "@/components/workspace/ui";
import { requireAdmin } from "@/lib/admin/guard";
import { uuidSchema } from "@/lib/admin/orders";
import { CHANGE_STATUS_LABELS, DECISION_LABELS, DOCUMENT_KIND_LABELS, DOCUMENT_STATUS_LABELS, formatMoney } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Бізнес-процес проєкту" };

export default async function ProjectWorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase } = await requireAdmin();

  const project = await supabase.from("projects").select("id,title,status,stage,activated_at,activation_note").eq("id", id).maybeSingle();
  if (project.error) return <p role="alert" className="text-danger">Не вдалося завантажити проєкт.</p>;
  if (!project.data) notFound();
  const p = project.data as { id: string; title: string; status: string; stage: string; activated_at: string | null; activation_note: string | null };

  const [activation, documents, versions, decisions, changes, scope, invoices] = await Promise.all([
    supabase.rpc("project_activation_status", { p_project: id }),
    supabase.from("documents").select("id,kind,title,status,current_version,change_request_id,sent_at,created_at").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("document_versions").select("document_id,version,body,content_hash,frozen_at").order("version", { ascending: false }),
    supabase.from("document_decisions").select("id,document_id,version,decision,comment,created_at").order("id", { ascending: false }),
    supabase.from("change_requests").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("project_scope").select("id,kind,title,price_amount,currency,duration_days,created_at").eq("project_id", id).order("id"),
    supabase.from("invoices").select("id,number,label,amount,currency,status,purpose").eq("project_id", id).order("created_at"),
  ]);
  const act = (activation.data ?? null) as { activated: boolean; proposal_approved: boolean; contract_approved: boolean; prepayment_required: boolean; prepayment_paid: boolean; ready: boolean } | null;
  const docs = (documents.data ?? []) as Array<{ id: string; kind: string; title: string; status: string; current_version: number; change_request_id: string | null; sent_at: string | null }>;
  const docIds = new Set(docs.map((d) => d.id));
  const verList = ((versions.data ?? []) as Array<{ document_id: string; version: number; body: string; content_hash: string; frozen_at: string | null }>).filter((v) => docIds.has(v.document_id));
  const decList = ((decisions.data ?? []) as Array<{ id: number; document_id: string; version: number; decision: string; comment: string | null; created_at: string }>).filter((d) => docIds.has(d.document_id));
  const changeList = (changes.data ?? []) as Array<{ id: string; number: string; title: string; description: string; status: string; quote_price: string | null; quote_currency: string | null; quote_days: number | null; rejection_reason: string | null; created_at: string }>;
  const scopeList = (scope.data ?? []) as Array<{ id: number; kind: string; title: string; price_amount: string | null; currency: string | null; duration_days: number | null; created_at: string }>;
  const invoiceList = (invoices.data ?? []) as Array<{ id: string; number: string; label: string; amount: string; currency: string; status: string; purpose: string }>;

  const check = (ok: boolean | undefined) => (
    <span aria-hidden="true" className={ok ? "text-ok" : "text-muted"}>
      {ok ? "✓" : "○"}
    </span>
  );

  return (
    <div className="flex flex-col gap-8">
      <Link prefetch={false} href={`/admin/projects/${id}`} className="text-sm text-muted hover:text-fg">
        ← Проєкт
      </Link>
      <PageHeader eyebrow={p.title} title="Життєвий цикл і документи">
        <Pill tone={p.activated_at ? "ok" : "warn"}>{p.activated_at ? "Проєкт активний" : "Заявка / робочий простір"}</Pill>
      </PageHeader>

      <Panel title="Активація проєкту">
        {p.activated_at ? (
          <p>
            Активовано {formatDateTime(p.activated_at)}.{p.activation_note ? ` Примітка: ${p.activation_note}` : ""} Базовий обсяг робіт зафіксовано та не змінюється.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2 text-sm" aria-label="Умови активації">
              <li className="flex gap-2">{check(act?.proposal_approved)} Комерційну пропозицію погоджено клієнтом</li>
              <li className="flex gap-2">{check(act?.contract_approved)} Договір (документ «Договір на розробку») погоджено клієнтом</li>
              <li className="flex gap-2">
                {check(act ? !act.prepayment_required || act.prepayment_paid : false)}
                {act?.prepayment_required ? "Рахунок-передоплату оплачено (підтверджено в журналі)" : "Передоплата не передбачена (немає рахунку з призначенням «передоплата»)"}
              </li>
            </ul>
            <ActivateProjectForm projectId={id} ready={Boolean(act?.ready)} />
          </div>
        )}
      </Panel>

      <Panel title="Призначення рахунків">
        {invoiceList.length === 0 ? (
          <p className="text-sm text-muted">Рахунків ще немає. Створіть їх у розділі «Оплата» проєкту, а тут позначте рахунок-передоплату.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {invoiceList.map((invoice) => (
              <li key={invoice.id} className="rounded-xl border border-line p-4">
                <p className="flex flex-wrap gap-2 text-sm">
                  <span className="font-mono">{invoice.number}</span> {invoice.label} · {formatMoney(invoice.amount, invoice.currency)} · {invoice.status === "draft" ? "чернетка" : invoice.status === "issued" ? "виставлено" : "анульовано"} ·{" "}
                  {invoice.purpose === "prepayment" ? "передоплата" : invoice.purpose === "change" ? "зміна замовлення" : "звичайний"}
                </p>
                {invoice.status === "draft" ? <div className="mt-3"><InvoicePurposeForm projectId={id} invoiceId={invoice.id} purpose={invoice.purpose} /></div> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Документи">
        <div className="mb-6"><NewDocumentForm projectId={id} /></div>
        {docs.length === 0 ? (
          <p className="text-sm text-muted">Документів ще немає.</p>
        ) : (
          <ul className="flex flex-col gap-5">
            {docs.map((doc) => {
              const current = verList.find((v) => v.document_id === doc.id && v.version === doc.current_version);
              const log = decList.filter((d) => d.document_id === doc.id);
              const editable = doc.status === "draft" || doc.status === "changes_requested";
              return (
                <li key={doc.id} className="rounded-xl border border-line p-4">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-xs uppercase tracking-wider text-muted">{DOCUMENT_KIND_LABELS[doc.kind] ?? doc.kind}</span>
                    <strong>{doc.title}</strong>
                    <Pill tone={doc.status === "approved" ? "ok" : doc.status === "sent" ? "warn" : doc.status === "void" ? "danger" : "muted"}>{DOCUMENT_STATUS_LABELS[doc.status] ?? doc.status}</Pill>
                    <span className="text-xs text-muted">версія {doc.current_version}</span>
                    <a href={`/admin/projects/${id}/documents/${doc.id}/pdf`} download className="ml-auto text-xs text-accent-soft underline underline-offset-4">
                      PDF
                    </a>
                  </p>
                  {current ? <p className="mt-1 break-all font-mono text-xs text-muted">SHA-256: {current.content_hash}</p> : null}
                  {log.length > 0 ? (
                    <ol className="mt-3 flex flex-col gap-1 text-sm">
                      {log.map((d) => (
                        <li key={d.id}>
                          {DECISION_LABELS[d.decision] ?? d.decision} · версія {d.version} · {formatDateTime(d.created_at)}
                          {d.comment ? ` · «${d.comment}»` : ""}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {editable && current ? (
                    <div className="mt-4">
                      <DocumentEditor projectId={id} id={doc.id} title={doc.title} body={current.body} version={current.frozen_at ? doc.current_version + 1 : doc.current_version} />
                    </div>
                  ) : null}
                  {doc.status === "sent" || editable ? <div className="mt-4"><VoidDocumentForm projectId={id} id={doc.id} /></div> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Запити на зміни">
        {changeList.length === 0 ? (
          <p className="text-sm text-muted">Запитів на зміни немає.</p>
        ) : (
          <ul className="flex flex-col gap-5">
            {changeList.map((change) => (
              <li key={change.id} className="rounded-xl border border-line p-4">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted">{change.number}</span>
                  <strong>{change.title}</strong>
                  <Pill tone={change.status === "rejected" || change.status === "withdrawn" ? "danger" : change.status === "submitted" ? "warn" : "ok"}>{CHANGE_STATUS_LABELS[change.status] ?? change.status}</Pill>
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{change.description}</p>
                {change.quote_price && change.quote_currency ? <p className="mt-2 text-sm">Оцінка: {formatMoney(change.quote_price, change.quote_currency)}, {change.quote_days} дн.</p> : null}
                {change.rejection_reason ? <p className="mt-2 text-sm text-muted">Причина: {change.rejection_reason}</p> : null}
                {change.status === "submitted" ? (
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <QuoteChangeForm projectId={id} id={change.id} />
                    <RejectChangeForm projectId={id} id={change.id} />
                  </div>
                ) : null}
                {change.status === "quoted" ? <div className="mt-4"><RejectChangeForm projectId={id} id={change.id} /></div> : null}
                {change.status === "approved" ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <ChangeProgressForm projectId={id} id={change.id} op="in_progress" label="Взяти в роботу" />
                    <ChangeProgressForm projectId={id} id={change.id} op="invoice" label="Створити чернетку рахунку" />
                  </div>
                ) : null}
                {change.status === "in_progress" ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <ChangeProgressForm projectId={id} id={change.id} op="done" label="Позначити виконаною" />
                    <ChangeProgressForm projectId={id} id={change.id} op="invoice" label="Створити чернетку рахунку" />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Обсяг робіт (Scope of Work)">
        {scopeList.length === 0 ? (
          <p className="text-sm text-muted">Базова лінія зʼявиться в момент активації.</p>
        ) : (
          <ol className="flex flex-col gap-2 text-sm">
            {scopeList.map((row) => (
              <li key={row.id}>
                <strong>{row.kind === "baseline" ? "Базовий обсяг" : "Погоджена зміна"}</strong>: {row.title}
                {row.price_amount && row.currency ? ` · ${formatMoney(row.price_amount, row.currency)}` : ""}
                {row.duration_days ? ` · ${row.duration_days} дн.` : ""} · {formatDateTime(row.created_at)}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
