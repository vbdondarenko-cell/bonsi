"use client";

import { completeProjectAction, replyTicketAction, saveHandoverAction, submitHandoverAction, ticketToChangeAction, updateTicketAction } from "@/app/admin/delivery-actions";
import { ActionForm, Field } from "@/components/admin/stage2-forms";
import { adminFieldClass } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS } from "@/lib/client/labels";

type Handover = Record<string, string | null | undefined> & { artifacts?: Array<{ kind: string; label: string; url: string }> };

const TEXT_FIELDS: Array<[string, string]> = [
  ["production_url", "Production URL"], ["domain", "Домен"], ["domain_owner", "Власник домену"], ["hosting", "Хостинг"],
  ["repository_url", "Репозиторій (https)"], ["docs_url", "Документація (https)"], ["manual_url", "Інструкція (https)"],
  ["app_version", "Версія застосунку"], ["store_state", "Стан у магазинах"],
];

export function HandoverEditor({ projectId, record, kind }: { projectId: string; record: Handover | null; kind: string }) {
  const r = record ?? {};
  const artifacts = (record?.artifacts ?? []).map((a) => `${a.kind} ${a.label} ${a.url}`).join("\n");
  return (
    <ActionForm action={saveHandoverAction} hidden={{ projectId }} submit="Зберегти чернетку" pendingLabel="Зберігаємо…">
      <Field label="Тип продукту">
        <select name="product_kind" defaultValue={kind} className={adminFieldClass}>
          <option value="website">Сайт</option>
          <option value="mobile">Мобільний застосунок</option>
          <option value="other">Інше</option>
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {TEXT_FIELDS.map(([name, label]) => (
          <Field key={name} label={label}>
            <input name={name} defaultValue={r[name] ?? ""} maxLength={300} className={adminFieldClass} />
          </Field>
        ))}
      </div>
      {(["backup_note", "backend_note", "rights_note"] as const).map((name) => (
        <Field key={name} label={{ backup_note: "Резервні копії", backend_note: "Серверна частина", rights_note: "Права й доступи" }[name]}>
          <textarea name={name} rows={2} maxLength={1000} defaultValue={r[name] ?? ""} className={cn(adminFieldClass, "resize-y")} />
        </Field>
      ))}
      <Field label="Артефакти (кожен рядок: тип назва https-посилання; типи: apk, aab, testflight, release, other)">
        <textarea name="artifacts" rows={3} defaultValue={artifacts} className={cn(adminFieldClass, "resize-y font-mono text-xs")} />
      </Field>
      <p className="text-xs text-muted">Паролі, токени й ключі зберігати тут заборонено — передавайте їх окремим захищеним каналом.</p>
    </ActionForm>
  );
}

export function SubmitHandoverForm({ projectId }: { projectId: string }) {
  return <ActionForm action={submitHandoverAction} hidden={{ projectId }} submit="Відправити клієнту на приймання" pendingLabel="Відправляємо…" />;
}

export function CompleteProjectForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm action={completeProjectAction} hidden={{ projectId }} submit="Завершити проєкт" pendingLabel="Завершуємо…">
      <Field label="Гарантія діє до (необов'язково)">
        <input type="date" name="warranty" className={adminFieldClass} />
      </Field>
    </ActionForm>
  );
}

export function AdminTicketReplyForm({ ticketId }: { ticketId: string }) {
  return (
    <ActionForm action={replyTicketAction} hidden={{ id: ticketId }} submit="Надіслати" pendingLabel="Надсилаємо…" resetOnSuccess>
      <Field label="Повідомлення">
        <textarea name="body" rows={4} required maxLength={4000} className={cn(adminFieldClass, "resize-y")} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="internal" /> Внутрішня нотатка (клієнт не побачить)
      </label>
    </ActionForm>
  );
}

export function TicketUpdateForm({ ticket, admins }: { ticket: { id: string; status: string; priority: string; assignee_id: string | null; result: string | null; updated_at: string }; admins: Array<{ id: string; label: string }> }) {
  return (
    <ActionForm action={updateTicketAction} hidden={{ id: ticket.id }} submit="Зберегти" pendingLabel="Зберігаємо…">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Статус">
          <select key={ticket.updated_at} name="status" defaultValue={ticket.status} className={adminFieldClass}>
            {Object.entries(TICKET_STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Пріоритет">
          <select key={ticket.updated_at} name="priority" defaultValue={ticket.priority} className={adminFieldClass}>
            {Object.entries(TICKET_PRIORITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Виконавець">
          <select key={ticket.updated_at} name="assignee" defaultValue={ticket.assignee_id ?? ""} className={adminFieldClass}>
            <option value="">Не призначено</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Результат (обов'язковий для «Вирішено» / «Закрито»)">
        <textarea key={ticket.updated_at} name="result" rows={3} maxLength={4000} defaultValue={ticket.result ?? ""} className={cn(adminFieldClass, "resize-y")} />
      </Field>
    </ActionForm>
  );
}

export function TicketToChangeForm({ ticketId }: { ticketId: string }) {
  return <ActionForm action={ticketToChangeAction} hidden={{ id: ticketId }} submit="Оформити як платне доопрацювання" pendingLabel="Створюємо…" variant="ghost" />;
}
