"use client";

import { addExpenseAction, commentTaskAction, createEstimateAction, createTaskAction, finalizeEstimateAction, moveTaskAction, saveEstimateAction, updateTaskAction } from "@/app/admin/ops-actions";
import { ActionForm, Field } from "@/components/admin/stage2-forms";
import { adminFieldClass } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS } from "@/lib/admin/tasks";

type Option = { id: string; label: string };

export function NewTaskForm({ projects, admins }: { projects: Option[]; admins: Option[] }) {
  return (
    <ActionForm action={createTaskAction} hidden={{}} submit="Створити завдання" pendingLabel="Створюємо…" resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Назва">
          <input name="title" maxLength={200} required className={adminFieldClass} />
        </Field>
        <Field label="Проєкт">
          <select name="projectId" defaultValue="" className={adminFieldClass}>
            <option value="">Без проєкту</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Виконавець">
          <select name="assigneeId" defaultValue="" className={adminFieldClass}>
            <option value="">Не призначено</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Пріоритет">
          <select name="priority" defaultValue="normal" className={adminFieldClass}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </Field>
        <Field label="Дедлайн">
          <input name="deadline" type="date" className={adminFieldClass} />
        </Field>
        <Field label="Колонка">
          <select name="status" defaultValue="backlog" className={adminFieldClass}>
            {TASK_STATUSES.filter((s) => s !== "blocked").map((s) => (
              <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Опис">
        <textarea name="description" rows={2} maxLength={8000} className={cn(adminFieldClass, "resize-y")} />
      </Field>
    </ActionForm>
  );
}

/** Переміщення по дошці. key за версією: після підтвердженої зміни список перемонтовується з актуальним статусом. */
export function MoveTaskForm({ id, version, status }: { id: string; version: number; status: string }) {
  return (
    <ActionForm key={version} action={moveTaskAction} hidden={{ id, version: String(version) }} submit="Перемістити" pendingLabel="…" variant="ghost" className="gap-2">
      <select name="status" defaultValue={status} aria-label="Нова колонка" className={adminFieldClass}>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
        ))}
      </select>
      <input name="reason" maxLength={1000} placeholder="Причина (для Blocked)" aria-label="Причина блокування" className={adminFieldClass} />
    </ActionForm>
  );
}

export function EditTaskForm({
  task,
  projects,
  admins,
  checklist,
  links,
}: {
  task: { id: string; version: number; title: string; description: string; project_id: string | null; assignee_id: string | null; priority: string; deadline: string | null; risk_note: string | null };
  projects: Option[];
  admins: Option[];
  checklist: string;
  links: string;
}) {
  return (
    <ActionForm key={task.version} action={updateTaskAction} hidden={{ id: task.id, version: String(task.version) }} submit="Зберегти завдання" pendingLabel="Зберігаємо…">
      <Field label="Назва">
        <input name="title" defaultValue={task.title} maxLength={200} required className={adminFieldClass} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Проєкт">
          <select name="projectId" defaultValue={task.project_id ?? ""} className={adminFieldClass}>
            <option value="">Без проєкту</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Виконавець">
          <select name="assigneeId" defaultValue={task.assignee_id ?? ""} className={adminFieldClass}>
            <option value="">Не призначено</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Пріоритет">
          <select name="priority" defaultValue={task.priority} className={adminFieldClass}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </Field>
        <Field label="Дедлайн">
          <input name="deadline" type="date" defaultValue={task.deadline ?? ""} className={adminFieldClass} />
        </Field>
      </div>
      <Field label="Опис">
        <textarea name="description" defaultValue={task.description} rows={4} maxLength={8000} className={cn(adminFieldClass, "resize-y")} />
      </Field>
      <Field label="Ризик або блокер (нотатка)">
        <input name="risk" defaultValue={task.risk_note ?? ""} maxLength={1000} className={adminFieldClass} />
      </Field>
      <Field label="Чекліст (по рядку: [x] зроблено, [ ] ще ні)">
        <textarea name="checklist" defaultValue={checklist} rows={4} maxLength={8000} className={cn(adminFieldClass, "resize-y font-mono text-sm")} />
      </Field>
      <Field label="Посилання (по рядку: github|figma|preview https://…)">
        <textarea name="links" defaultValue={links} rows={3} maxLength={8000} className={cn(adminFieldClass, "resize-y font-mono text-sm")} />
      </Field>
    </ActionForm>
  );
}

export function TaskCommentForm({ id }: { id: string }) {
  return (
    <ActionForm action={commentTaskAction} hidden={{ id }} submit="Додати коментар" variant="ghost" resetOnSuccess>
      <Field label="Внутрішній коментар (клієнт його не бачить)">
        <textarea name="body" rows={3} maxLength={4000} required className={cn(adminFieldClass, "resize-y")} />
      </Field>
    </ActionForm>
  );
}

