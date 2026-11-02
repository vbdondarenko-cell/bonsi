import Link from "next/link";
import { STAGE_LABELS, type Stage } from "@/lib/client/labels";
import type { ProjectRow } from "@/lib/client/data";
import { Pill, ProjectStatusPill } from "./ui";

export function ProjectCard({ project, unread }: { project: ProjectRow; unread: number }) {
  const waitingForClient = project.next_action_owner === "client";
  return (
    <li>
      <Link
        prefetch={false}
        href={`/app/projects/${project.id}`}
        className="flex h-full flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface/70 p-5 transition-colors hover:border-accent-soft sm:p-6"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted">{project.title}</span>
          <ProjectStatusPill status={project.status} />
          {unread > 0 ? <Pill tone="accent">Нових повідомлень: {unread}</Pill> : null}
        </div>
        <p className="text-sm text-muted">
          Етап: <span className="text-fg">{STAGE_LABELS[project.stage as Stage] ?? project.stage}</span>
        </p>
        {project.next_action ? (
          <p className={waitingForClient ? "rounded-xl border border-accent-soft/50 bg-accent/10 p-3 text-sm" : "text-sm text-muted"}>
            <span className="block text-xs uppercase tracking-wider text-muted">{waitingForClient ? "Потрібна ваша дія" : "Наразі діє студія"}</span>
            {project.next_action}
          </p>
        ) : null}
      </Link>
    </li>
  );
}
