"use client";

import { useActionState, useState } from "react";
import { decideDeliverableAction, type FormState } from "@/app/app/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function DeliverableDecision({ deliverableId, projectId, version }: { deliverableId: string; projectId: string; version: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(decideDeliverableAction, null);
  const [mode, setMode] = useState<"idle" | "changes">("idle");

  if (state?.ok) {
    return (
      <p role="status" className="rounded-xl border border-ok/40 bg-ok/10 p-4 text-ok">
        {state.notice}
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" aria-label={`Рішення щодо версії ${version}`}>
      <input type="hidden" name="deliverableId" value={deliverableId} />
      <input type="hidden" name="projectId" value={projectId} />
      {mode === "changes" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`comment-${deliverableId}`} className="text-sm font-medium">
            Що потрібно виправити?
          </label>
          <textarea id={`comment-${deliverableId}`} name="comment" rows={4} maxLength={2000} required className={cn(adminFieldClass, "resize-y")} />
        </div>
      ) : null}
      {state?.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row">
        {mode === "idle" ? (
          <>
            <Button type="submit" name="decision" value="approved" disabled={pending}>
              {pending ? "Зберігаємо…" : "Погодити результат"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("changes")}>
              Попросити правок
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" name="decision" value="changes_requested" disabled={pending}>
              {pending ? "Надсилаємо…" : "Надіслати правки"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("idle")}>
              Скасувати
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
