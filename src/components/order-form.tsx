"use client";

import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  BUDGET_IDS,
  BUDGET_LABELS,
  DEADLINE_IDS,
  DEADLINE_LABELS,
  SERVICE_IDS,
  type ServiceId,
} from "@/lib/orders/options";
import { orderSchema, type OrderFieldErrors } from "@/lib/orders/schema";
import { services } from "@/lib/services";

type Values = {
  service: ServiceId | "";
  idea: string;
  budget: string;
  deadline: string;
  name: string;
  email: string;
  phone: string;
  consent: boolean;
};

const emptyValues: Values = {
  service: "",
  idea: "",
  budget: "",
  deadline: "",
  name: "",
  email: "",
  phone: "",
  consent: false,
};

const serviceTitles = Object.fromEntries(services.map((item) => [item.id, item.title])) as Record<
  ServiceId,
  string
>;

const fieldClass =
  "w-full min-h-12 rounded-2xl border border-line bg-surface px-4 py-3 text-base text-fg " +
  "placeholder:text-muted/70 transition-colors hover:border-muted/60 focus-visible:border-accent-soft " +
  "aria-[invalid=true]:border-danger";

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const serverMessages: Record<number, string> = {
  400: "Перевірте дані форми й спробуйте ще раз.",
  403: "Запит відхилено. Оновіть сторінку й спробуйте ще раз.",
  413: "Опис занадто великий. Скоротіть текст.",
  429: "Забагато заявок за короткий час. Спробуйте пізніше.",
  503: "Приймання заявок тимчасово недоступне. Спробуйте трохи пізніше.",
};

