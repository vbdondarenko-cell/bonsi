import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssignForm, NoteForm, StatusForm } from "@/components/admin/order-forms";
import { PageHeader, Panel, StatusBadge, formatDateTime } from "@/components/admin/ui";
import { STATUS_LABELS, uuidSchema, type OrderStatus } from "@/lib/admin/orders";
import { requireAdmin } from "@/lib/admin/guard";
import { BUDGET_LABELS, DEADLINE_LABELS, type BudgetId, type DeadlineId } from "@/lib/orders/options";
import { services } from "@/lib/services";

export const metadata: Metadata = { title: "Заявка" };

type EventRow = { id: number; actor_id: string | null; type: string; data: Record<string, string | null>; created_at: string };

export default async function OrderDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();

  const { supabase } = await requireAdmin();
  const [order, notes, events, admins] = await Promise.all([
    supabase
      .from("orders")
      .select("id, ticket_number, service, idea, budget, deadline, name, email, phone, status, assigned_to, consent_at, consent_policy_version, created_at, updated_at")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("order_notes").select("id, author_id, body, created_at").eq("order_id", id).order("created_at", { ascending: false }),
    supabase.from("order_events").select("id, actor_id, type, data, created_at").eq("order_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }),
    supabase.from("admin_users").select("user_id, display_name").eq("active", true),
  ]);

  if (order.error) {
    return (
      <div role="alert" className="rounded-2xl border border-danger/40 bg-danger/10 p-6">
        <p className="font-medium">Не вдалося завантажити заявку.</p>
        <Link href="/admin/orders" className="mt-3 inline-block text-sm text-accent-soft underline">До списку</Link>
      </div>
    );
  }
  if (!order.data) notFound();

  const o = order.data;
  const adminList = (admins.data ?? []) as Array<{ user_id: string; display_name: string }>;
  const names = new Map(adminList.map((a) => [a.user_id, a.display_name]));
  const who = (userId: string | null) => (userId ? names.get(userId) ?? "Адміністратор" : "Система");
  const serviceTitle = services.find((s) => s.id === o.service)?.title ?? o.service;
  const label = (value: unknown) =>
    typeof value === "string" ? STATUS_LABELS[value as OrderStatus] ?? value : "—";

  const describe = (event: EventRow) => {
    switch (event.type) {
      case "created":
        return "Заявку створено з форми на сайті";
      case "status_changed":
        return `Статус: ${label(event.data.from)} → ${label(event.data.to)}`;
      case "assigned":
        return event.data.to ? `Призначено: ${who(event.data.to)}` : "Виконавця знято";
      case "note_added":
        return "Додано нотатку";
      default:
        return event.type;
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <Link href="/admin/orders" className="text-sm text-muted hover:text-fg">
        ← Усі заявки
      </Link>
      <PageHeader eyebrow={o.ticket_number as string} title={o.name as string}>
        <StatusBadge status={o.status as string} />
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <Panel title="Деталі заявки">
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <Item label="Послуга" value={serviceTitle} />
              <Item label="Бюджет" value={BUDGET_LABELS[o.budget as BudgetId] ?? (o.budget as string)} />
              <Item label="Терміни" value={DEADLINE_LABELS[o.deadline as DeadlineId] ?? (o.deadline as string)} />
              <Item label="Створено" value={formatDateTime(o.created_at as string)} />
              <Item label="Email" value={<a className="break-all text-accent-soft underline-offset-4 hover:underline" href={`mailto:${o.email}`}>{o.email as string}</a>} />
              <Item label="Телефон" value={(o.phone as string | null) ?? "—"} />
            </dl>
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="text-xs uppercase tracking-wider text-muted">Опис ідеї</h3>
              <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{o.idea as string}</p>
            </div>
            <p className="mt-5 text-xs text-muted">
              Згода на обробку даних: {formatDateTime(o.consent_at as string)} (політика {o.consent_policy_version as string})
            </p>
          </Panel>

          <Panel title="Нотатки">
            <NoteForm orderId={id} />
            <ul className="mt-6 flex flex-col gap-4">
              {(notes.data ?? []).length === 0 ? (
                <li className="text-sm text-muted">Нотаток ще немає.</li>
              ) : (
                (notes.data ?? []).map((note) => (
                  <li key={note.id as string} className="rounded-xl border border-line bg-surface-2/60 p-4">
                    <p className="whitespace-pre-wrap break-words">{note.body as string}</p>
                    <p className="mt-2 text-xs text-muted">
                      {who(note.author_id as string | null)} · {formatDateTime(note.created_at as string)}
                    </p>
                  </li>
                ))
              )}
            </ul>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Керування">
            <div className="flex flex-col gap-6">
              <StatusForm orderId={id} status={o.status as string} />
              <AssignForm orderId={id} assignee={o.assigned_to as string | null} admins={adminList} />
            </div>
          </Panel>

          <Panel title="Історія змін">
            <ol className="flex flex-col gap-4 border-l border-line pl-5">
              {((events.data ?? []) as EventRow[]).map((event) => (
                <li key={event.id} className="relative">
                  <span aria-hidden="true" className="absolute -left-[1.45rem] top-1.5 size-2 rounded-full bg-accent-soft" />
                  <p className="text-sm">{describe(event)}</p>
                  <p className="text-xs text-muted">
                    {who(event.actor_id)} · {formatDateTime(event.created_at)}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}
