"use client";

import { useActionState } from "react";
import { retryFailedEmailsAction } from "@/app/admin/email-actions";
import { useRefreshOnSuccess } from "@/components/admin/use-refresh-on-success";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/app/admin/actions";

export function RetryFailedEmails({ failed }: { failed: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(() => retryFailedEmailsAction(), null);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="flex items-center gap-3">
      <Button type="submit" variant="ghost" disabled={pending || failed === 0}>
        {pending ? "…" : "Повторити невдалі"}
      </Button>
      {state?.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      {state?.ok ? <p role="status" className="text-sm text-ok">{state.notice}</p> : null}
    </form>
  );
}
