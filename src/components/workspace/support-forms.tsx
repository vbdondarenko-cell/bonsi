"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { closeTicketAction, createTicketAction, decideHandoverAction, replyTicketClientAction, type FormState } from "@/app/app/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { TICKET_CATEGORY_LABELS, TICKET_PRIORITY_LABELS } from "@/lib/client/labels";

function Feedback({ state }: { state: FormState }) {
  if (state?.error)
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  if (state?.ok)
    return (
      <p role="status" className="text-sm text-ok">
        {state.notice}
      </p>
    );
  return null;
}

export function CreateTicketForm({ projects }: { projects: Array<{ id: string; title: string }> }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<FormState & { ticketId?: string }, FormData>(createTicketAction, null as never);
  useEffect(() => {
    if (state?.ok && state.ticketId) router.push(`/app/support/${state.ticketId}`);
  }, [state, router]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 text-sm font-medium">
        Проєкт
        <select name="projectId" required className={adminFieldClass} defaultValue={projects[0]?.id}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm font-medium">
          Категорія
          <select name="category" required className={adminFieldClass} defaultValue="bug">
            {Object.entries(TICKET_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Пріоритет
          <select name="priority" className={adminFieldClass} defaultValue="normal">
            {Object.entries(TICKET_PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Тема
        <input name="subject" required minLength={3} maxLength={160} className={adminFieldClass} />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Опис
        <textarea name="description" required minLength={10} maxLength={4000} rows={5} className={adminFieldClass} placeholder="Що сталося, де саме і як це відтворити. Паролі та ключі в зверненні не надсилайте." />
      </label>
      <Feedback state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Надсилаємо…" : "Створити звернення"}
      </Button>
    </form>
  );
}

export function TicketReplyForm({ ticketId }: { ticketId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(replyTicketClientAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="flex flex-col gap-3" key={state?.ok ? "sent" : "editing"}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <label className="flex flex-col gap-2 text-sm font-medium">
        Ваше повідомлення
        <textarea name="body" required maxLength={4000} rows={4} className={adminFieldClass} />
      </label>
      <Feedback state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Надсилаємо…" : "Надіслати"}
      </Button>
    </form>
  );
}

export function CloseTicketButton({ ticketId }: { ticketId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(closeTicketAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="ticketId" value={ticketId} />
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? "…" : "Підтвердити, що питання вирішено"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function HandoverDecisionForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(decideHandoverAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="flex flex-col gap-2 text-sm font-medium">
        Коментар (обов&apos;язковий, якщо потрібні правки)
        <textarea name="comment" rows={3} maxLength={2000} className={adminFieldClass} />
      </label>
      <Feedback state={state} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="decision" value="approved" disabled={pending}>
          Прийняти передачу
        </Button>
        <Button type="submit" name="decision" value="changes_requested" variant="ghost" disabled={pending}>
          Потрібні правки
        </Button>
      </div>
      <p className="text-xs text-muted">Рішення фіксується в журналі проєкту й не є кваліфікованим електронним підписом.</p>
    </form>
  );
}
