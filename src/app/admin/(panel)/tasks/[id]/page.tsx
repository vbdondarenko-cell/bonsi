import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditTaskForm, MoveTaskForm, TaskCommentForm } from "@/components/admin/ops-forms";
import { PageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { Pill } from "@/components/workspace/ui";
import { requireAdmin } from "@/lib/admin/guard";
import { uuidSchema } from "@/lib/admin/orders";
import { TASK_STATUS_LABELS, checklistToText, linksToText, type ChecklistItem, type TaskLink, type TaskStatus } from "@/lib/admin/tasks";

export const metadata: Metadata = { title: "Завдання" };
export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = { created: "Створено", updated: "Оновлено поля", status_changed: "Зміна статусу", assigned: "Зміна виконавця", commented: "Коментар" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase } = await requireAdmin();
  const [task, comments, events, admins, projects] = await Promise.all([
    supabase.from("studio_tasks").select("*").eq("id", id).maybeSingle(),
    supabase.from("task_comments").select("id,author_id,body,created_at").eq("task_id", id).order("id", { ascending: false }),
    supabase.from("task_events").select("id,actor_id,type,data,created_at").eq("task_id", id).order("id", { ascending: false }),
    supabase.from("admin_users").select("user_id,display_name").eq("active", true),
    supabase.from("projects").select("id,title").order("created_at", { ascending: false }).limit(200),
  ]);
  if (task.error) return <p role="alert" className="text-danger">Не вдалося завантажити завдання.</p>;
  if (!task.data) notFound();
  const t = task.data as { id: string; version: number; title: string; description: string; status: TaskStatus; priority: string; project_id: string | null; assignee_id: string | null; deadline: string | null; blocked_reason: string | null; risk_note: string | null; checklist: ChecklistItem[]; links: TaskLink[] };
  const adminOpts = (admins.data ?? []).map((a) => ({ id: a.user_id as string, label: a.display_name as string }));
  const names = new Map(adminOpts.map((a) => [a.id, a.label]));
  const projectOpts = (projects.data ?? []).map((p) => ({ id: p.id as string, label: p.title as string }));

  return (
    <div className="flex flex-col gap-8">
      <Link prefetch={false} href="/admin/tasks" className="text-sm text-muted hover:text-fg">← Дошка</Link>
      <PageHeader eyebrow="Завдання" title={t.title}>
        <Pill tone={t.status === "blocked" ? "warn" : t.status === "done" ? "ok" : "accent"}>{TASK_STATUS_LABELS[t.status]}</Pill>
        <Pill tone="muted">версія {t.version}</Pill>
      </PageHeader>
      {t.blocked_reason ? <p className="rounded-xl border border-[#e0b054]/40 bg-[#e0b054]/10 p-3 text-sm">Блокер: {t.blocked_reason}</p> : null}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <Panel title="Деталі">
            <EditTaskForm task={t} projects={projectOpts} admins={adminOpts} checklist={checklistToText(t.checklist)} links={linksToText(t.links)} />
            {t.links.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-1 text-sm" aria-label="Посилання">
                {t.links.map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent-soft underline underline-offset-4">{l.kind}: {l.url}</a>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
          <Panel title="Внутрішні коментарі">
            <TaskCommentForm id={id} />
            <ul className="mt-6 flex flex-col gap-4">
              {(comments.data ?? []).length === 0 ? <li className="text-sm text-muted">Коментарів немає.</li> : null}
              {(comments.data ?? []).map((c) => (
                <li key={c.id as number} className="rounded-xl border border-line bg-surface-2/60 p-4">
                  <p className="whitespace-pre-wrap break-words">{c.body as string}</p>
                  <p className="mt-2 text-xs text-muted">{names.get(c.author_id as string) ?? "Адміністратор"} · {formatDateTime(c.created_at as string)}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="flex flex-col gap-6">
          <Panel title="Статус">
            <MoveTaskForm id={t.id} version={t.version} status={t.status} />
          </Panel>
          <Panel title="Історія змін">
            <ol className="flex flex-col gap-3 text-sm">
              {(events.data ?? []).map((e) => {
                const data = e.data as Record<string, string | null>;
                const detail = e.type === "status_changed" ? `${TASK_STATUS_LABELS[data.from as TaskStatus] ?? data.from} → ${TASK_STATUS_LABELS[data.to as TaskStatus] ?? data.to}` : e.type === "assigned" ? `${names.get(data.from ?? "") ?? "—"} → ${names.get(data.to ?? "") ?? "—"}` : "";
                return (
                  <li key={e.id as number}>
                    <p>{EVENT_LABELS[e.type as string] ?? e.type}{detail ? `: ${detail}` : ""}</p>
                    <p className="text-xs text-muted">{names.get(e.actor_id as string) ?? "Система"} · {formatDateTime(e.created_at as string)}</p>
                  </li>
                );
              })}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
