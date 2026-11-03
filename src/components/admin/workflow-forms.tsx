"use client";

import {
  activateProjectAction,
  changeProgressAction,
  createDocumentAction,
  quoteChangeAction,
  rejectChangeAction,
  rejectOrderAction,
  saveDocumentAction,
  sendDocumentAction,
  setInvoicePurposeAction,
  voidDocumentAction,
} from "@/app/admin/workflow-actions";
import { ActionForm, Field } from "@/components/admin/stage2-forms";
import { adminFieldClass } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { DOCUMENT_KIND_LABELS } from "@/lib/client/labels";
import { DOCUMENT_KINDS } from "@/lib/documents/templates";

export function ActivateProjectForm({ projectId, ready }: { projectId: string; ready: boolean }) {
  return (
    <ActionForm action={activateProjectAction} hidden={{ projectId }} submit="Активувати проєкт" pendingLabel="Активуємо…">
      <Field label="Примітка (необов'язково)">
        <input name="note" maxLength={500} className={adminFieldClass} />
      </Field>
      {ready ? null : <p className="text-sm text-muted">Кнопка спрацює лише після виконання всіх умов; сервер перевіряє їх повторно.</p>}
    </ActionForm>
  );
}

export function RejectOrderForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={rejectOrderAction} hidden={{ orderId }} submit="Відхилити заявку" pendingLabel="Відхиляємо…" variant="ghost">
      <Field label="Причина відхилення (її побачить клієнт)">
        <textarea name="reason" rows={3} minLength={10} maxLength={1000} required className={cn(adminFieldClass, "resize-y")} />
      </Field>
    </ActionForm>
  );
}

export function NewDocumentForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm action={createDocumentAction} hidden={{ projectId }} submit="Створити за шаблоном" pendingLabel="Створюємо…" variant="ghost">
      <Field label="Тип документа">
        <select name="kind" className={adminFieldClass} defaultValue="contract">
          {DOCUMENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {DOCUMENT_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-xs text-muted">Шаблони — чернетки без юридичної перевірки. Перед відправкою клієнту текст має переглянути фахівець.</p>
    </ActionForm>
  );
}

export function DocumentEditor({ projectId, id, title, body, version }: { projectId: string; id: string; title: string; body: string; version: number }) {
  return (
    <div className="flex flex-col gap-4">
      <ActionForm action={saveDocumentAction} hidden={{ projectId, id }} submit={`Зберегти (версія ${version})`} variant="ghost">
        <Field label="Назва">
          <input name="title" defaultValue={title} maxLength={160} required className={adminFieldClass} />
        </Field>
        <Field label="Текст (# заголовок, ## підзаголовок, - список)">
          <textarea name="body" defaultValue={body} rows={14} maxLength={60000} required className={cn(adminFieldClass, "resize-y font-mono text-sm")} />
        </Field>
      </ActionForm>
      <ActionForm action={sendDocumentAction} hidden={{ projectId, id }} submit="Відправити клієнту (зафіксувати версію)" pendingLabel="Відправляємо…" />
    </div>
  );
}

export function VoidDocumentForm({ projectId, id }: { projectId: string; id: string }) {
  return (
    <ActionForm action={voidDocumentAction} hidden={{ projectId, id }} submit="Позначити недійсним" variant="ghost">
      <Field label="Причина">
        <input name="reason" maxLength={500} className={adminFieldClass} />
      </Field>
    </ActionForm>
  );
}

export function InvoicePurposeForm({ projectId, invoiceId, purpose }: { projectId: string; invoiceId: string; purpose: string }) {
  return (
    <ActionForm action={setInvoicePurposeAction} hidden={{ projectId, invoiceId }} submit="Зберегти призначення" variant="ghost">
      <Field label="Призначення рахунку (чернетка)">
        <select name="purpose" defaultValue={purpose} className={adminFieldClass}>
          <option value="regular">Звичайний</option>
          <option value="prepayment">Передоплата (умова активації)</option>
          <option value="change">Зміна замовлення</option>
        </select>
      </Field>
    </ActionForm>
  );
}

export function QuoteChangeForm({ projectId, id }: { projectId: string; id: string }) {
  return (
    <ActionForm action={quoteChangeAction} hidden={{ projectId, id }} submit="Надіслати оцінку клієнту" pendingLabel="Надсилаємо…">
      <Field label="Що входить в оцінку (побачить клієнт)">
        <textarea name="summary" rows={4} minLength={10} maxLength={4000} required className={cn(adminFieldClass, "resize-y")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Додаткова вартість">
          <input name="price" type="number" min="0" step="0.01" required className={adminFieldClass} />
        </Field>
        <Field label="Валюта">
          <select name="currency" defaultValue="UAH" className={adminFieldClass}>
            <option value="UAH">UAH</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </Field>
        <Field label="Додатковий термін, дн.">
          <input name="days" type="number" min="0" step="1" required className={adminFieldClass} />
        </Field>
      </div>
    </ActionForm>
  );
}

export function RejectChangeForm({ projectId, id }: { projectId: string; id: string }) {
  return (
    <ActionForm action={rejectChangeAction} hidden={{ projectId, id }} submit="Відхилити запит" variant="ghost">
      <Field label="Причина (побачить клієнт)">
        <input name="reason" minLength={10} maxLength={1000} required className={adminFieldClass} />
      </Field>
    </ActionForm>
  );
}

export function ChangeProgressForm({ projectId, id, op, label }: { projectId: string; id: string; op: "in_progress" | "done" | "invoice"; label: string }) {
  return <ActionForm action={changeProgressAction} hidden={{ projectId, id, op }} submit={label} variant="ghost" />;
}
