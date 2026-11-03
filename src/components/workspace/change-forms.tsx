"use client";

import { useActionState } from "react";
import { useGuardedAction } from "@/lib/forms/use-guarded-action";
import { submitChangeRequestAction, withdrawChangeRequestAction, type FormState } from "@/app/app/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

export function SubmitChangeForm({ projectId }: { projectId: string }) {
  const { state, run, pending, formRef, ready } = useGuardedAction(submitChangeRequestAction, { resetOnSuccess: true });
  return (
    <form ref={formRef} action={run} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="flex flex-col gap-2 text-sm font-medium">
        Що потрібно змінити чи додати?
        <input name="title" maxLength={160} required className={adminFieldClass} placeholder="Наприклад: інтернет-магазин із кошиком" />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Опис
        <textarea name="description" rows={5} maxLength={4000} required className={adminFieldClass} placeholder="Опишіть бажаний результат. Вартість і терміни студія повідомить окремою додатковою угодою." />
      </label>
      {state?.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="rounded-xl border border-ok/40 bg-ok/10 p-3 text-sm text-ok">
          {state.notice}
        </p>
      ) : null}
      <Button type="submit" disabled={pending || !ready} className="self-start">
        {pending ? "Надсилаємо…" : "Надіслати запит на зміну"}
      </Button>
    </form>
  );
}

export function WithdrawChangeButton({ changeId, projectId }: { changeId: string; projectId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(withdrawChangeRequestAction, null);
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="changeId" value={changeId} />
      <input type="hidden" name="projectId" value={projectId} />
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? "…" : "Відкликати запит"}
      </Button>
      {state?.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
