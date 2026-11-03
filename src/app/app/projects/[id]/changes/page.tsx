import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitChangeForm, WithdrawChangeButton } from "@/components/workspace/change-forms";
import { Card, Pill, formatWhen } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { getChangeRequests, getProject, getScope } from "@/lib/client/data";
import { CHANGE_STATUS_LABELS, formatMoney } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Зміни замовлення" };

export default async function ChangesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) notFound();
  const [changes, scope] = await Promise.all([getChangeRequests(supabase, id), getScope(supabase, id)]);
  const active = Boolean(project.activated_at) && project.status === "active";

  return (
    <div className="flex flex-col gap-6">
      <Card title="Обсяг робіт (Scope of Work)">
        {scope.length === 0 ? (
          <p className="text-muted">Базовий обсяг фіксується в момент активації проєкту (після погодження пропозиції, договору й передоплати).</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {scope.map((row) => (
              <li key={row.id} className="rounded-xl border border-line p-4">
                <p className="flex flex-wrap items-center gap-2">
                  <Pill tone={row.kind === "baseline" ? "accent" : "ok"}>{row.kind === "baseline" ? "Базовий обсяг" : "Погоджена зміна"}</Pill>
                  <strong>{row.title}</strong>
                </p>
                {row.kind === "baseline" && row.items.length > 0 ? (
                  <ul className="mt-2 ml-5 list-disc text-sm text-muted">
                    {row.items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-2 text-xs text-muted">
                  {row.price_amount && row.currency ? `${formatMoney(row.price_amount, row.currency)} · ` : ""}
                  {row.duration_days ? `${row.duration_days} дн. · ` : ""}
                  {formatWhen(row.created_at)}
                </p>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 text-xs text-muted">Базовий обсяг не змінюється. Нові вимоги потрапляють у роботу лише як окремо погоджені зміни з оцінкою вартості й термінів.</p>
      </Card>

      <Card title="Запитати зміну">
        {active ? (
          <SubmitChangeForm projectId={id} />
        ) : (
          <p className="text-muted">Запити на зміни доступні після активації проєкту. До того обсяг можна обговорити в чаті й у пропозиції.</p>
        )}
      </Card>

      <Card title="Мої запити на зміни">
        {changes.length === 0 ? (
          <p className="text-muted">Запитів на зміни ще немає.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {changes.map((change) => (
              <li key={change.id} className="rounded-xl border border-line p-4">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted">{change.number}</span>
                  <strong>{change.title}</strong>
                  <Pill tone={change.status === "rejected" || change.status === "withdrawn" ? "danger" : change.status === "quoted" ? "warn" : change.status === "submitted" ? "muted" : "ok"}>
                    {CHANGE_STATUS_LABELS[change.status] ?? change.status}
                  </Pill>
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{change.description}</p>
                {change.quote_price && change.quote_currency ? (
                  <p className="mt-3 text-sm">
                    Оцінка студії: <strong>{formatMoney(change.quote_price, change.quote_currency)}</strong>
                    {change.quote_days ? `, додатково ${change.quote_days} дн.` : ""}
                    {change.quote_document_id ? (
                      <>
                        {" · "}
                        <Link prefetch={false} href={`/app/projects/${id}/documents/${change.quote_document_id}`} className="text-accent-soft underline underline-offset-4">
                          Додаткова угода
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}
                {change.rejection_reason ? <p className="mt-2 text-sm text-muted">Причина: {change.rejection_reason}</p> : null}
                {change.status === "submitted" || change.status === "quoted" ? (
                  <div className="mt-3">
                    <WithdrawChangeButton changeId={change.id} projectId={id} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
