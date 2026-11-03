"use client";

import { confirmConsentAction, savePortfolioAction, setPortfolioStatusAction } from "@/app/admin/portfolio-actions";
import { ActionForm, Field } from "@/components/admin/stage2-forms";
import { adminFieldClass } from "@/components/admin/ui";
import { cn } from "@/lib/cn";

export type PortfolioRecord = {
  id: string; version: number; slug: string; title: string; summary: string; task: string; result: string; stack: string[]; product_type: string;
  cover_url: string | null; cover_alt: string | null; live_url: string | null; project_id: string | null;
};

export function PortfolioForm({ item, projects }: { item: PortfolioRecord | null; projects: Array<{ id: string; label: string }> }) {
  const key = item ? `v${item.version}` : "new";
  const area = "resize-y";
  return (
    <ActionForm action={savePortfolioAction} hidden={{ id: item?.id ?? "", version: String(item?.version ?? 0) }} submit={item ? "Зберегти" : "Створити чернетку"} pendingLabel="Зберігаємо…">
      <div className="grid gap-3 sm:grid-cols-2" key={key}>
        <Field label="Назва кейсу"><input name="title" required minLength={3} maxLength={120} defaultValue={item?.title ?? ""} className={adminFieldClass} /></Field>
        <Field label="Адресне ім'я (slug)"><input name="slug" required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={item?.slug ?? ""} className={adminFieldClass} /></Field>
        <Field label="Тип продукту">
          <select name="product_type" defaultValue={item?.product_type ?? "website"} className={adminFieldClass}>
            <option value="website">Сайт</option><option value="web_app">Вебзастосунок</option><option value="mobile">Мобільний застосунок</option><option value="other">Інше</option>
          </select>
        </Field>
        <Field label="Проєкт у кабінеті (необов'язково)">
          <select name="project_id" defaultValue={item?.project_id ?? ""} className={adminFieldClass}>
            <option value="">Без прив&apos;язки</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
      </div>
      <div className="flex flex-col gap-3" key={`t-${key}`}>
        <Field label="Короткий опис (картка)"><textarea name="summary" required minLength={10} maxLength={300} rows={2} defaultValue={item?.summary ?? ""} className={cn(adminFieldClass, area)} /></Field>
        <Field label="Завдання"><textarea name="task" required minLength={10} maxLength={2000} rows={3} defaultValue={item?.task ?? ""} className={cn(adminFieldClass, area)} /></Field>
        <Field label="Результат (лише перевірені факти)"><textarea name="result" required minLength={10} maxLength={2000} rows={3} defaultValue={item?.result ?? ""} className={cn(adminFieldClass, area)} /></Field>
        <Field label="Технології (через кому)"><input name="stack" maxLength={300} defaultValue={item?.stack.join(", ") ?? ""} className={adminFieldClass} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Посилання на проєкт (https)"><input name="live_url" type="url" maxLength={300} defaultValue={item?.live_url ?? ""} className={adminFieldClass} /></Field>
          <Field label="Зображення (https)"><input name="cover_url" type="url" maxLength={300} defaultValue={item?.cover_url ?? ""} className={adminFieldClass} /></Field>
        </div>
        <Field label="Альтернативний текст зображення"><input name="cover_alt" maxLength={200} defaultValue={item?.cover_alt ?? ""} className={adminFieldClass} /></Field>
      </div>
    </ActionForm>
  );
}

export function ConsentForm({ id }: { id: string }) {
  return (
    <ActionForm action={confirmConsentAction} hidden={{ id }} submit="Підтвердити згоду власника" pendingLabel="Зберігаємо…">
      <Field label="Як отримано згоду (лист, повідомлення, договір)">
        <input name="note" required minLength={5} maxLength={500} className={adminFieldClass} />
      </Field>
    </ActionForm>
  );
}

export function PortfolioStatusForm({ id, version, status, label, variant = "primary" }: { id: string; version: number; status: "draft" | "published" | "archived"; label: string; variant?: "primary" | "ghost" }) {
  return <ActionForm action={setPortfolioStatusAction} hidden={{ id, version: String(version), status }} submit={label} pendingLabel="…" variant={variant} />;
}
