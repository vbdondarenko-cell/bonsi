import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CloseTicketButton, TicketReplyForm } from "@/components/workspace/support-forms";
import { Card, Pill, formatWhen } from "@/components/workspace/ui";
import { PageHeader } from "@/components/admin/ui";
import { requireClient } from "@/lib/client/auth";
import { getTicket } from "@/lib/client/data";
import { TICKET_CATEGORY_LABELS, TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Звернення" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireClient();
  const data = await getTicket(supabase, id);
  if (!data) notFound();
  const { ticket, messages } = data;
  return (
    <div className="flex flex-col gap-6">
      <Link prefetch={false} href="/app/support" className="text-sm text-muted hover:text-fg">
        ← Усі звернення
      </Link>
      <PageHeader eyebrow={ticket.number} title={ticket.subject}>
        <Pill tone={ticket.status === "closed" || ticket.status === "resolved" ? "ok" : "muted"}>{TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}</Pill>
      </PageHeader>
      <Card title="Звернення">
        <p className="text-sm text-muted">
          {TICKET_CATEGORY_LABELS[ticket.category] ?? ticket.category} · пріоритет: {TICKET_PRIORITY_LABELS[ticket.priority] ?? ticket.priority} · {formatWhen(ticket.created_at)}
        </p>
        <p className="mt-3 whitespace-pre-wrap">{ticket.description}</p>
        {ticket.result ? (
          <p className="mt-4 rounded-xl border border-ok/40 bg-ok/10 p-3 text-sm">
            <strong>Результат:</strong> {ticket.result}
          </p>
        ) : null}
      </Card>
      <Card title="Листування">
        {messages.length === 0 ? (
          <p className="text-muted">Відповідей ще немає.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((m) => (
              <li key={m.id} className="rounded-xl border border-line p-4">
                <p className="text-xs text-muted">
                  {m.author_role === "admin" ? "Студія" : "Ви"} · {formatWhen(m.created_at)}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
      {ticket.status === "closed" ? (
        <p className="text-sm text-muted">Звернення закрито. Якщо проблема повторилась — створіть нове.</p>
      ) : (
        <Card title="Відповісти">
          <TicketReplyForm ticketId={ticket.id} />
          {ticket.status === "resolved" ? (
            <div className="mt-4">
              <CloseTicketButton ticketId={ticket.id} />
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}
