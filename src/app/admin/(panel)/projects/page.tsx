import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { ProjectStatusPill } from "@/components/workspace/ui";
import { requireAdmin } from "@/lib/admin/guard";
import { STAGE_LABELS, type Stage } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Проєкти" };

type Row = {
  id: string;
  title: string;
  status: string;
  stage: string;
  next_action_owner: string | null;
  updated_at: string;
  order: { name: string; email: string } | { name: string; email: string }[] | null;
};

export default async function AdminProjectsPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("projects")
    .select("id,title,status,stage,next_action_owner,updated_at,order:orders(name,email)")
    .order("updated_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Співпраця" title="Проєкти" />
      {error ? (
        <p role="alert" className="text-danger">Не вдалося завантажити проєкти.</p>
      ) : rows.length === 0 ? (
        <Panel>
          <p className="text-muted">Проєктів ще немає. Проєкт зʼявляється, коли клієнт входить у кабінет за поштою зі своєї заявки (запросити можна на сторінці заявки).</p>
        </Panel>
      ) : (
        <ul className="grid gap-3">
          {rows.map((row) => {
            const order = Array.isArray(row.order) ? row.order[0] : row.order;
            return (
              <li key={row.id}>
                <Link prefetch={false} href={`/admin/projects/${row.id}`} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface/70 p-4 transition-colors hover:border-accent-soft sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    <span className="font-mono text-xs text-muted">{row.title}</span>
                    <span className="block font-medium">{order?.name ?? "Клієнт"}</span>
                    <span className="block text-sm text-muted">{order?.email}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-3 text-sm text-muted">
                    <ProjectStatusPill status={row.status} />
                    <span>{STAGE_LABELS[row.stage as Stage] ?? row.stage}</span>
                    {row.next_action_owner === "client" ? <span className="text-accent-soft">Чекаємо клієнта</span> : null}
                    <time dateTime={row.updated_at}>{formatDateTime(row.updated_at)}</time>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
