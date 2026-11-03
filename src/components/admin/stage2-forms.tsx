"use client";

import { useActionState, useRef, useEffect, type ReactNode } from "react";
import { useRefreshOnSuccess } from "@/components/admin/use-refresh-on-success";
import type { ActionState } from "@/app/admin/actions";
import {
  createDeliverableAction,
  createInvoiceAction,
  createInvoicesFromProposalAction,
  deleteProjectFileAction,
  invoiceLifecycleAction,
  paymentDecisionAction,
  refundAction,
  saveDeliverableAction,
  submitDeliverableAction,
  updatePaymentSettingsAction,
} from "@/app/admin/project-actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { DELIVERABLE_STAGES, STAGE_LABELS } from "@/lib/client/labels";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function Feedback({ state }: { state: ActionState }) {
  if (state?.error || state?.fieldError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error ?? state.fieldError}
      </p>
    );
  }
  if (state?.ok) {
    return (
      <p role="status" className="text-sm text-ok">
        {state.notice ?? "Збережено"}
      </p>
    );
  }
  return null;
}

/** Типова форма адмінки: прихані поля, контент, кнопка, відгук. Очищається після успіху, якщо resetOnSuccess. */
export function ActionForm({
  action,
  hidden,
  children,
  submit,
  pendingLabel = "…",
  variant = "primary",
  resetOnSuccess = false,
  className,
}: {
  action: Action;
  hidden: Record<string, string>;
  children?: ReactNode;
  submit: string;
  pendingLabel?: string;
  variant?: "primary" | "ghost";
  resetOnSuccess?: boolean;
  className?: string;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, null);
  useRefreshOnSuccess(state);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={run} className={cn("flex flex-col gap-3", className)}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <Feedback state={state} />
      <Button type="submit" variant={variant} disabled={pending} className="min-h-11 self-start px-5">
        {pending ? pendingLabel : submit}
      </Button>
    </form>
  );
}

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex flex-col gap-2 text-sm font-medium">
    {label}
    {children}
  </label>
);

export function NewDeliverableForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm action={createDeliverableAction} hidden={{ projectId }} submit="Створити чернетку" resetOnSuccess variant="ghost">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Етап">
          <select name="stage" className={adminFieldClass} defaultValue="design">
            {DELIVERABLE_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Назва результату">
          <input name="title" maxLength={160} required className={adminFieldClass} />
        </Field>
      </div>
      <Field label="Опис">
        <textarea name="description" rows={3} maxLength={4000} className={cn(adminFieldClass, "resize-y")} />
      </Field>
      <Field label="Посилання на прев’ю (Figma, стейджинг)">
        <input name="previewUrl" type="url" maxLength={500} placeholder="https://" className={adminFieldClass} />
      </Field>
    </ActionForm>
  );
}

export function DeliverableDraftForm({ projectId, id, title, description, previewUrl }: { projectId: string; id: string; title: string; description: string; previewUrl: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      <ActionForm action={saveDeliverableAction} hidden={{ projectId, id }} submit="Зберегти чернетку" variant="ghost">
        <Field label="Назва">
          <input name="title" defaultValue={title} maxLength={160} required className={adminFieldClass} />
        </Field>
        <Field label="Опис">
          <textarea name="description" defaultValue={description} rows={3} maxLength={4000} className={cn(adminFieldClass, "resize-y")} />
        </Field>
        <Field label="Прев’ю">
          <input name="previewUrl" type="url" defaultValue={previewUrl ?? ""} maxLength={500} className={adminFieldClass} />
        </Field>
      </ActionForm>
      <ActionForm action={submitDeliverableAction} hidden={{ projectId, id }} submit="Надіслати клієнту на погодження" pendingLabel="Надсилаємо…" />
    </div>
  );
}