export function OrderForm() {
  const toast = useToast();
  const startedAt = useRef(Date.now());
  const [values, setValues] = useState<Values>(emptyValues);
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<OrderFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);

  const firstError = (name: keyof OrderFieldErrors) => errors[name]?.[0];

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (errors[key]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  const onText =
    (key: keyof Values) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      update(key, event.target.value as never);

  function focusField(name: string) {
    document.getElementById(`field-${name}`)?.focus();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const candidate = {
      ...values,
      phone: values.phone.trim() === "" ? undefined : values.phone,
      website: honeypot,
      startedAt: startedAt.current,
    };

    const parsed = orderSchema.safeParse(candidate);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as OrderFieldErrors;
      setErrors(fieldErrors);
      const order = ["service", "idea", "budget", "deadline", "name", "email", "phone", "consent"];
      const first = order.find((name) => fieldErrors[name as keyof OrderFieldErrors]);
      if (first) focusField(first);
      return;
    }

    setSubmitting(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as {
        ticket?: string;
        fieldErrors?: OrderFieldErrors;
        error?: string;
      } | null;

      if (response.status === 201 && body?.ticket) {
        setTicket(body.ticket);
        return;
      }

      if (response.status === 400 && body?.fieldErrors) {
        setErrors(body.fieldErrors);
        toast.push({
          tone: "error",
          title: "Не вдалося надіслати заявку",
          description: serverMessages[400],
        });
        return;
      }

      if (response.status === 400 && body?.error === "too_fast") {
        toast.push({
          tone: "error",
          title: "Занадто швидко",
          description: "Зачекайте кілька секунд і натисніть «Надіслати» ще раз.",
        });
        return;
      }

      toast.push({
        tone: "error",
        title: "Заявку не збережено",
        description:
          serverMessages[response.status] ?? "Сталася помилка сервера. Спробуйте ще раз пізніше.",
      });
    } catch {
      toast.push({
        tone: "error",
        title: "Немає звʼязку з сервером",
        description: "Перевірте зʼєднання з інтернетом і спробуйте ще раз. Дані форми збережено.",
      });
    } finally {
      window.clearTimeout(timeout);
      setSubmitting(false);
    }
  }

  async function copyTicket() {
    if (!ticket) return;
    try {
      await navigator.clipboard.writeText(ticket);
      toast.push({ tone: "success", title: "Номер звернення скопійовано" });
    } catch {
      toast.push({ tone: "error", title: "Не вдалося скопіювати", description: "Виділіть номер вручну." });
    }
  }

  function reset() {
    setValues(emptyValues);
    setErrors({});
    setTicket(null);
    startedAt.current = Date.now();
  }

  if (ticket) {
    return (
      <div
        role="status"
        className="rounded-[var(--radius-card)] border border-ok/50 bg-surface p-8 sm:p-10"
      >
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-ok">Заявку збережено</p>
        <h3 className="mt-5 text-3xl font-semibold tracking-tight">Дякуємо, ми отримали вашу заявку</h3>
        <p className="mt-4 text-muted">Номер вашого звернення — збережіть його для подальшого спілкування:</p>
        <p className="mt-5 inline-block rounded-2xl border border-line bg-surface-2 px-5 py-3 font-mono text-2xl tracking-wider">
          {ticket}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button type="button" onClick={copyTicket}>
            Скопіювати номер
          </Button>
          <Button type="button" variant="ghost" onClick={reset}>
            Надіслати ще одну заявку
          </Button>
        </div>
      </div>
    );
  }

  const describedBy = (name: keyof OrderFieldErrors, hint = false) =>
    firstError(name) ? `field-${name}-error` : hint ? `field-${name}-hint` : undefined;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-8 rounded-[var(--radius-card)] border border-line bg-surface/60 p-6 sm:p-10"
    >
      <fieldset
        id="field-service"
        tabIndex={-1}
        aria-describedby={describedBy("service")}
        className="flex flex-col gap-3 outline-none"
      >
        <legend className="mb-1 text-sm font-medium">1. Тип послуги</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {SERVICE_IDS.map((id) => {
            const selected = values.service === id;
            return (
              <label
                key={id}
                className={cn(
                  "flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors",
                  selected ? "border-accent-soft bg-surface-2" : "border-line hover:border-muted/60",
                )}
              >
                <input
                  type="radio"
                  name="service"
                  value={id}
                  checked={selected}
                  onChange={() => update("service", id)}
                  className="size-4 accent-[var(--color-accent)]"
                />
                <span>{serviceTitles[id]}</span>
              </label>
            );
          })}
        </div>
        {firstError("service") ? (
          <p id="field-service-error" className="text-sm text-danger">
            {firstError("service")}
          </p>
        ) : null}
      </fieldset>

      <Field
        id="field-idea"
        label="2. Опишіть ідею"
        hint="Що за продукт, для кого, які задачі він має вирішувати. Мінімум 20 символів."
        error={firstError("idea")}
      >
        <textarea
          id="field-idea"
          name="idea"
          rows={6}
          value={values.idea}
          onChange={onText("idea")}
          maxLength={3000}
          aria-invalid={Boolean(firstError("idea"))}
          aria-describedby={describedBy("idea", true)}
          className={cn(fieldClass, "resize-y")}
        />
      </Field>

      <div className="grid gap-8 sm:grid-cols-2">
        <Field id="field-budget" label="3. Орієнтовний бюджет" error={firstError("budget")}>
          <select
            id="field-budget"
            name="budget"
            value={values.budget}
            onChange={onText("budget")}
            aria-invalid={Boolean(firstError("budget"))}
            aria-describedby={describedBy("budget")}
            className={fieldClass}
          >
            <option value="" disabled>
              Оберіть бюджет
            </option>
            {BUDGET_IDS.map((id) => (
              <option key={id} value={id}>
                {BUDGET_LABELS[id]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="field-deadline" label="Бажані терміни" error={firstError("deadline")}>
          <select
            id="field-deadline"
            name="deadline"
            value={values.deadline}
            onChange={onText("deadline")}
            aria-invalid={Boolean(firstError("deadline"))}
            aria-describedby={describedBy("deadline")}
            className={fieldClass}
          >
            <option value="" disabled>
              Оберіть терміни
            </option>
            {DEADLINE_IDS.map((id) => (
              <option key={id} value={id}>
                {DEADLINE_LABELS[id]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <Field id="field-name" label="4. Імʼя" error={firstError("name")}>
          <input
            id="field-name"
            name="name"
            type="text"
            autoComplete="name"
            value={values.name}
            onChange={onText("name")}
            aria-invalid={Boolean(firstError("name"))}
            aria-describedby={describedBy("name")}
            className={fieldClass}
          />
        </Field>
        <Field id="field-email" label="Email" error={firstError("email")}>
          <input
            id="field-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={values.email}
            onChange={onText("email")}
            aria-invalid={Boolean(firstError("email"))}
            aria-describedby={describedBy("email")}
            className={fieldClass}
          />
        </Field>
      </div>

      <Field
        id="field-phone"
        label="Телефон (необовʼязково)"
        hint="Якщо зручніше, щоб ми зателефонували."
        error={firstError("phone")}
      >
        <input
          id="field-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={values.phone}
          onChange={onText("phone")}
          aria-invalid={Boolean(firstError("phone"))}
          aria-describedby={describedBy("phone", true)}
          className={fieldClass}
        />
      </Field>

      {/* Honeypot: прихований від людей і допоміжних технологій. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Не заповнюйте це поле
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(event) => setHoneypot(event.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            id="field-consent"
            type="checkbox"
            name="consent"
            checked={values.consent}
            onChange={(event) => update("consent", event.target.checked)}
            aria-invalid={Boolean(firstError("consent"))}
            aria-describedby={describedBy("consent")}
            className="mt-1 size-5 shrink-0 accent-[var(--color-accent)]"
          />
          <span className="text-sm leading-relaxed text-muted">
            Погоджуюсь на обробку наданих контактних даних для відповіді на мою заявку.
          </span>
        </label>
        {firstError("consent") ? (
          <p id="field-consent-error" className="text-sm text-danger">
            {firstError("consent")}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={submitting} className="w-full sm:w-auto sm:self-start">
        {submitting ? "Надсилаємо…" : "Надіслати заявку"}
      </Button>
    </form>
  );
}
