import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, Pill, formatWhen } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { getRequests } from "@/lib/client/data";
import { ORDER_STATUS_LABELS, STAGE_LABELS, type Stage } from "@/lib/client/labels";
import { services } from "@/lib/services";

export const metadata: Metadata = { title: "Мої заявки" };

export default async function RequestsPage() {
  const { supabase } = await requireClient();
  const requests = await getRequests(supabase);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Кабінет" title="Мої заявки" />
      {requests.length === 0 ? (
        <EmptyState
          title="Заявок поки немає"
          description="Заявки зʼявляються тут, коли студія отримує їх з вашою поштою. Якщо ви надсилали заявку з іншої адреси — увійдіть саме з нею."
          action={<ButtonLink href="/contact">Надіслати заявку</ButtonLink>}
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {requests.map((request) => {
            const rejected = request.order_status === "rejected";
            return (
              <li key={request.order_id}>
                <Card>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-sm">{request.ticket}</span>
                    <span className="text-muted">{services.find((s) => s.id === request.service)?.title ?? request.service}</span>
                    <Pill tone={rejected ? "danger" : request.activated ? "ok" : "accent"}>{request.activated ? "Проєкт активний" : (ORDER_STATUS_LABELS[request.order_status] ?? request.order_status)}</Pill>
                    <span className="ml-auto text-xs text-muted">{formatWhen(request.created_at)}</span>
                  </div>
                  {rejected && request.rejection_reason ? (
                    <p className="mt-4 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm">
                      <span className="block text-xs uppercase tracking-wider text-muted">Причина відхилення</span>
                      {request.rejection_reason}
                    </p>
                  ) : null}
                  {!rejected && request.next_action ? (
                    <p className={request.next_action_owner === "client" ? "mt-4 rounded-xl border border-accent-soft/50 bg-accent/10 p-3 text-sm" : "mt-4 text-sm text-muted"}>
                      <span className="block text-xs uppercase tracking-wider text-muted">{request.next_action_owner === "client" ? "Потрібна ваша дія" : "Наразі діє студія"}</span>
                      {request.next_action}
                    </p>
                  ) : null}
                  {!request.activated && !rejected ? (
                    <p className="mt-3 text-xs text-muted">
                      Це заявка, а не активний проєкт. Проєкт запускається після погодження пропозиції, договору та передоплати (якщо вона передбачена).
                      {request.stage ? ` Підготовка: ${STAGE_LABELS[request.stage as Stage] ?? request.stage}.` : ""}
                    </p>
                  ) : null}
                  {request.project_id ? (
                    <p className="mt-4">
                      <Link prefetch={false} href={`/app/projects/${request.project_id}`} className="text-sm text-accent-soft underline underline-offset-4">
                        {request.activated ? "Відкрити проєкт" : "Обговорення, пропозиція й документи"}
                      </Link>
                    </p>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
