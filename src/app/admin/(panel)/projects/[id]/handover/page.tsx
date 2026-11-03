import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompleteProjectForm, HandoverEditor, SubmitHandoverForm } from "@/components/admin/delivery-forms";
import { PageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { Pill } from "@/components/workspace/ui";
import { requireAdmin } from "@/lib/admin/guard";
import { uuidSchema } from "@/lib/admin/orders";
import { DECISION_LABELS, HANDOVER_STATUS_LABELS } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Передача проєкту" };

export default async function AdminHandoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase } = await requireAdmin();
  const [project, record, decisions] = await Promise.all([
    supabase.from("projects").select("id,title,status,service,warranty_until").eq("id", id).maybeSingle(),
    supabase.from("handover_records").select("*").eq("project_id", id).maybeSingle(),
    supabase.from("handover_decisions").select("id,decision,comment,created_at").eq("project_id", id).order("id", { ascending: false }),
  ]);
  if (project.error || record.error) return <p role="alert" className="text-danger">Не вдалося завантажити дані передачі.</p>;
  if (!project.data) notFound();
  const p = project.data as { title: string; status: string; service: string; warranty_until: string | null };
  const r = record.data as (Record<string, string | null> & { status: string; product_kind: string; artifacts: Array<{ kind: string; label: string; url: string }> }) | null;
  const kind = r?.product_kind ?? (["mobile-apps", "mobile"].includes(p.service) ? "mobile" : "website");
  const editable = !r || r.status === "draft" || r.status === "changes_requested";
  const dec = (decisions.data ?? []) as Array<{ id: number; decision: string; comment: string | null; created_at: string }>;

  return (
    <div className="flex flex-col gap-8">
      <Link prefetch={false} href={`/admin/projects/${id}`} className="text-sm text-muted hover:text-fg">← Проєкт</Link>
      <PageHeader eyebrow={p.title} title="Передача проєкту">
        <Pill tone={r?.status === "accepted" ? "ok" : "muted"}>{r ? HANDOVER_STATUS_LABELS[r.status] ?? r.status : "Не розпочато"}</Pill>
      </PageHeader>

      <Panel title="Дані передачі">
        {editable ? (
          <HandoverEditor projectId={id} record={r} kind={kind} />
        ) : (
          <p className="text-muted">Передачу відправлено або прийнято — змінити її вже не можна.</p>
        )}
      </Panel>

      {r && editable ? (
        <Panel title="Відправити клієнту">
          <p className="mb-3 text-sm text-muted">Спершу збережіть чернетку. Сервер перевірить повноту: для сайту потрібні production URL і документація/інструкція, для застосунку — версія й артефакти.</p>
          <SubmitHandoverForm projectId={id} />
        </Panel>
      ) : null}

      {r?.status === "accepted" && p.status !== "completed" ? (
        <Panel title="Завершення">
          <CompleteProjectForm projectId={id} />
        </Panel>
      ) : null}
      {p.status === "completed" ? <p className="text-sm text-ok">Проєкт завершено{p.warranty_until ? `, гарантія до ${p.warranty_until}` : ""}.</p> : null}

      {dec.length > 0 ? (
        <Panel title="Рішення клієнта">
          <ul className="flex flex-col gap-2 text-sm">
            {dec.map((d) => (
              <li key={d.id}>
                {formatDateTime(d.created_at)} — <strong>{DECISION_LABELS[d.decision] ?? d.decision}</strong>
                {d.comment ? `: ${d.comment}` : ""}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
