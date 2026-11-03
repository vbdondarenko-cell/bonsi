import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminTicketReplyForm, TicketToChangeForm, TicketUpdateForm } from "@/components/admin/delivery-forms";
import { PageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { Pill } from "@/components/workspace/ui";
import { requireAdmin } from "@/lib/admin/guard";
import { uuidSchema } from "@/lib/admin/orders";
import { TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Звернення" };

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase } = await requireAdmin();
  const [ticket, messages, admins] = await Promise.all([
    supabase.from("support_tickets").select("*, projects(id,title)").eq("id", id).maybeSingle(),
    supabase.from("support_messages").select("id,author_role,body,internal,created_at").eq("ticket_id", id).order("id"),
    supabase.from("admin_users").select("user_id,display_name").eq("active", true),
  ]);
  if (ticket.error) return <p role="alert" className="text-danger">Не вдалося завантажити звернення.</p>;
  if (!ticket.data) notFound();
  const t = ticket.data as unknown as { id: string; number: string; subject: string; description: string; category: string; priority: string; status: string; assignee_id: string | null; result: string | null; change_request_id: string | null; updated_at: string; projects: { id: string; title: string } | null };
  const msgs = (messages.data ?? []) as Array<{ id: number; author_role: string; body: string; internal: boolean; created_at: string }>;
  const adminOpts = (admins.data ?? []).map((a) => ({ id: a.user_id as string, label: a.display_name as string }));

  return (
    <div className="flex flex-col gap-8">
      <Link prefetch={false} href="/admin/support" className="text-sm text-muted hover:text-fg">← Усі звернення</Link>
      <PageHeader eyebrow={t.number} title={t.subject}>
        <Pill tone="muted">{TICKET_STATUS_LABELS[t.status] ?? t.status}</Pill>
      </PageHeader>
      <Panel title="Звернення">
        <p className="text-sm text-muted">
          {t.projects ? <Link prefetch={false} href={`/admin/projects/${t.projects.id}`} className="underline underline-offset-4">{t.projects.title}</Link> : "—"} · {TICKET_CATEGORY_LABELS[t.category] ?? t.category}
        </p>
        <p className="mt-3 whitespace-pre-wrap">{t.description}</p>
      </Panel>
      <Panel title="Керування">
        <TicketUpdateForm ticket={t} admins={adminOpts} />
        {t.category === "paid_work" || t.category === "post_update" ? (
          <div className="mt-4 border-t border-line pt-4">
            {t.change_request_id ? (
              <p className="text-sm text-muted">Вже оформлено як запит на зміну.</p>
            ) : (
              <TicketToChangeForm ticketId={t.id} />
            )}
          </div>
        ) : null}
      </Panel>
      <Panel title="Листування">
        <ol className="mb-4 flex flex-col gap-3">
          {msgs.length === 0 ? <li className="text-muted">Повідомлень ще немає.</li> : null}
          {msgs.map((m) => (
            <li key={m.id} className={`rounded-xl border p-4 ${m.internal ? "border-[#e0b054]/40 bg-[#e0b054]/10" : "border-line"}`}>
              <p className="text-xs text-muted">
                {m.internal ? "Внутрішня нотатка" : m.author_role === "admin" ? "Студія" : "Клієнт"} · {formatDateTime(m.created_at)}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
            </li>
          ))}
        </ol>
        <AdminTicketReplyForm ticketId={t.id} />
      </Panel>
    </div>
  );
}