export function NewEstimateForm({ projects }: { projects: Option[] }) {
  return (
    <ActionForm action={createEstimateAction} hidden={{}} submit="Створити кошторис" variant="ghost" resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Назва">
          <input name="title" maxLength={160} required className={adminFieldClass} />
        </Field>
        <Field label="Проєкт">
          <select name="projectId" required className={adminFieldClass}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Валюта">
          <select name="currency" defaultValue="UAH" className={adminFieldClass}>
            <option>UAH</option>
            <option>USD</option>
            <option>EUR</option>
          </select>
        </Field>
      </div>
    </ActionForm>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  design: "Дизайн", frontend: "Frontend", backend: "Backend", database: "База даних", android: "Android", ios: "iOS", integrations: "Інтеграції", qa: "QA", deployment: "Розгортання", support: "Підтримка",
};

export function EstimateEditor({
  id,
  lines,
  params,
  locked,
}: {
  id: string;
  lines: Array<{ category: string; hours: string; rate: string }>;
  params: { reserve: string; margin: string; other: string; finalPrice: string | null; note: string | null };
  locked: boolean;
}) {
  const byCategory = new Map(lines.map((l) => [l.category, l]));
  return (
    <div className="flex flex-col gap-4">
      <ActionForm action={saveEstimateAction} hidden={{ id }} submit={locked ? "Кошторис зафіксовано" : "Зберегти кошторис"} pendingLabel="Зберігаємо…">
        <fieldset disabled={locked} className="flex flex-col gap-4">
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Рядки кошторису (прокручується)">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <caption className="sr-only">Години й внутрішня ставка за категоріями</caption>
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3">Категорія</th>
                  <th scope="col" className="py-2 pr-3">Години</th>
                  <th scope="col" className="py-2">Ставка за годину</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {Object.entries(CATEGORY_LABELS).map(([category, label]) => (
                  <tr key={category}>
                    <th scope="row" className="py-2 pr-3 font-normal">{label}</th>
                    <td className="py-2 pr-3"><input name={`hours_${category}`} type="number" min="0" max="5000" step="0.5" defaultValue={byCategory.get(category)?.hours ?? ""} aria-label={`${label}: години`} className={adminFieldClass} /></td>
                    <td className="py-2"><input name={`rate_${category}`} type="number" min="0" step="0.01" defaultValue={byCategory.get(category)?.rate ?? ""} aria-label={`${label}: ставка`} className={adminFieldClass} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Резерв, %"><input name="reserve" type="number" min="0" max="100" step="0.5" defaultValue={params.reserve} className={adminFieldClass} /></Field>
            <Field label="Цільова маржа, %"><input name="margin" type="number" min="0" max="89.99" step="0.5" defaultValue={params.margin} className={adminFieldClass} /></Field>
            <Field label="Інші витрати"><input name="other" type="number" min="0" step="0.01" defaultValue={params.other} className={adminFieldClass} /></Field>
            <Field label="Моя ціна (необов&apos;язково)"><input name="finalPrice" type="number" min="0" step="0.01" defaultValue={params.finalPrice ?? ""} className={adminFieldClass} /></Field>
          </div>
          <Field label="Внутрішня примітка">
            <textarea name="note" rows={2} maxLength={2000} defaultValue={params.note ?? ""} className={cn(adminFieldClass, "resize-y")} />
          </Field>
        </fieldset>
      </ActionForm>
      {locked ? null : <ActionForm action={finalizeEstimateAction} hidden={{ id }} submit="Зафіксувати кошторис" variant="ghost" />}
    </div>
  );
}

export function ExpenseForm({ projects }: { projects: Option[] }) {
  return (
    <ActionForm action={addExpenseAction} hidden={{}} submit="Записати витрату" variant="ghost" resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Проєкт">
          <select name="projectId" required className={adminFieldClass}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Категорія"><input name="category" maxLength={60} required placeholder="Хостинг, ліцензія…" className={adminFieldClass} /></Field>
        <Field label="Сума"><input name="amount" type="number" min="0.01" step="0.01" required className={adminFieldClass} /></Field>
        <Field label="Валюта">
          <select name="currency" defaultValue="UAH" className={adminFieldClass}>
            <option>UAH</option>
            <option>USD</option>
            <option>EUR</option>
          </select>
        </Field>
        <Field label="Дата"><input name="on" type="date" className={adminFieldClass} /></Field>
      </div>
      <Field label="Примітка"><input name="note" maxLength={500} className={adminFieldClass} /></Field>
    </ActionForm>
  );
}
