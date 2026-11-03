import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, StageTimeline, formatWhen } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { getActivation, getAssigneeName, getEvents, getProject, getStages } from "@/lib/client/data";
import { EVENT_LABELS, PROJECT_STATUS_LABELS, STAGE_LABELS, type Stage } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Проєкт" };

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) notFound();
  const [stages, events, assignee, activation] = await Promise.all([getStages(supabase, id), getEvents(supabase, id), getAssigneeName(supabase, id), project.activated_at ? Promise.resolve(null) : getActivation(supabase, id)]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        {!project.activated_at ? (
          <Card title="Це заявка, а не активний проєкт">
            <p className="text-sm text-muted">Робота (дизайн і розробка) починається після виконання умов. Чат, пропозиція й документи вже доступні.</p>
            <ul className="mt-4 flex flex-col gap-2 text-sm" aria-label="Умови активації проєкту">
              <Condition ok={activation?.proposal_approved} label="Комерційну пропозицію погоджено" />
              <Condition ok={activation?.contract_approved} label="Договір погоджено" />
              <Condition
                ok={activation ? !activation.prepayment_required || activation.prepayment_paid : undefined}
                label={activation?.prepayment_required ? "Передоплату отримано (підтверджено студією)" : "Передоплата: не передбачена"}
              />
            </ul>
          </Card>
        ) : null}
        <Card title="Наступна дія">
          {project.next_action ? (
            <p className="text-lg">
              <span className="mr-2 text-sm text-muted">{project.next_action_owner === "client" ? "Потрібна ваша дія:" : "Наразі діє студія:"}</span>
              {project.next_action}
            </p>
          ) : (
            <p className="text-muted">Зараз від вас нічого не потрібно.</p>
          )}
        </Card>
        <Card title="Етапи проєкту">
          <StageTimeline rows={stages} />
        </Card>
        <Card title="Історія подій">
          {events.length === 0 ? (
            <p className="text-muted">Подій ще немає.</p>
          ) : (
            <ol className="flex flex-col gap-4">
              {events.map((event) => {
                const to = typeof event.data.to === "string" ? event.data.to : null;
                const detail =
                  event.type === "stage_changed" && to
                    ? STAGE_LABELS[to as Stage]
                    : event.type === "status_changed" && to
                      ? PROJECT_STATUS_LABELS[to]
                      : null;
                return (
                  <li key={event.id} className="flex flex-col gap-1 border-l-2 border-line pl-4">
                    <span>
                      {EVENT_LABELS[event.type] ?? "Оновлення проєкту"}
                      {detail ? <strong>: {detail}</strong> : null}
                      {typeof event.data.version === "number" ? ` (версія ${event.data.version})` : null}
                      {typeof event.data.number === "string" ? ` · ${event.data.number}` : null}
                      {typeof event.data.name === "string" ? ` · ${event.data.name}` : null}
                    </span>
                    <time dateTime={event.created_at} className="text-xs text-muted">
                      {formatWhen(event.created_at)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
      <div className="flex flex-col gap-6">
        <Card title="Деталі">
          <dl className="grid gap-4 text-sm">
            <div>
              <dt className="text-muted">Статус проєкту</dt>
              <dd className="mt-1">{PROJECT_STATUS_LABELS[project.status] ?? project.status}</dd>
            </div>
            <div>
              <dt className="text-muted">Поточний етап</dt>
              <dd className="mt-1">{STAGE_LABELS[project.stage as Stage] ?? project.stage}</dd>
            </div>
            <div>
              <dt className="text-muted">Виконавець</dt>
              <dd className="mt-1">{assignee ?? "Буде призначено студією"}</dd>
            </div>
            <div>
              <dt className="text-muted">Створено</dt>
              <dd className="mt-1">{formatWhen(project.created_at)}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Condition({ ok, label }: { ok: boolean | undefined; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden="true" className={ok ? "text-ok" : "text-muted"}>{ok ? "✓" : "○"}</span>
      <span className={ok ? "" : "text-muted"}>{label}</span>
      <span className="sr-only">{ok ? "виконано" : "не виконано"}</span>
    </li>
  );
}
