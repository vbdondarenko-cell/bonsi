"use client";

import { useActionState, useState } from "react";
import { decideDocumentAction, type FormState } from "@/app/app/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/** Погодження документа в системі. Це не кваліфікований електронний підпис (КЕП); рішення фіксується з версією й хешем змісту. */
export function DocumentDecision({ documentId, projectId, version }: { documentId: string; projectId: string; version: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(decideDocumentAction, null);
  const [mode, setMode] = useState<"idle" | "changes" | "reject">("idle");

  if (state?.ok) {
    return (
      <p role="status" className="rounded-xl border border-ok/40 bg-ok/10 p-4 text-ok">
        {state.notice}
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" aria-label={`Рішення щодо версії ${version}`}>
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="projectId" value={projectId} />
      {mode !== "idle" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`doc-comment-${documentId}`} className="text-sm font-medium">
            {mode === "changes" ? "Що потрібно змінити?" : "Причина відхилення"}
          </label>
          <textarea id={`doc-comment-${documentId}`} name="comment" rows={4} maxLength={2000} required className={cn(adminFieldClass, "resize-y")} />
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
              {pending ? "Зберігаємо…" : "Погодити документ"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("changes")}>
              Попросити змін у документі
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("reject")}>
              Відхилити документ
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" name="decision" value={mode === "changes" ? "changes_requested" : "rejected"} disabled={pending}>
              {pending ? "Надсилаємо…" : mode === "changes" ? "Надіслати запит на зміни" : "Підтвердити відхилення"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("idle")}>
              Скасувати
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted">
        Погодження в кабінеті фіксується з датою, версією й контрольною сумою тексту та не може бути змінене заднім числом. Це не кваліфікований електронний підпис; для юридично значущого підписання студія домовиться з вами окремо.
      </p>
    </form>
  );
}
