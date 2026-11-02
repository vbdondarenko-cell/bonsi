"use client";

import { useActionState } from "react";
import { reportPaymentAction, type FormState } from "@/app/app/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

export function ReportPaymentForm({ invoiceId, projectId }: { invoiceId: string; projectId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reportPaymentAction, null);
  if (state?.ok) {
    return (
      <p role="status" className="text-sm text-ok">
        {state.notice}
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="projectId" value={projectId} />
      <label className="flex flex-1 flex-col gap-2 text-sm font-medium">
        Номер платежу або коментар (необовʼязково)
        <input name="reference" maxLength={200} className={adminFieldClass} />
      </label>
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? "Надсилаємо…" : "Я сплатив(ла)"}
      </Button>
      {state?.error ? (
        <p role="alert" className="text-sm text-danger sm:basis-full">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
