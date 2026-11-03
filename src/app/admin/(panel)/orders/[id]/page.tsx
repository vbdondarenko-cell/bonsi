import type { OrderSnapshot } from "@/lib/admin/order-snapshot";
import { OrderStateProvider, OrderStatusBadge, OrderHistory, OrderNotes } from "@/components/admin/order-state";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssignForm, NoteForm, StatusForm } from "@/components/admin/order-forms";
import { PageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { uuidSchema } from "@/lib/admin/orders";
import { requireAdmin } from "@/lib/admin/guard";
import { BUDGET_LABELS, DEADLINE_LABELS, SERVICE_QUESTIONS, isServiceId, type BudgetId, type DeadlineId } from "@/lib/orders/options";
import { InviteClientForm } from "@/components/admin/project-forms";
import { services } from "@/lib/services";

export const metadata: Metadata = { title: "Заявка" };

export const dynamic = "force-dynamic";

export default async function OrderDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();

  const { supabase } = await requireAdmin();
  const [order, admins, project] = await Promise.all([
    supabase
      .from("orders")
      .select("id, ticket_number, service, idea, budget, deadline, details, links, client_id, name, email, phone, status, assigned_to, consent_at, consent_policy_version, created_at, updated_at, order_events(id, actor_id, type, data, created_at), order_notes(id, author_id, body, created_at)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("admin_users").select("user_id, display_name").eq("active", true),
    supabase.from("projects").select("id").eq("order_id", id).maybeSingle(),
  ]);

  if (order.error || admins.error) {
    return (
      <div role="alert" className="rounded-2xl border border-danger/40 bg-danger/10 p-6">
        <p className="font-medium">Не вдалося завантажити заявку.</p>
        <Link prefetch={false} href="/admin/orders" className="mt-3 inline-block text-sm text-accent-soft underline">До списку</Link>
      </div>
    );
  }
  if (!order.data) notFound();

  const o = order.data;
  const adminList = (admins.data ?? []) as Array<{ user_id: string; display_name: string }>;
  const serviceTitle = services.find((s) => s.id === o.service)?.title ?? o.service;
  const details = (o.details ?? {}) as Record<string, string>;
  const links = ((o.links ?? []) as string[]).filter((link) => /^https?:\/\//i.test(link));
  const questions = isServiceId(o.service as string) ? SERVICE_QUESTIONS[o.service as keyof typeof SERVICE_QUESTIONS] : [];
  const answers = questions.flatMap((question) => {
    const option = question.options.find((item) => item.id === details[question.id]);
    return option ? [{ label: question.label, value: option.label }] : [];
  });

  return (
    <OrderStateProvider key={id} initial={{ id, status: o.status, assigned_to: o.assigned_to, order_events: o.order_events, order_notes: o.order_notes } as OrderSnapshot} admins={adminList}>
    <div className="flex flex-col gap-8">
      <Link prefetch={false} href="/admin/orders" className="text-sm text-muted hover:text-fg">
        ← Усі заявки
      </Link>
      <PageHeader eyebrow={o.ticket_number as string} title={o.name as string}>
        <OrderStatusBadge />
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <Panel title="Деталі заявки">
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <Item label="Послуга" value={serviceTitle} />
              <Item label="Бюджет" value={o.budget ? BUDGET_LABELS[o.budget as BudgetId] ?? (o.budget as string) : "Не вказано"} />
              <Item label="Терміни" value={o.deadline ? DEADLINE_LABELS[o.deadline as DeadlineId] ?? (o.deadline as string) : "Не вказано"} />
              <Item label="Створено" value={formatDateTime(o.created_at as string)} />
              <Item label="Email" value={<a className="break-all text-accent-soft underline-offset-4 hover:underline" href={`mailto:${o.email}`}>{o.email as string}</a>} />
              <Item label="Телефон" value={(o.phone as string | null) ?? "—"} />
            </dl>
            {answers.length > 0 ? (
              <dl className="mt-6 grid gap-x-8 gap-y-5 border-t border-line pt-5 sm:grid-cols-2">
                {answers.map((answer) => (
                  <Item key={answer.label} label={answer.label} value={answer.value} />
                ))}
              </dl>
            ) : null}
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="text-xs uppercase tracking-wider text-muted">Опис</h3>
              <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{(o.idea as string | null) || "Клієнт не залишив опису."}</p>
            </div>
            {links.length > 0 ? (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="text-xs uppercase tracking-wider text-muted">Посилання на приклади</h3>
                <ul className="mt-2 flex flex-col gap-1">
                  {links.map((link) => (
                    <li key={link}>
                      <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent-soft underline-offset-4 hover:underline">
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="mt-5 text-xs text-muted">
              Згода на обробку даних: {formatDateTime(o.consent_at as string)} (політика {o.consent_policy_version as string})
            </p>
          </Panel>

          <Panel title="Нотатки">
            <NoteForm orderId={id} />
            <OrderNotes />
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Керування">
            <div className="flex flex-col gap-6">
              <StatusForm orderId={id} />
              <AssignForm orderId={id} admins={adminList} />
            </div>
          </Panel>

          <Panel title="Кабінет клієнта">
            {project.data ? (
              <Link prefetch={false} href={`/admin/projects/${project.data.id as string}`} className="text-accent-soft underline underline-offset-4">
                Відкрити проєкт клієнта
              </Link>
            ) : (
              <InviteClientForm orderId={id} />
            )}
          </Panel>

          <Panel title="Історія змін">
            <OrderHistory />
          </Panel>
        </div>
      </div>
    </div>
    </OrderStateProvider>
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
