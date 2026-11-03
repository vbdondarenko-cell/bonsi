"use client";

import { useState } from "react";
import { decideProposalAction } from "@/app/app/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { useGuardedAction } from "@/lib/forms/use-guarded-action";
import { cn } from "@/lib/cn";

/** Погодження або запит змін. Для змін коментар обовʼязковий; рішення фіксується в незмінному журналі. */
export function ProposalDecision({ proposalId, projectId, version }: { proposalId: string; projectId: string; version: number }) {
  const { state, run: action, pending, formRef, ready } = useGuardedAction(decideProposalAction);
  const [mode, setMode] = useState<"idle" | "changes">("idle");

  if (state?.ok) {
    return (
      <p role="status" className="rounded-xl border border-ok/40 bg-ok/10 p-4 text-ok">
        {state.notice}
      </p>
    );
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" aria-label={`Рішення щодо версії ${version}`}>
      <input type="hidden" name="proposalId" value={proposalId} />
      <input type="hidden" name="projectId" value={projectId} />
      {mode === "changes" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="decision-comment" className="text-sm font-medium">
            Що потрібно змінити?
          </label>
          <textarea
            id="decision-comment"
            name="comment"
            rows={4}
            maxLength={2000}
            required
            aria-invalid={Boolean(state?.error)}
            aria-describedby={state?.error ? "decision-error" : undefined}
            className={cn(adminFieldClass, "resize-y")}
          />
        </div>
      ) : null}
      {state?.error ? (
        <p id="decision-error" role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row">
        {mode === "idle" ? (
          <>
            <Button type="submit" name="decision" value="approved" disabled={pending || !ready}>
              {pending ? "Зберігаємо…" : "Погодити пропозицію"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("changes")}>
              Попросити змін
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" name="decision" value="changes_requested" disabled={pending || !ready}>
              {pending ? "Надсилаємо…" : "Надіслати запит на зміни"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("idle")}>
              Скасувати
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted">Рішення фіксується в журналі з датою й версією пропозиції та не може бути змінене заднім числом.</p>
    </form>
  );
}
