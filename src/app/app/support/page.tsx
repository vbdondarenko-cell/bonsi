import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { CreateTicketForm } from "@/components/workspace/support-forms";
import { Card, Pill, formatWhen } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { getTickets, listProjects } from "@/lib/client/data";
import { TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Підтримка" };

export default async function SupportPage() {
  const { supabase } = await requireClient();
  const [projects, tickets] = await Promise.all([listProjects(supabase), getTickets(supabase)]);
  // Звернення доступні лише для активованих проєктів (заявка без активації — ще не проєкт); сервер перевіряє це повторно.
  const eligible = projects.filter((p) => p.activated_at && (p.status === "active" || p.status === "completed"));
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Кабінет" title="Підтримка" />
      <Card title="Нове звернення">
        {eligible.length === 0 ? (
          <p className="text-muted">
            Звернення створюються для активних і завершених проєктів. Питання до початку роботи можна поставити в чаті проєкту або через{" "}
            <Link prefetch={false} href="/contact" className="text-accent-soft underline underline-offset-4">
              форму заявки
            </Link>
            .
          </p>
        ) : (
          <CreateTicketForm projects={eligible.map((p) => ({ id: p.id, title: p.title }))} />
        )}
      </Card>
      <Card title="Мої звернення">
        {tickets.length === 0 ? (
          <p className="text-muted">Звернень ще немає.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {tickets.map((t) => (
              <li key={t.id} className="rounded-xl border border-line p-4">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted">{t.number}</span>
                  <Link prefetch={false} href={`/app/support/${t.id}`} className="font-semibold underline-offset-4 hover:underline">
                    {t.subject}
                  </Link>
                  <Pill tone={t.status === "closed" || t.status === "resolved" ? "ok" : t.status === "waiting_client" ? "warn" : "muted"}>{TICKET_STATUS_LABELS[t.status] ?? t.status}</Pill>
                </p>
                <p className="mt-1 text-xs text-muted">
                  {TICKET_CATEGORY_LABELS[t.category] ?? t.category} · оновлено {formatWhen(t.updated_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
