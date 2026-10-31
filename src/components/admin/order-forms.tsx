"use client";

import { useActionState } from "react";
import { addNoteAction, assignOrderAction, updateStatusAction, type ActionState } from "@/app/admin/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { ORDER_STATUSES, STATUS_LABELS } from "@/lib/admin/orders";

function Feedback({ state }: { state: ActionState }) {
  if (state?.error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  }
  if (state?.ok) {
    return (
      <p role="status" className="text-sm text-ok">
        Збережено
      </p>
    );
  }
  return null;
}

export function StatusForm({ orderId, status }: { orderId: string; status: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateStatusAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor="status" className="text-sm font-medium">
        Статус
      </label>
      <div className="flex gap-3">
        <select id="status" name="status" defaultValue={status} className={adminFieldClass}>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={pending} className="min-h-11 shrink-0 px-5">
          {pending ? "…" : "Змінити"}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function AssignForm({
  orderId,
  assignee,
  admins,
}: {
  orderId: string;
  assignee: string | null;
  admins: Array<{ user_id: string; display_name: string }>;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(assignOrderAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor="assignee" className="text-sm font-medium">
        Виконавець
      </label>
      <div className="flex gap-3">
        <select id="assignee" name="assignee" defaultValue={assignee ?? ""} className={adminFieldClass}>
          <option value="">Не призначено</option>
          {admins.map((a) => (
            <option key={a.user_id} value={a.user_id}>
              {a.display_name}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={pending} className="min-h-11 shrink-0 px-5">
          {pending ? "…" : "Призначити"}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function NoteForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addNoteAction, null);
  return (
    <form action={action} className="flex flex-col gap-3" key={state?.ok ? "saved" : "editing"}>
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor="note" className="text-sm font-medium">
        Внутрішня нотатка
      </label>
      <textarea
        id="note"
        name="body"
        rows={3}
        maxLength={4000}
        required
        aria-invalid={Boolean(state?.fieldError)}
        aria-describedby={state?.fieldError ? "note-error" : undefined}
        className={adminFieldClass}
        placeholder="Видно лише адміністраторам"
      />
      {state?.fieldError ? (
        <p id="note-error" role="alert" className="text-sm text-danger">
          {state.fieldError}
        </p>
      ) : null}
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending} className="min-h-11 px-5">
          {pending ? "Зберігаємо…" : "Додати нотатку"}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}
