"use client";

import { useActionState } from "react";
import { requestCodeAction, verifyCodeAction, type LoginState } from "@/app/login/actions";
import { adminFieldClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

/** Вхід без пароля: email → код із листа (або посилання з того ж листа). */
export function ClientLoginForm({ initialEmail, next, initialError }: { initialEmail?: string; next?: string; initialError?: string }) {
  const [requested, requestAction, requesting] = useActionState<LoginState, FormData>(requestCodeAction, null);
  const [verified, verifyAction, verifying] = useActionState<LoginState, FormData>(verifyCodeAction, null);

  // Остання відповідь визначає крок: після помилки коду лишаємося на кроці коду.
  const state: LoginState = verified ?? requested;
  const step = state?.step ?? "email";

  if (step === "code" && state && "email" in state) {
    return (
      <div className="flex flex-col gap-5">
      <form action={verifyAction} className="flex flex-col gap-5" noValidate>
        <input type="hidden" name="email" value={state.email} />
        <input type="hidden" name="next" value={next ?? ""} />
        <p role="status" className="rounded-xl border border-line bg-surface-2 p-4 text-sm text-muted">
          {state.notice ?? "Код надіслано на"} <strong className="break-all text-fg">{state.email}</strong>. Введіть його нижче або відкрийте
          посилання з листа.
        </p>
        <div className="flex flex-col gap-2">
          <label htmlFor="code" className="text-sm font-medium">
            Код із листа
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6,8}"
            maxLength={8}
            required
            autoFocus
            aria-invalid={Boolean(state.error)}
            aria-describedby={state.error ? "code-error" : undefined}
            className={`${adminFieldClass} text-center font-mono text-2xl tracking-[0.4em]`}
          />
        </div>
        {state.error ? (
          <p id="code-error" role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
        <Button type="submit" disabled={verifying} className="w-full">
          {verifying ? "Перевіряємо…" : "Увійти"}
        </Button>
      </form>
      <form action={requestAction}>
        <input type="hidden" name="email" value={state.email} />
        <button type="submit" disabled={requesting} className="text-sm text-muted underline underline-offset-4 hover:text-fg disabled:opacity-60">
          {requesting ? "Надсилаємо…" : "Надіслати код ще раз"}
        </button>
      </form>
      </div>
    );
  }

  const error = (state && "error" in state ? state.error : undefined) ?? initialError;
  return (
    <form action={requestAction} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={initialEmail}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "login-error" : "login-hint"}
          className={adminFieldClass}
        />
        <p id="login-hint" className="text-sm text-muted">
          Пароль не потрібен: надішлемо одноразовий код. Це та сама пошта, яку ви вказали в заявці.
        </p>
      </div>
      {error ? (
        <p id="login-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={requesting} className="w-full">
        {requesting ? "Надсилаємо…" : "Отримати код"}
      </Button>
    </form>
  );
}
