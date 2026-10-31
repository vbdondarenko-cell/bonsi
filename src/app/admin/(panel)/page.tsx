import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel, StatusBadge, formatDateTime } from "@/components/admin/ui";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/admin/orders";
import { requireAdmin } from "@/lib/admin/guard";
import { services } from "@/lib/services";

export const metadata: Metadata = { title: "Огляд" };

const cards: Array<{ status: OrderStatus; label: string }> = [
  { status: "new", label: "Нові заявки" },
  { status: "in_review", label: "У розгляді" },
  { status: "accepted", label: "Прийняті замовлення" },
  { status: "in_progress", label: "Активні проєкти" },
  { status: "done", label: "Завершені" },
];

export default async function DashboardPage() {
  const { supabase } = await requireAdmin();

  const [stats, recent] = await Promise.all([
    supabase.rpc("admin_dashboard_stats"),
    supabase.rpc("admin_search_orders", { p_limit: 5, p_offset: 0 }),
  ]);

  if (stats.error || recent.error) {
    return (
      <>
        <PageHeader eyebrow="Огляд" title="Стан заявок" />
        <div role="alert" className="mt-10 rounded-2xl border border-danger/40 bg-danger/10 p-6">
          <p className="font-medium">Не вдалося завантажити дані.</p>
          <p className="mt-2 text-sm text-muted">Оновіть сторінку. Якщо помилка повторюється, перевірте підключення до бази.</p>
        </div>
      </>
    );
  }

  const counts = new Map<string, number>((stats.data ?? []).map((row: { status: string; total: number }) => [row.status, Number(row.total)]));
  const total = ORDER_STATUSES.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0);
  const rejected = counts.get("rejected") ?? 0;
  const rows = (recent.data ?? []) as Array<{
    id: string; ticket_number: string; service: string; name: string; status: string; created_at: string;
  }>;
  const serviceTitle = (id: string) => services.find((s) => s.id === id)?.title ?? id;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader eyebrow="Огляд" title="Стан заявок">
        <ButtonLink href="/admin/orders" variant="ghost">
          Усі заявки
        </ButtonLink>
      </PageHeader>

      {total === 0 ? (
        <EmptyState
          title="Заявок поки немає"
          description="Щойно клієнт надішле форму на сайті, заявка зʼявиться тут. Показники рахуються з реальних даних, без прикладів."
        />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Показники за статусами">
            {cards.map((card) => (
              <li key={card.status}>
                <Link prefetch={false}
                  href={`/admin/orders?status=${card.status}`}
                  className="group flex h-full flex-col justify-between gap-6 rounded-[var(--radius-card)] border border-line bg-surface/70 p-5 transition-colors hover:border-accent-soft/70"
                >
                  <span className="text-sm text-muted">{card.label}</span>
                  <span className="text-4xl font-semibold tabular-nums tracking-tight group-hover:text-accent-soft">
                    {counts.get(card.status) ?? 0}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="-mt-6 text-sm text-muted">
            Усього заявок: {total}. Відхилено: {rejected}.
          </p>

          <Panel title="Останні заявки">
            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link prefetch={false}
                    href={`/admin/orders/${row.id}`}
                    className="flex flex-col gap-2 py-4 transition-colors hover:text-accent-soft sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="flex flex-col">
                      <span className="font-mono text-sm">{row.ticket_number}</span>
                      <span className="text-sm text-muted">
                        {row.name} · {serviceTitle(row.service)}
                      </span>
                    </span>
                    <span className="flex items-center gap-4">
                      <span className="text-sm text-muted">{formatDateTime(row.created_at)}</span>
                      <StatusBadge status={row.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}
