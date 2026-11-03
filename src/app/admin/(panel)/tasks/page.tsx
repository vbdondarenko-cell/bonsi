import type { Metadata } from "next";
import Link from "next/link";
import { MoveTaskForm, NewTaskForm } from "@/components/admin/ops-forms";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Pill } from "@/components/workspace/ui";
import { requireAdmin } from "@/lib/admin/guard";
import { TASK_PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS, isOverdue, type ChecklistItem, type TaskLink, type TaskStatus } from "@/lib/admin/tasks";

export const metadata: Metadata = { title: "Завдання студії" };
export const dynamic = "force-dynamic";

type Task = {
  id: string; title: string; status: TaskStatus; priority: keyof typeof TASK_PRIORITY_LABELS; project_id: string | null; assignee_id: string | null; deadline: string | null;
  blocked_reason: string | null; risk_note: string | null; checklist: ChecklistItem[]; links: TaskLink[]; version: number;
};

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ assignee?: string; project?: string }> }) {
  const { assignee, project } = await searchParams;
  const { supabase, userId } = await requireAdmin();
  const [tasksRes, adminsRes, projectsRes] = await Promise.all([
    supabase.from("studio_tasks").select("id,title,status,priority,project_id,assignee_id,deadline,blocked_reason,risk_note,checklist,links,version").order("priority", { ascending: false }).order("deadline", { ascending: true, nullsFirst: false }).limit(500),
    supabase.from("admin_users").select("user_id,display_name").eq("active", true),
    supabase.from("projects").select("id,title").order("created_at", { ascending: false }).limit(200),
  ]);
  if (tasksRes.error) return <p role="alert" className="text-danger">Не вдалося завантажити завдання.</p>;
  const admins = (adminsRes.data ?? []).map((a) => ({ id: a.user_id as string, label: a.display_name as string }));
  const projects = (projectsRes.data ?? []).map((p) => ({ id: p.id as string, label: p.title as string }));
  const nameOf = new Map(admins.map((a) => [a.id, a.label]));
  const projectOf = new Map(projects.map((p) => [p.id, p.label]));
  const all = (tasksRes.data ?? []) as unknown as Task[];
  const tasks = all.filter((t) => (assignee ? (assignee === "me" ? t.assignee_id === userId : assignee === "none" ? !t.assignee_id : t.assignee_id === assignee) : true) && (project ? t.project_id === project : true));
  const overdue = all.filter((t) => isOverdue(t.deadline, t.status)).length;
  const blocked = all.filter((t) => t.status === "blocked").length;

  const filterLink = (label: string, value: string | undefined, active: boolean) => (
    <Link prefetch={false} key={label} href={value ? `/admin/tasks?assignee=${value}` : "/admin/tasks"} aria-current={active ? "true" : undefined} className={active ? "rounded-full bg-accent/20 px-3 py-1 text-sm ring-1 ring-accent-soft/50" : "rounded-full px-3 py-1 text-sm text-muted hover:text-fg"}>
      {label}
    </Link>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Студія" title="Завдання">
        <Pill tone={overdue > 0 ? "danger" : "muted"}>Прострочено: {overdue}</Pill>
        <Pill tone={blocked > 0 ? "warn" : "muted"}>Заблоковано: {blocked}</Pill>
      </PageHeader>

      <nav aria-label="Фільтр за виконавцем" className="flex flex-wrap gap-2">
        {filterLink("Усі", undefined, !assignee)}
        {filterLink("Мої", "me", assignee === "me")}
        {admins.map((a) => filterLink(a.label, a.id, assignee === a.id))}
        {filterLink("Без виконавця", "none", assignee === "none")}
      </nav>

      <Panel title="Нове завдання">
        <NewTaskForm projects={projects} admins={admins} />
      </Panel>

      <div className="overflow-x-auto pb-2" tabIndex={0} role="region" aria-label="Дошка завдань (прокручується)">
        <div className="grid min-w-[72rem] grid-cols-6 gap-4">
          {TASK_STATUSES.map((status) => {
            const column = tasks.filter((t) => t.status === status);
            return (
              <section key={status} aria-labelledby={`col-${status}`} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface/50 p-3">
                <h2 id={`col-${status}`} className="flex items-center justify-between text-sm font-medium">
                  {TASK_STATUS_LABELS[status]}
                  <span className="text-xs text-muted" aria-label={`завдань: ${column.length}`}>{column.length}</span>
                </h2>
                {column.length === 0 ? <p className="text-xs text-muted">Порожньо</p> : null}
                <ul className="flex flex-col gap-3">
                  {column.map((task) => {
                    const done = task.checklist.filter((c) => c.done).length;
                    const late = isOverdue(task.deadline, task.status);
                    return (
                      <li key={task.id} data-task-id={task.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2/60 p-3">
                        <Link prefetch={false} href={`/admin/tasks/${task.id}`} className="font-medium underline-offset-4 hover:underline">{task.title}</Link>
                        <div className="flex flex-wrap gap-1.5 text-xs">
                          <Pill tone={task.priority === "urgent" ? "danger" : task.priority === "high" ? "warn" : "muted"}>{TASK_PRIORITY_LABELS[task.priority]}</Pill>
                          {task.deadline ? <Pill tone={late ? "danger" : "muted"}>{late ? "Прострочено " : "До "}{task.deadline}</Pill> : null}
                          {task.checklist.length > 0 ? <Pill tone="muted">Чекліст {done}/{task.checklist.length}</Pill> : null}
                        </div>
                        <p className="text-xs text-muted">
                          {task.assignee_id ? nameOf.get(task.assignee_id) ?? "Адміністратор" : "Без виконавця"}
                          {task.project_id ? ` · ${projectOf.get(task.project_id) ?? "проєкт"}` : ""}
                        </p>
                        {task.blocked_reason ? <p className="rounded-lg border border-[#e0b054]/40 bg-[#e0b054]/10 p-2 text-xs">Блокер: {task.blocked_reason}</p> : null}
                        {task.risk_note ? <p className="text-xs text-muted">Ризик: {task.risk_note}</p> : null}
                        <MoveTaskForm id={task.id} version={task.version} status={task.status} />
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
