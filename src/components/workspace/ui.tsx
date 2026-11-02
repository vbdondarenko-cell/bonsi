import type { ReactNode } from "react";
import { PROJECT_STATUS_LABELS, STAGES, STAGE_LABELS, stageProgress, type StageRow } from "@/lib/client/labels";
import { cn } from "@/lib/cn";

const dateTime = new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Kyiv" });
export const formatWhen = (value: string) => dateTime.format(new Date(value));

export function Card({ title, children, className, id }: { title?: string; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("rounded-[var(--radius-card)] border border-line bg-surface/70 p-5 sm:p-6", className)}>
      {title ? <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Pill({ tone, children }: { tone: "accent" | "ok" | "warn" | "muted" | "danger"; children: ReactNode }) {
  const tones = {
    accent: "border-accent-soft/50 bg-accent/15 text-accent-soft",
    ok: "border-ok/40 bg-ok/10 text-ok",
    warn: "border-[#e0b054]/40 bg-[#e0b054]/10 text-[#e0b054]",
    muted: "border-line bg-surface-2 text-muted",
    danger: "border-danger/40 bg-danger/10 text-danger",
  } as const;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium", tones[tone])}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function ProjectStatusPill({ status }: { status: string }) {
  const tone = status === "active" ? "accent" : status === "completed" ? "ok" : status === "cancelled" ? "danger" : "warn";
  return <Pill tone={tone}>{PROJECT_STATUS_LABELS[status] ?? status}</Pill>;
}

/** Шкала етапів: стан береться з project_stages (реально завершені етапи), а не з відсотків. */
export function StageTimeline({ rows }: { rows: StageRow[] }) {
  const progress = stageProgress(rows);
  const byStage = new Map(rows.map((row) => [row.stage, row.state]));
  return (
    <div>
      <p className="mb-4 text-sm text-muted" aria-live="polite">
        Завершено етапів: <strong className="text-fg">{progress.done}</strong> з {progress.total}
      </p>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Етапи проєкту">
        {STAGES.map((stage, index) => {
          const state = byStage.get(stage) ?? "pending";
          return (
            <li
              key={stage}
              aria-current={state === "in_progress" ? "step" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm",
                state === "done" && "border-ok/40 bg-ok/10",
                state === "in_progress" && "border-accent-soft bg-accent/15",
                state === "pending" && "border-line text-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border font-mono text-xs",
                  state === "done" && "border-ok text-ok",
                  state === "in_progress" && "border-accent-soft text-accent-soft",
                  state === "pending" && "border-line",
                )}
              >
                {state === "done" ? "✓" : index + 1}
              </span>
              <span>
                <span className="block font-medium text-fg">{STAGE_LABELS[stage]}</span>
                <span className="block text-xs text-muted">{state === "done" ? "Завершено" : state === "in_progress" ? "Поточний етап" : "Попереду"}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
