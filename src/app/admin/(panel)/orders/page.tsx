import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, StatusBadge, adminFieldClass, formatDateTime } from "@/components/admin/ui";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonStyles } from "@/components/ui/button";
import {
  ORDER_STATUSES,
  PAGE_SIZE,
  STATUS_LABELS,
  filtersToQuery,
  parseOrderFilters,
  toSearchArgs,
} from "@/lib/admin/orders";
import { requireAdmin } from "@/lib/admin/guard";
import { services } from "@/lib/services";

export const metadata: Metadata = { title: "Заявки" };

type Row = {
  id: string; ticket_number: string; service: string; name: string; email: string;
  status: string; assigned_to: string | null; created_at: string; total_count: number;
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requireAdmin();
  const filters = parseOrderFilters(await searchParams);

  const [result, admins] = await Promise.all([
    supabase.rpc("admin_search_orders", toSearchArgs(filters)),
    supabase.from("admin_users").select("user_id, display_name"),
  ]);

  const hasFilters = Boolean(filters.q || filters.status || filters.service || filters.from || filters.to);
  const names = new Map<string, string>((admins.data ?? []).map((a) => [a.user_id as string, a.display_name as string]));
  const serviceTitle = (id: string) => services.find((s) => s.id === id)?.title ?? id;

  const outOfRange = !result.error && (result.data ?? []).length === 0 && filters.page > 1;

  if (result.error) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Заявки" title="Усі заявки" />
        <div role="alert" className="rounded-2xl border border-danger/40 bg-danger/10 p-6">
          <p className="font-medium">Не вдалося завантажити заявки.</p>
          <p className="mt-2 text-sm text-muted">Оновіть сторінку або спробуйте пізніше.</p>
        </div>
      </div>
    );
  }

  const rows = (result.data ?? []) as Row[];
  const total = rows[0] ? Number(rows[0].total_count) : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Заявки" title="Усі заявки" />

      <form method="get" className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface/70 p-4 sm:grid-cols-2 lg:grid-cols-6" role="search">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="q" className="text-xs text-muted">Номер, клієнт або email</label>
          <input id="q" name="q" defaultValue={filters.q ?? ""} maxLength={100} className={adminFieldClass} placeholder="BON-2026-…" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-xs text-muted">Статус</label>
          <select id="status" name="status" defaultValue={filters.status ?? ""} className={adminFieldClass}>
            <option value="">Усі</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="service" className="text-xs text-muted">Послуга</label>
          <select id="service" name="service" defaultValue={filters.service ?? ""} className={adminFieldClass}>
            <option value="">Усі</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="from" className="text-xs text-muted">Від дати</label>
          <input id="from" name="from" type="date" defaultValue={filters.from ?? ""} className={adminFieldClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="to" className="text-xs text-muted">До дати</label>
          <input id="to" name="to" type="date" defaultValue={filters.to ?? ""} className={adminFieldClass} />
        </div>
        <div className="flex gap-3 sm:col-span-2 lg:col-span-6">
          <button type="submit" className={buttonStyles("primary", "min-h-11")}>Застосувати</button>
          {hasFilters ? (
            <Link href="/admin/orders" className={buttonStyles("ghost", "min-h-11")}>Скинути</Link>
          ) : null}
        </div>
      </form>

      {outOfRange ? (
        <EmptyState
          title="Такої сторінки немає"
          description="У списку менше сторінок, ніж у посиланні. Поверніться до першої сторінки."
          action={<Link href={`/admin/orders${filtersToQuery(filters, { page: 1 })}`} className={buttonStyles("ghost", "min-h-11")}>На першу сторінку</Link>}
        />
      ) : rows.length === 0 ? (
        hasFilters ? (
          <EmptyState title="Нічого не знайдено" description="Змініть або скиньте фільтри — за цими умовами заявок немає." />
        ) : (
          <EmptyState title="Заявок поки немає" description="Нові заявки з форми на сайті зʼявляться тут автоматично." />
        )
      ) : (
        <>
          <p className="text-sm text-muted">Знайдено: {total}</p>
          <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">Список заявок</caption>
              <thead className="border-b border-line bg-surface text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Номер</th>
                  <th scope="col" className="px-4 py-3 font-medium">Клієнт</th>
                  <th scope="col" className="px-4 py-3 font-medium">Послуга</th>
                  <th scope="col" className="px-4 py-3 font-medium">Статус</th>
                  <th scope="col" className="px-4 py-3 font-medium">Виконавець</th>
                  <th scope="col" className="px-4 py-3 font-medium">Створено</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-surface/80">
                    <td className="px-4 py-3 font-mono">
                      <Link prefetch={false} href={`/admin/orders/${row.id}`} className="text-accent-soft underline-offset-4 hover:underline">
                        {row.ticket_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div>{row.name}</div>
                      <div className="text-xs text-muted">{row.email}</div>
                    </td>
                    <td className="px-4 py-3 text-muted">{serviceTitle(row.service)}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-3 text-muted">{row.assigned_to ? names.get(row.assigned_to) ?? "—" : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <Link prefetch={false} href={`/admin/orders/${row.id}`} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface/70 p-4 hover:border-accent-soft/70">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm">{row.ticket_number}</span>
                    <StatusBadge status={row.status} />
                  </span>
                  <span>
                    <span className="block">{row.name}</span>
                    <span className="block break-all text-xs text-muted">{row.email}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {serviceTitle(row.service)} · {formatDateTime(row.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {pages > 1 ? (
            <nav aria-label="Сторінки" className="flex items-center justify-between gap-4">
              {filters.page > 1 ? (
                <Link className={buttonStyles("ghost", "min-h-11")} href={`/admin/orders${filtersToQuery(filters, { page: filters.page - 1 })}`}>
                  ← Назад
                </Link>
              ) : <span />}
              <span className="text-sm text-muted">
                Сторінка {filters.page} з {pages}
              </span>
              {filters.page < pages ? (
                <Link className={buttonStyles("ghost", "min-h-11")} href={`/admin/orders${filtersToQuery(filters, { page: filters.page + 1 })}`}>
                  Далі →
                </Link>
              ) : <span />}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
