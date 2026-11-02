import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { DeliverableDecision } from "@/components/workspace/deliverable-decision";
import { FileList } from "@/components/workspace/file-list";
import { Card, Pill, StageTimeline, formatWhen } from "@/components/workspace/ui";
import { requireClient } from "@/lib/client/auth";
import { getDeliverableDecisions, getDeliverables, getFiles, getProject, getProposals, getStages, type DeliverableRow } from "@/lib/client/data";
import { DELIVERABLE_STATUS_LABELS, STAGE_LABELS, type Stage } from "@/lib/client/labels";

export const metadata: Metadata = { title: "Етапи й погодження" };

function tone(status: string) {
  return status === "approved" ? "ok" : status === "submitted" ? "accent" : status === "changes_requested" ? "warn" : "muted";
}

function safePreview(url: string | null) {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export default async function MilestonesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireClient();
  const project = await getProject(supabase, id);
  if (!project) notFound();
  const [stages, deliverables, decisions, files, proposals] = await Promise.all([
    getStages(supabase, id),
    getDeliverables(supabase, id),
    getDeliverableDecisions(supabase, id),
    getFiles(supabase, id),
    getProposals(supabase, id),
  ]);

  // Правки: скільки разів клієнт просив змін щодо включеної у погоджену пропозицію кількості.
  const approved = proposals.find((proposal) => proposal.status === "approved");
  const used = decisions.filter((decision) => decision.decision === "changes_requested").length;

  const byStage = new Map<string, DeliverableRow[]>();
  for (const item of deliverables) byStage.set(item.stage, [...(byStage.get(item.stage) ?? []), item]);

  return (
    <div className="flex flex-col gap-6">
      <Card title="Шкала етапів">
        <StageTimeline rows={stages} />
      </Card>
      {approved ? (
        <p className="text-sm text-muted">
          Запитів на правки використано: <strong className="text-fg">{used}</strong> з {approved.included_revisions}, включених у погоджену пропозицію.
        </p>
      ) : null}

      {deliverables.length === 0 ? (
        <EmptyState title="Результатів на погодження поки немає" description="Коли студія завершить етап (дизайн, розробку, тестування чи передачу), результат зʼявиться тут: його можна переглянути, погодити або попросити правок." />
      ) : (
        [...byStage.entries()].map(([stage, items]) => {
          const [latest, ...older] = items;
          return (
            <Card key={stage} title={`${STAGE_LABELS[stage as Stage] ?? stage}`}>
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-lg font-semibold">
                    Версія {latest!.version}: {latest!.title}
                  </h3>
                  <Pill tone={tone(latest!.status)}>{DELIVERABLE_STATUS_LABELS[latest!.status] ?? latest!.status}</Pill>
                </div>
                {latest!.description ? <p className="whitespace-pre-wrap leading-relaxed">{latest!.description}</p> : null}
                {safePreview(latest!.preview_url) ? (
                  <p>
                    <a href={safePreview(latest!.preview_url)!} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-soft underline underline-offset-4">
                      Відкрити прев’ю ↗
                    </a>
                  </p>
                ) : null}
                <FileList files={files.filter((file) => file.deliverable_id === latest!.id)} projectId={id} canDeleteOwn={false} />
                {latest!.status === "submitted" ? (
                  <div className="border-t border-line pt-5">
                    <DeliverableDecision deliverableId={latest!.id} projectId={id} version={latest!.version} />
                  </div>
                ) : null}
                {older.length > 0 ? (
                  <details className="rounded-xl border border-line p-4">
                    <summary className="cursor-pointer text-sm font-medium">Попередні версії ({older.length})</summary>
                    <ul className="mt-4 flex flex-col gap-3 text-sm">
                      {older.map((item) => (
                        <li key={item.id}>
                          Версія {item.version}: {item.title} · <span className="text-muted">{DELIVERABLE_STATUS_LABELS[item.status] ?? item.status}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            </Card>
          );
        })
      )}

      {decisions.length > 0 ? (
        <Card title="Історія рішень">
          <ol className="flex flex-col gap-3">
            {decisions.map((decision) => (
              <li key={decision.id} className="border-l-2 border-line pl-4 text-sm">
                <strong>{decision.decision === "approved" ? "Погоджено" : "Запитано правки"}</strong> · {STAGE_LABELS[decision.stage as Stage] ?? decision.stage}, версія {decision.version} ·{" "}
                <time dateTime={decision.created_at}>{formatWhen(decision.created_at)}</time>
                {decision.comment ? <p className="mt-1 text-muted">«{decision.comment}»</p> : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </div>
  );
}
