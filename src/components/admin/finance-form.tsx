"use client";

import { useActionState, useState } from "react";
import { addFinanceAction, type FinanceActionState } from "@/app/admin/(panel)/finance/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  CUSTOM_INCOME,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  INCOME_ITEMS,
} from "@/lib/finance/catalog";

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** Запис доходу чи витрати. Дохід швидко вибирається з прайсу студії, витрати — за категоріями. */
export function FinanceForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState<FinanceActionState, FormData>(addFinanceAction, null);
  const [formKey, setFormKey] = useState(0);
  const [kind, setKind] = useState<"income" | "expense">("income");
  const [item, setItem] = useState<string>(INCOME_ITEMS[0]!.id);
  const [title, setTitle] = useState(INCOME_ITEMS[0]!.label);
  const [category, setCategory] = useState<string>("Послуги");
  const [amount, setAmount] = useState(String(INCOME_ITEMS[0]!.price ?? ""));
  const errors = state?.fieldErrors ?? {};

  function pickItem(id: string) {
    setItem(id);
    if (id === CUSTOM_INCOME) {
      setTitle("");
      setCategory("Інше");
      setAmount("");
      return;
    }
    const found = INCOME_ITEMS.find((entry) => entry.id === id);
    if (!found) return;
    setTitle(found.label);
    setCategory(found.group);
    setAmount(found.price ? String(found.price) : "");
  }

  function switchKind(next: "income" | "expense") {
    setKind(next);
    setTitle("");
    setAmount("");
    if (next === "income") {
      pickItem(INCOME_ITEMS[0]!.id);
    } else {
      setCategory(EXPENSE_CATEGORIES[0]);
    }
  }

  const categories = kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <form key={formKey} action={action} className="grid gap-5 sm:grid-cols-2" noValidate>
      <input type="hidden" name="kind" value={kind} />

      <div className="flex gap-1 rounded-full border border-line bg-surface/70 p-1 sm:col-span-2 sm:w-fit" role="radiogroup" aria-label="Тип запису">
        {(
          [
            ["income", "Дохід"],
            ["expense", "Витрата"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={kind === value}
            onClick={() => switchKind(value)}
            className={cn(
              "rounded-full px-5 py-2 text-sm font-medium transition-colors",
              kind === value ? (value === "income" ? "bg-ok/20 text-ok" : "bg-danger/20 text-danger") : "text-muted hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {kind === "income" ? (
        <div className="sm:col-span-2">
          <Field id="item" label="Що продали" hint="Усі послуги з прайсу. Ціна «від» підставляється, її можна змінити нижче.">
            <select id="item" className={adminFieldClass} value={item} onChange={(event) => pickItem(event.target.value)}>
              <optgroup label="Послуги">
                {INCOME_ITEMS.filter((entry) => entry.group === "Послуги").map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                    {entry.price ? ` — від ${entry.price.toLocaleString("uk-UA")} ₴` : " — індивідуально"}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Підтримка">
                {INCOME_ITEMS.filter((entry) => entry.group === "Підтримка").map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label} — {entry.price?.toLocaleString("uk-UA")} ₴
                  </option>
                ))}
              </optgroup>
              <option value={CUSTOM_INCOME}>Інше (вписати вручну)</option>
            </select>
          </Field>
        </div>
      ) : null}

      <Field id="title" label={kind === "income" ? "Назва в обліку" : "На що витрата"} error={errors.title}>
        <input
          id="title"
          name="title"
          required
          maxLength={160}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-invalid={Boolean(errors.title)}
          placeholder={kind === "expense" ? "Наприклад: реклама в Instagram" : ""}
          className={adminFieldClass}
        />
      </Field>

      <Field id="category" label="Категорія" error={errors.category}>
        <select id="category" name="category" className={adminFieldClass} value={category} onChange={(event) => setCategory(event.target.value)}>
          {categories.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
      </Field>

      <Field id="amount" label="Сума, ₴" hint="Можна з комою: 1250,50" error={errors.amount}>
        <input
          id="amount"
          name="amount"
          required
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-invalid={Boolean(errors.amount)}
          className={adminFieldClass}
        />
      </Field>

      <Field id="date" label="Дата" error={errors.date}>
        <input id="date" name="date" type="date" required defaultValue={today} aria-invalid={Boolean(errors.date)} className={adminFieldClass} />
      </Field>

      <Field id="client" label={kind === "income" ? "Клієнт" : "Кому / де оплачено"} hint="Необов'язково.">
        <input id="client" name="client" maxLength={120} className={adminFieldClass} />
      </Field>

      <Field id="note" label="Нотатка" hint="Необов'язково.">
        <input id="note" name="note" maxLength={500} className={adminFieldClass} />
      </Field>

      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center">
        <Button type="submit" disabled={pending}>
          {pending ? "Записуємо…" : kind === "income" ? "Записати дохід" : "Записати витрату"}
        </Button>
        {state?.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
        {state?.ok ? (
          <p role="status" className="text-sm text-ok">
            Записано.{" "}
            <button
              type="button"
              onClick={() => {
                setFormKey((value) => value + 1);
                switchKind(kind);
              }}
              className="underline underline-offset-4"
            >
              Додати ще
            </button>
          </p>
        ) : null}
      </div>
    </form>
  );
}
