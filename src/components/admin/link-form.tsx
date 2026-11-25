"use client";

import { useActionState, useState } from "react";
import { createLinkAction, type LinkActionState } from "@/app/admin/(panel)/links/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { DESTINATIONS, PRESETS, slugify } from "@/lib/analytics/links";

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
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function LinkForm() {
  const [state, action, pending] = useActionState<LinkActionState, FormData>(createLinkAction, null);
  // Зміна ключа скидає форму після успішного створення.
  const [formKey, setFormKey] = useState(0);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [source, setSource] = useState("sticker");
  const [medium, setMedium] = useState("qr");
  const errors = state?.fieldErrors ?? {};

  function reset() {
    setFormKey((value) => value + 1);
    setName("");
    setCode("");
    setCodeTouched(false);
    setSource("sticker");
    setMedium("qr");
  }

  return (
    <form key={formKey} action={action} className="grid gap-5 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <Field id="name" label="Назва (для вас)" hint="Наприклад: Стікер у кав'ярні на Подолі" error={errors.name}>
          <input
            id="name"
            name="name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!codeTouched) setCode(slugify(event.target.value));
            }}
            aria-invalid={Boolean(errors.name)}
            className={adminFieldClass}
          />
        </Field>
      </div>

      <Field id="preset" label="Тип джерела" hint="Підставляє джерело й канал нижче; їх можна змінити.">
        <select
          id="preset"
          className={adminFieldClass}
          defaultValue="sticker"
          onChange={(event) => {
            const preset = PRESETS.find((item) => item.id === event.target.value);
            if (preset) {
              setSource(preset.source);
              setMedium(preset.medium);
            }
          }}
        >
          {PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </Field>

      <Field id="destination" label="Куди веде" error={errors.destination}>
        <select id="destination" name="destination" className={adminFieldClass} defaultValue="/">
          {DESTINATIONS.map((item) => (
            <option key={item.path} value={item.path}>
              {item.label} ({item.path})
            </option>
          ))}
        </select>
      </Field>

      <Field id="source" label="Джерело (source)" error={errors.source}>
        <input
          id="source"
          name="source"
          required
          value={source}
          onChange={(event) => setSource(event.target.value)}
          aria-invalid={Boolean(errors.source)}
          className={adminFieldClass}
        />
      </Field>

      <Field id="medium" label="Канал (medium)" error={errors.medium}>
        <input
          id="medium"
          name="medium"
          required
          value={medium}
          onChange={(event) => setMedium(event.target.value)}
          aria-invalid={Boolean(errors.medium)}
          className={adminFieldClass}
        />
      </Field>

      <Field id="campaign" label="Кампанія" hint="Наприклад: spring-2026. Необов'язково." error={errors.campaign}>
        <input id="campaign" name="campaign" maxLength={80} aria-invalid={Boolean(errors.campaign)} className={adminFieldClass} />
      </Field>

      <Field id="content" label="Варіант оголошення" hint="Наприклад: story-1 чи black-sticker. Необов'язково." error={errors.content}>
        <input id="content" name="content" maxLength={80} aria-invalid={Boolean(errors.content)} className={adminFieldClass} />
      </Field>

      <div className="sm:col-span-2">
        <Field
          id="code"
          label="Код у короткому посиланні"
          hint={`Адреса буде /go/${code || "код"}. Після створення код не змінюється.`}
          error={errors.code}
        >
          <input
            id="code"
            name="code"
            required
            maxLength={40}
            value={code}
            onChange={(event) => {
              setCodeTouched(true);
              setCode(event.target.value.toLowerCase());
            }}
            aria-invalid={Boolean(errors.code)}
            className={`${adminFieldClass} font-mono`}
          />
        </Field>
      </div>

      <div className="sm:col-span-2">
        <Field id="note" label="Нотатка" hint="Де розклеєно стікер, який бюджет реклами тощо. Необов'язково.">
          <textarea id="note" name="note" rows={2} maxLength={500} className={adminFieldClass} />
        </Field>
      </div>

      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center">
        <Button type="submit" disabled={pending}>
          {pending ? "Створюємо…" : "Створити посилання"}
        </Button>
        {state?.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
        {state?.ok ? (
          <p role="status" className="text-sm text-ok">
            Готово: /go/{state.code}.{" "}
            <button type="button" onClick={reset} className="underline underline-offset-4">
              Створити ще одне
            </button>
          </p>
        ) : null}
      </div>
    </form>
  );
}