export function DeleteFileForm({ projectId, fileId }: { projectId: string; fileId: string }) {
  const [state, run, pending] = useActionState<ActionState, FormData>(deleteProjectFileAction, null);
  useRefreshOnSuccess(state);
  return (
    <form action={run} className="flex items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="fileId" value={fileId} />
      <button type="submit" disabled={pending} className="text-sm text-muted underline underline-offset-4 hover:text-danger disabled:opacity-60">
        {pending ? "…" : "Видалити"}
      </button>
      {state?.error ? <span role="alert" className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

export function InvoicesFromProposalForm({ proposalId, projectId }: { proposalId: string; projectId: string }) {
  return <ActionForm action={createInvoicesFromProposalAction} hidden={{ proposalId, projectId }} submit="Створити рахунки за графіком пропозиції" pendingLabel="Створюємо…" variant="ghost" />;
}

export function NewInvoiceForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm action={createInvoiceAction} hidden={{ projectId }} submit="Створити рахунок" resetOnSuccess variant="ghost">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Field label="Призначення">
            <input name="label" maxLength={120} required className={adminFieldClass} />
          </Field>
        </div>
        <Field label="Сума">
          <input name="amount" type="number" min="0.01" step="0.01" required className={adminFieldClass} />
        </Field>
        <Field label="Валюта">
          <select name="currency" className={adminFieldClass} defaultValue="UAH">
            <option value="UAH">₴ UAH</option>
            <option value="USD">$ USD</option>
            <option value="EUR">€ EUR</option>
          </select>
        </Field>
      </div>
      <Field label="Сплатити до (необов’язково)">
        <input name="due" type="date" className={adminFieldClass} />
      </Field>
    </ActionForm>
  );
}

export function IssueInvoiceForm({ invoiceId, projectId }: { invoiceId: string; projectId: string }) {
  return (
    <ActionForm action={invoiceLifecycleAction} hidden={{ invoiceId, projectId, op: "issue" }} submit="Виставити клієнту" pendingLabel="Виставляємо…" className="sm:flex-row sm:items-end">
      <Field label="Сплатити до">
        <input name="due" type="date" className={adminFieldClass} />
      </Field>
    </ActionForm>
  );
}

export function VoidInvoiceForm({ invoiceId, projectId }: { invoiceId: string; projectId: string }) {
  return <ActionForm action={invoiceLifecycleAction} hidden={{ invoiceId, projectId, op: "void", due: "" }} submit="Анулювати" variant="ghost" />;
}

export function PaymentDecisionForms({ paymentId, projectId, amount }: { paymentId: string; projectId: string; amount: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-accent-soft/50 bg-accent/10 p-4">
      <p className="text-sm">Клієнт повідомив про переказ {amount}. Звірте надходження з банком і підтвердьте або відхиліть.</p>
      <ActionForm action={paymentDecisionAction} hidden={{ paymentId, projectId, op: "confirm" }} submit="Підтвердити надходження" pendingLabel="Підтверджуємо…">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Фактична сума (якщо відрізняється)">
            <input name="amount" type="number" min="0.01" step="0.01" className={adminFieldClass} />
          </Field>
          <Field label="Коментар">
            <input name="note" maxLength={1000} className={adminFieldClass} />
          </Field>
        </div>
      </ActionForm>
      <ActionForm action={paymentDecisionAction} hidden={{ paymentId, projectId, op: "reject", amount: "" }} submit="Відхилити" variant="ghost">
        <Field label="Причина відхилення">
          <input name="note" maxLength={1000} className={adminFieldClass} />
        </Field>
      </ActionForm>
    </div>
  );
}

export function RefundForm({ invoiceId, projectId }: { invoiceId: string; projectId: string }) {
  return (
    <ActionForm action={refundAction} hidden={{ invoiceId, projectId }} submit="Записати повернення" variant="ghost" resetOnSuccess className="sm:flex-row sm:items-end">
      <Field label="Сума повернення">
        <input name="amount" type="number" min="0.01" step="0.01" required className={adminFieldClass} />
      </Field>
      <Field label="Коментар">
        <input name="note" maxLength={1000} className={adminFieldClass} />
      </Field>
    </ActionForm>
  );
}

export function PaymentSettingsForm({ recipient, iban, bank, taxId, hint }: { recipient: string; iban: string; bank: string; taxId: string; hint: string }) {
  return (
    <ActionForm action={updatePaymentSettingsAction} hidden={{}} submit="Зберегти реквізити" pendingLabel="Зберігаємо…">
      <Field label="Отримувач">
        <input name="recipient" defaultValue={recipient} maxLength={200} className={adminFieldClass} />
      </Field>
      <Field label="IBAN">
        <input name="iban" defaultValue={iban} maxLength={40} className={cn(adminFieldClass, "font-mono")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Банк">
          <input name="bank" defaultValue={bank} maxLength={200} className={adminFieldClass} />
        </Field>
        <Field label="ІПН / ЄДРПОУ">
          <input name="taxId" defaultValue={taxId} maxLength={40} className={adminFieldClass} />
        </Field>
      </div>
      <Field label="Призначення платежу ({number} — номер рахунку)">
        <input name="hint" defaultValue={hint} maxLength={300} className={adminFieldClass} />
      </Field>
    </ActionForm>
  );
}
