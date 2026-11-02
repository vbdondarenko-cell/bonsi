import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/guard";

export const metadata: Metadata = { title: "Клієнти" };

type Row = {
  id: string;
  title: string;
  client_id: string;
  order: { name: string; email: string } | { name: string; email: string }[] | null;
};

/** Клієнти = користувачі кабінету, згруповані за проєктами. Контакти беруться із заявки: вдруге нічого вводити не потрібно. */
export default async function AdminClientsPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("projects").select("id,title,client_id,order:orders(name,email)").order("created_at", { ascending: false }).limit(500);
  const groups = new Map<string, { name: string; email: string; projects: Array<{ id: string; title: string }> }>();
  for (const row of (data ?? []) as unknown as Row[]) {
    const order = Array.isArray(row.order) ? row.order[0] : row.order;
    const group = groups.get(row.client_id) ?? { name: order?.name ?? "Клієнт", email: order?.email ?? "—", projects: [] };
    group.projects.push({ id: row.id, title: row.title });
    groups.set(row.client_id, group);
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Співпраця" title="Клієнти" />
      {groups.size === 0 ? (
        <Panel>
          <p className="text-muted">Клієнтів у кабінеті ще немає.</p>
        </Panel>
      ) : (
        <ul className="grid gap-3">
          {[...groups.entries()].map(([id, group]) => (
            <li key={id} className="rounded-2xl border border-line bg-surface/70 p-4">
              <p className="font-medium">{group.name}</p>
              <p className="text-sm text-muted">{group.email}</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {group.projects.map((project) => (
                  <li key={project.id}>
                    <Link prefetch={false} href={`/admin/projects/${project.id}`} className="rounded-full border border-line px-3 py-1 font-mono text-xs hover:border-accent-soft">
                      {project.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
