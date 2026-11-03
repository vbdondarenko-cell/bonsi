import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { Pill } from "@/components/workspace/ui";
import { requireAdmin } from "@/lib/admin/guard";
import { TICKET_CATEGORY_LABELS, TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Підтримка" };

export default async function AdminSupportPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("support_tickets")
    .select("id,number,subject,category,priority,status,updated_at,projects(title)")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return <p role="alert" className="text-danger">Не вдалося завантажити звернення.</p>;
  const rows = (data ?? []) as unknown as Array<{ id: string; number: string; subject: string; category: string; priority: string; status: string; updated_at: string; projects: { title: string } | null }>;
  const open = rows.filter((t) => t.status !== "closed" && t.status !== "resolved");
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Студія" title="Підтримка та гарантія">
        <Pill tone="accent">відкритих: {open.length}</Pill>
      </PageHeader>
      <Panel>
        {rows.length === 0 ? (
          <p className="text-muted">Звернень ще немає.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((t) => (
              <li key={t.id} className="flex flex-col gap-1 py-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted">{t.number}</span>
                  <Link prefetch={false} href={`/admin/support/${t.id}`} className="font-semibold underline-offset-4 hover:underline">{t.subject}</Link>
                  <Pill tone={t.status === "resolved" || t.status === "closed" ? "ok" : "muted"}>{TICKET_STATUS_LABELS[t.status] ?? t.status}</Pill>
                  {t.priority === "high" || t.priority === "urgent" ? <Pill tone="warn">{TICKET_PRIORITY_LABELS[t.priority]}</Pill> : null}
                </p>
                <p className="text-xs text-muted">
                  {t.projects?.title ?? "—"} · {TICKET_CATEGORY_LABELS[t.category] ?? t.category} · {formatDateTime(t.updated_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
